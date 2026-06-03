# Backoffice Hibrido — Spec de Diseno

> Fecha: 2026-06-02
> Estado: Aprobado por usuario

## Resumen

Backoffice hibrido para gestion de tickets de gastos operacionales. Combina Google Sheets (gestion de datos, dashboard con graficos, archivo historico) con una web app minima en `/admin` (alertas de IA con foto, correccion de clasificaciones, entrenamiento del catalogo de productos).

Un solo usuario admin (Alejandro). 1-3 sucursales. Autenticacion con Supabase Auth (email/password).

---

## Arquitectura General

```
Google Sheets (dashboard + gestion + archivo)
  |
  |-- Dashboard (graficos, slicers, comparaciones, presupuesto)
  |-- [Sucursal] YYYY-MM (datos crudos por sucursal+mes)
  |-- Categorias (editables, sync con DB)
  |-- Catalogo Productos (nombre, sinonimos, unidad, precio ref)
  |-- Presupuestos (por sucursal + categoria + mes)
  |-- Sucursales (gestion)
  |-- Empleados (gestion + PINs)
  |
Web App /admin (alertas + correccion + entrenamiento)
  |
  |-- Login (Supabase Auth)
  |-- Dashboard alertas (contadores + lista)
  |-- Detalle alerta (foto ticket + datos + correccion)
  |-- Catalogo productos (tabla editable + stats de matches)
  |
Supabase (DB + Storage + Edge Functions)
  |
  |-- Tablas existentes (sucursales, empleados, registros_tickets, etc.)
  |-- Tablas nuevas (categorias_gasto, catalogo_productos, alertas_tickets, presupuestos)
  |-- Edge Functions (verificar-pin, procesar-ticket, confirmar-ticket, enviar-alerta)
  |-- Storage (por-revisar, archivo)
  |
Gemini 1.5 Flash (procesamiento de imagenes)
  |-- Prompt mejorado con catalogo de productos como contexto
  |-- Extraccion de folio/numero de ticket
  |-- Deteccion de unidades (kg, pz, ml, lt)
```

---

## Nuevas Tablas Supabase

### categorias_gasto
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | |
| nombre | TEXT NOT NULL | Ej: "Insumos Alimentos" |
| orden | INT | Para ordenar en UI y prompt |
| activa | BOOLEAN DEFAULT true | Soft delete |
| created_at | TIMESTAMPTZ | |

Datos iniciales: Insumos Alimentos, Desechables, Extras, Gas, Luz, Limpieza.

### catalogo_productos
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | |
| nombre | TEXT NOT NULL | Nombre canonico |
| sinonimos | TEXT[] | Variantes que Gemini puede encontrar |
| categoria_id | UUID FK | Referencia a categorias_gasto |
| unidad_default | TEXT | kg, pz, ml, lt, etc. |
| precio_referencia | NUMERIC(12,2) | Para detectar montos anomalos |
| veces_matched | INT DEFAULT 0 | Contador de usos |
| activo | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ | |

### alertas_tickets
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | |
| registro_ticket_id | UUID FK | Ticket que genero la alerta |
| tipo | TEXT CHECK | duplicado, ilegible, producto_no_reconocido, sin_unidad, monto_anomalo, posible_duplicado |
| duplicado_de_id | UUID FK NULL | Si es posible_duplicado, referencia al ticket original |
| resuelta | BOOLEAN DEFAULT false | |
| correccion | JSONB NULL | Datos corregidos por el admin |
| created_at | TIMESTAMPTZ | |

### presupuestos
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | |
| sucursal_id | UUID FK | |
| categoria_id | UUID FK | |
| mes | DATE | Primer dia del mes (2026-06-01) |
| monto | NUMERIC(12,2) | Presupuesto asignado |
| UNIQUE | (sucursal_id, categoria_id, mes) | |

### Cambios a registros_tickets (existente)
- Agregar columna `folio_ticket TEXT` -- numero de ticket/nota/factura
- Agregar columna `unidad TEXT` -- kg, pz, ml, lt, etc.
- Cambiar `categoria_gasto TEXT` a `categoria_id UUID FK` (migracion con mapping)

---

## Deteccion de Duplicados (3 capas)

1. **Hash SHA-256** (ya implementada) -- misma imagen exacta -> bloqueo inmediato, no se procesa.
2. **Folio de ticket** -- Gemini extrae folio si es visible. Mismo folio + misma sucursal en ultimos 30 dias -> alerta `posible_duplicado`.
3. **Datos similares** -- mismo comercio + monto +-10% + misma fecha + misma sucursal -> alerta `posible_duplicado`.

Las capas 2 y 3 no bloquean: el ticket se procesa pero se crea alerta para revision manual.

---

## Prompt de Gemini Mejorado

El prompt actual solo pide clasificar libre. El nuevo prompt:

1. Edge Function carga catalogo de productos y categorias de Supabase antes de llamar a Gemini.
2. Inyecta la lista en el prompt como contexto:
   ```
   Productos conocidos (usa estos para clasificar si aplican):
   - Aceite vegetal | categoria: Insumos Alimentos | unidad: lt
   - Servilletas | categoria: Desechables | unidad: pz
   ...
   
   Categorias validas: Insumos Alimentos, Desechables, Extras, Gas, Luz, Limpieza
   ```
