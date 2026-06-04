# PROJECT_STATE.md — Revision de Tickets

> Estado vivo del proyecto. Ultima actualizacion: 2026-06-04.

## Estado general: EN PRODUCCION (funcional end-to-end)

App movil para que gerentes suban fotos de tickets de gasto. Gemini (vision)
extrae los renglones, auto-categoriza, y el admin audita el costo vs ventas por
sucursal. Todo en `main`, deploy automatico en Vercel.

---

## Como funciona AL MOMENTO (flujo real)

### 1. Gerente sube ticket (movil)
1. Escanea QR / abre `/sucursal/[slug]` → ingresa PIN → `verificar-pin` devuelve
   un `session_token` (JWT HMAC propio, 1h) que se guarda en sessionStorage.
2. Toma o elige **una o varias fotos** → "Enviar".
3. El frontend manda cada imagen a `procesar-ticket` con `Authorization: Bearer <session_token>`.
4. **Respuesta instantanea**: "¡Enviado! Muchas gracias". El gerente NO espera a la IA.

### 2. Procesamiento en SEGUNDO PLANO (async)
`procesar-ticket` (Edge Function) responde `{recibido:true}` al instante y sigue
con `EdgeRuntime.waitUntil()`:
- Sube la imagen a Storage (`por-revisar`), inserta `registros_tickets` (encabezado, estado `pendiente`).
- Llama a **Gemini** (modelo `gemini-2.5-flash`, configurable via secret `GEMINI_MODEL`,
  con fallback automatico a otros modelos). Prompt multi-producto + categorias y
  catalogo de la sucursal como contexto.
- Inserta N **`ticket_items`** (un renglon por producto), cada uno auto-categorizado.
- Genera alertas SOLO por excepcion: `ilegible` (confianza baja), `producto_no_reconocido`
  (renglon sin categoria), `sin_unidad`, `posible_duplicado`, duplicado por hash.
- Si NO hay alertas → **auto-confirma**: mueve la imagen a `archivo/AAAA-MM/`, manda
  una fila por item a Google Sheets, estado `confirmado`.
- Si hay alertas → queda `pendiente` para que el admin lo revise.

### 3. Admin audita (web /admin)
Login Supabase Auth. **Un selector de sucursal en el header filtra TODAS las
secciones** (contexto global, persistido en localStorage; "Todas" = global).

---

## Secciones del admin (todas operan por sucursal)

| Ruta | Que hace |
|---|---|
| `/admin/dashboard` (Arqueo) | Gasto real (de `ticket_items` confirmados) vs ventas, % por categoria con objetivo y semaforo, dona y tendencia. Selector mes/rango. Export a Excel. Usa el objetivo de la sucursal con global de respaldo. |
| `/admin/tickets` | Lista TODOS los tickets (filtro periodo + sucursal del header) con foto, comercio, total y **quien lo subio**. Detalle con foto + renglones. Boton "Descargar periodo" → ZIP con imagenes + tickets.csv. |
| `/admin/alertas` | Tickets que necesitan revision (filtra por sucursal). Detalle `/admin/alertas/[id]`: corrige categoria/unidad **por renglon** y **ensena sinonimos** (los guarda en el catalogo). Resuelve o rechaza. |
| `/admin/ventas` | Captura manual de la venta mensual por sucursal (para el arqueo). |
| `/admin/catalogo` | Catalogo + categorias fusionados. Cada categoria con sus productos. Categoria: renombrar, activar, toggle **Operativo/No operativo** (si suma o no al gasto de operacion). Producto: agregar, **editar (mover de categoria, unidad, sinonimos)**, activar, eliminar. Por sucursal (global + de la sucursal). La IA auto-aprende productos aqui. |
| `/admin/comercios` | Comercios que la IA aprendio (su categoria habitual). Corregir categoria u olvidar. Por sucursal. |
| `/admin/objetivos` | % objetivo de costo por categoria. Por sucursal (global de respaldo). |
| `/admin/sucursales` | CRUD de sucursales y empleados (PIN). Enlace + **QR descargable**. Eliminar (o desactivar si tienen datos). |

---

## Base de datos (tablas principales)

- `sucursales` (slug, nombre, activa) · `empleados` (pin_hash bcrypt) · `sucursal_empleados` (N:M)
- `registros_tickets` — **encabezado** del ticket (comercio, fecha, folio, monto total,
  sucursal, empleado, estado, storage paths, hash, gemini_raw). Columnas producto/cantidad/
  unidad legacy (no se usan para tickets nuevos).
- **`ticket_items`** — renglones (descripcion, cantidad, unidad, monto, categoria_id,
  producto_catalogo_id, necesita_revision, motivo_revision).
- `categorias_gasto` (+ `sucursal_id` NULL=global) · `catalogo_productos` (+ `sucursal_id`)
- `alertas_tickets` (tipo, resuelta) · `ventas` (sucursal+mes+monto) ·
  `objetivos_costo` (categoria + `sucursal_id` NULL=global + pct_objetivo)

### Funciones / jobs
- `verificar_pin(slug, pin)` — valida PIN (SECURITY DEFINER).
- `admin_guardar_empleado(...)` — crea/edita empleado hasheando el PIN (SECURITY DEFINER).
- `limpiar_imagenes_antiguas()` + **pg_cron mensual** — borra fotos con +1 año (conserva datos).

### Storage
- Buckets `por-revisar` y `archivo` (PRIVADOS). El admin ve las fotos via **URLs firmadas**
  (createSignedUrl). RLS: SELECT para `authenticated` (migracion 011).

- `comercios` (nombre, sucursal_id, categoria_id, veces) — la IA aprende la categoria habitual de cada comercio.
### Migraciones aplicadas: 001–016

---

## Edge Functions (Deno, verify_jwt=false, auth JWT HMAC propio)
- `verificar-pin` — PIN → session_token.
- `procesar-ticket` (v20) — async: responde rapido + Gemini multi-producto en background + auto-confirma.
  Aprende comercios (`aprenderComercio`) y **auto-aprende productos** (`aprenderProductos`): cada renglon
  que entiende y categoriza, si no existe en el catalogo, lo inserta solo en el catalogo de la sucursal.
  Prompt usa el nombre del comercio para distinguir (gasolinera→combustible vs gas de cocina) y normaliza
  abreviaturas/erratas (popt→popote).
- `confirmar-ticket` — confirmacion manual (1 fila/item a Sheets). (El happy path auto-confirma desde procesar-ticket.)
- `confirmar-admin` (verify_jwt=true) — el admin confirma un ticket revisado desde Alertas (archiva + Sheets + estado).
- `enviar-alerta-email` — Resend para alertas criticas.
- Deploy: via Supabase MCP `deploy_edge_function` (no hay token para el CLI de supabase).

---

## Gemini
- `gemini-1.5-flash` fue RETIRADO por Google (404). Modelo actual: **`gemini-2.5-flash`**
  (funciona con la API key con billing). Configurable sin redeploy via secret `GEMINI_MODEL`.
- Cadena de fallback de modelos en `procesar-ticket` por robustez.
- Imagen → base64 con `encodeBase64` de Deno std (no `String.fromCharCode` que desborda el stack).

---

## Stack / servicios
- Frontend Next.js 14 (Vercel, auto-deploy desde `main`, rootDirectory=frontend).
- Supabase `tickets-se` (ref `dlmqqmvrgkilptawllep`). Google Sheets (service account).
- Repo `ACHAZARO/tickets-se` (remote con owner en MAYUSCULAS; credencial GCM fijada a ACHAZARO).

---

## Login admin
- `alepolch@gmail.com` (creado por SQL; se le agrego identity + columnas de token para que
  GoTrue lo aceptara). Crear nuevos admin desde el Dashboard de Supabase, NO por SQL directo.

---

## Fixes 2026-06-04 (tarde)
- **PIN: cualquier PIN entraba** (bug de seguridad). La pagina del PIN solo revisaba
  `res.ok` (verificar-pin responde HTTP 200 con `{valid:false}` para PIN incorrecto).
  Ahora exige `data.valid===true && data.session_token`. /subir redirige al PIN si la
  sesion no trae token. Verificado en vivo: PIN incorrecto ya no entra.
- **"Enviando" colgado**: era `createImageBitmap` (compresion de imagen) colgandose con
  fotos de celular, bloqueando antes del envio. Fix: timeout de 8s en la compresion
  (fallback a la foto original) + 45s en el fetch. Verificado: flujo completo en ~1.7s.
- NOTA: el cache del telefono puede servir codigo viejo; probar en incognito para forzar la version nueva.

## Cambios 2026-06-04 (tanda IA + gasto)
- **Dashboard sin ventas**: la etapa actual es 100% captura de gasto + entrenar IA + ver
  distribucion. Donut con tooltip al pasar/tocar (nombre + monto + %). Split
  **operativo vs no operativo** (compras de equipo no ensucian la operacion). Tabla de
  categorias con % del gasto y "Productos mas comprados" con **cantidad por periodo**.
- **IA aprende comercios** (`comercios`): mapea comercio→categoria dominante; se inyecta al
  prompt como pista fuerte. Pantalla `/admin/comercios` para corregir.
- **IA auto-aprende productos** (procesar-ticket v20): cada renglon entendido y categorizado
  que no exista, se inserta al catalogo de la sucursal. El usuario solo edita si algo esta mal.
- **Editar producto en catalogo**: mover de categoria, cambiar unidad y sinonimos por producto.
- **Gasolina mal clasificada (→ "Gas" de cocina)**: prompt ahora usa el comercio para distinguir
  combustible vs gas de cocina. Sembrado: comercio "CENTRO GASOLINERO ANIMAS SA DE CV" →
  "gasolina y motor" (suc vale) + producto "Gasolina" (sinonimos magna/premium/diesel). Renglones
  historicos "GAS" de esa gasolinera recategorizados a "gasolina y motor".
- **Fecha mal leida tiraba tickets fuera del filtro de mes**: ahora si Gemini da fecha invalida
  se usa la de hoy; fecha/comercio editables en `/admin/tickets`.
- **Eliminar tickets** + descarga ZIP del periodo + retencion de imagenes +1 año (pg_cron).

## Pendiente / ideas
- Re-aprender comercio al confirmar desde Alertas (que las correcciones del admin refuercen el mapa comercio→categoria).
- Marcar esquinas de la foto para recortar ruido a Gemini (opcional; 2.5-flash lee bien).
- markitdown (Microsoft): util solo si suben PDFs/facturas digitales, no para fotos.
- Confirmacion manual de tickets pendientes desde el admin (hoy se resuelven via alertas).