3. Campos de extraccion ampliados:
   ```json
   {
     "folio_ticket": "string o null",
     "fecha": "YYYY-MM-DD o null",
     "comercio": "string o null",
     "producto": "string o null",
     "cantidad": "numero o null",
     "unidad": "kg|pz|ml|lt|otro o null",
     "monto": "numero decimal o null",
     "categoria_gasto": "una de las categorias validas",
     "confianza": "alta|media|baja"
   }
   ```
4. Si confianza es "baja" -> alerta `ilegible`.
5. Si producto no matchea catalogo -> alerta `producto_no_reconocido`.
6. Si unidad es null -> alerta `sin_unidad`.
7. Si monto > 1.5x precio_referencia del producto -> alerta `monto_anomalo`.

---

## Google Sheets — Estructura de Pestanas

### 1. Dashboard (primera pestana)
- **Slicers interactivos**: sucursal, categoria, mes
- **KPIs arriba**: gasto total del mes, # tickets, gasto promedio diario, % vs presupuesto
- **Comparaciones**: vs mes anterior (flecha verde/roja + %), vs mismo mes ano pasado
- **Graficos**:
  - Dona: distribucion porcentual por categoria
  - Barras apiladas: tendencia 6 meses por categoria
  - Top 10 productos por gasto acumulado
  - Comparacion entre sucursales (barras lado a lado)
- **Presupuesto**: tabla categoria vs presupuesto vs real vs desviacion
- Datos alimentados con formulas QUERY/FILTER desde las pestanas de datos

### 2. [NombreSucursal] YYYY-MM (una por sucursal+mes)
- Headers con filtros nativos
- Columnas: Fecha, Folio, Comercio, Producto, Cantidad, Unidad, Monto, Categoria, Empleado, Archivo
- Formato condicional: rojo si monto > 1.5x precio referencia
- Creada automaticamente por confirmar-ticket

### 3. Categorias
- Tabla editable: nombre, orden, activa
- Sync bidireccional con tabla `categorias_gasto` en Supabase

### 4. Catalogo Productos
- Tabla editable: nombre, sinonimos (separados por coma), categoria, unidad, precio ref
- Sync con `catalogo_productos` en Supabase

### 5. Presupuestos
- Tabla: sucursal, categoria, mes, monto presupuestado
- El Dashboard lee de aqui para calcular desviaciones

### 6. Sucursales
- Tabla editable: slug, nombre, direccion, activa
- Sync con Supabase

### 7. Empleados
- Tabla editable: nombre, PIN, sucursales asignadas (separadas por coma)
- PINs se hashean al sync con Supabase (nunca se almacenan en texto plano en la DB)

---

## Web App /admin — Pantallas

### Login
- Email + password con Supabase Auth
- Solo usuario admin (no auto-registro)
- Redirige a /admin/alertas

### /admin/alertas (pantalla principal)
- Contadores arriba: total pendientes, duplicados, ilegibles, productos nuevos, sin unidad
- Lista de alertas ordenada por fecha (mas reciente primero)
- Cada alerta muestra: tipo (badge de color), fecha, comercio, monto, thumbnail del ticket
- Click -> detalle

### /admin/alertas/[id] (detalle de alerta)
- Lado izquierdo: foto del ticket (zoom, scroll)
- Lado derecho:
  - Datos extraidos por Gemini (editables)
  - Dropdown categoria (del catalogo)
  - Autocomplete producto (del catalogo, o "Agregar nuevo")
  - Selector unidad (kg, pz, ml, lt, caja, bulto, etc.)
  - Campo precio referencia
  - Si es posible_duplicado: muestra ambos tickets lado a lado
- Acciones: "Aprobar" (guarda correccion + agrega al catalogo si es nuevo), "Rechazar" (descarta ticket)

### /admin/catalogo (entrenamiento)
- Tabla de productos con busqueda
- Columnas: nombre, sinonimos, categoria, unidad, precio ref, veces usado
- Edicion inline
- Boton "Agregar producto"
- Filtro por categoria

---

## Email de Alertas

- Servicio: Resend (free tier 100/dia)
- Trigger: insert en alertas_tickets donde tipo IN ('duplicado', 'ilegible')
- Edge Function `enviar-alerta-email`
- Template simple: tipo de alerta, datos del ticket, link a /admin/alertas/[id]
- Destinatario: alepolch@gmail.com

---

## Fases de Implementacion

### Fase 1 — Backend: Schema + Gemini mejorado + alertas
- Migracion SQL: nuevas tablas + columnas en registros_tickets
- Seed de categorias iniciales
- Refactor procesar-ticket: prompt mejorado con catalogo, deteccion de duplicados inteligente, creacion de alertas
- Refactor confirmar-ticket: pestana por sucursal+mes, columna unidad y folio
- Nueva Edge Function: enviar-alerta-email (Resend)
- Supabase Auth: crear usuario admin

### Fase 2 — Web /admin: alertas + correccion + catalogo
- Layout admin (sidebar, header, auth guard)
- Pagina alertas (lista + contadores)
- Pagina detalle alerta (foto + edicion + aprobar/rechazar)
- Pagina catalogo productos (tabla editable)
- Sync: correccion -> catalogo_productos

### Fase 3 — Google Sheets: dashboard + graficos + gestion
- Refactor google-sheets.ts para pestanas por sucursal+mes
- Pestana Dashboard con slicers, KPIs, graficos, presupuestos
- Pestanas de gestion (Categorias, Catalogo, Sucursales, Empleados)
- Sync bidireccional Sheets <-> Supabase (Apps Script triggers)
- Formato condicional en pestanas de datos
