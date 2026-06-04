# Fase 3 — Auditoría de costos (dashboard de gastos vs ventas)

**Fecha:** 2026-06-03
**Proyecto:** Revisión de Tickets (`tickets-se`)
**Estado:** Diseño aprobado, pendiente plan de implementación

---

## Propósito

Permitir al dueño/admin hacer **arqueos rápidos** (semanales o mensuales) de cada
sucursal: comparar el **gasto real** (extraído de los tickets confirmados) contra
las **ventas** del mismo periodo, viendo el gasto como **% de la venta** por
categoría, contra un **objetivo de % por categoría**. La función central es la
**captura de datos** y la **visualización interactiva en tiempo real** para
control de costos. Exportable a Excel.

No es un presupuesto plano: el gasto esperado es una función de la venta
(ej. "Insumos deberían ser ~30% de la venta").

## Contexto y decisiones

- **Dónde vive:** página(s) web dentro del `/admin` Next.js existente (no en
  Google Sheets). Mismo login (Supabase Auth, rol `authenticated`), misma
  estética zinc, auto-deploy desde `main`.
- **Origen de ventas:** captura **manual** por ahora. Integración con POS se
  explora después sin cambiar el modelo de datos.
- **Granularidad (decisión A + C):** las ventas se capturan **mensual**
  (robusto, siempre cuadra). El dashboard ofrece dos modos de periodo:
  - **Presets de mes** (Este mes / Mes pasado / elegir mes): arqueo exacto.
  - **Rango de fechas libre:** los gastos se suman exacto por `fecha_ticket`;
    la venta del rango se **prorratea por días** de los meses que toca y se
    marca claramente como **estimada**.
- **Objetivo de costo:** **% objetivo por categoría** (ej. Insumos 30%, Gas 5%).
  El dashboard marca verde (dentro) / rojo (excede).
- **Gasto real:** solo tickets con `estado='confirmado'`, agrupados por
  `categoria_id`, filtrados por `fecha_ticket` en el rango.

## Modelo de datos (migración `008_ventas_objetivos.sql`)

### Tabla `ventas`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `sucursal_id` | UUID NOT NULL | FK `sucursales` |
| `mes` | DATE NOT NULL | primer día del mes |
| `monto` | NUMERIC(12,2) NOT NULL | venta total del mes |
| `created_at` / `updated_at` | TIMESTAMPTZ | trigger `updated_at` |

- UNIQUE (`sucursal_id`, `mes`). Upsert en captura.

### Tabla `objetivos_costo`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `categoria_id` | UUID NOT NULL | FK `categorias_gasto` |
| `sucursal_id` | UUID NULL | NULL = aplica a todas las sucursales |
| `pct_objetivo` | NUMERIC(5,2) NOT NULL | ej. 30.00 = 30% |
| `activo` | BOOLEAN NOT NULL DEFAULT true | |

- RLS en ambas: `FOR ALL USING (auth.role() = 'authenticated')`, consistente
  con las tablas del backoffice (migración 006).

## Pantallas

### `/admin/dashboard` — Arqueo (pantalla principal)
- Selector de periodo: presets de mes + modo rango libre (fecha inicio–fin).
- Selector de sucursal (o "Todas").
- Tarjetas resumen: Venta total, Gasto total, **Gasto % de venta**, # tickets.
- Tabla de arqueo por categoría: categoría · gasto · % venta · objetivo % ·
  semáforo verde/rojo.
- Gráfico dona: distribución de gasto por categoría.
- Gráfico línea: tendencia de gasto total por mes (~6 meses) con venta de contexto.
- Botón **Exportar** → `.xlsx` del periodo.
- En modo rango libre, las ventas (y por ende los %) se marcan "estimado".

### `/admin/ventas` — Captura de ventas
- Tabla: filas = meses recientes, columna por sucursal, celdas editables.
- Selector de mes para navegar; botón "copiar del mes anterior".
- Upsert en `ventas` por (sucursal, mes).

### `/admin/objetivos` — Objetivos de costo
- Lista de categorías con input de % objetivo cada una. Guarda en `objetivos_costo`.

## Componentes / archivos

- `frontend/app/admin/dashboard/page.tsx` — dashboard de arqueo
- `frontend/app/admin/ventas/page.tsx` — captura de ventas
- `frontend/app/admin/objetivos/page.tsx` — objetivos %
- `frontend/lib/arqueo.ts` — **lógica pura** de cálculo: sumar gastos por
  categoría/rango, prorrateo de ventas por días, % y semáforos. Sin UI, testeable.
- `frontend/lib/export-xlsx.ts` — armado del `.xlsx` (resumen + detalle).
- `supabase/migrations/008_ventas_objetivos.sql` — tablas + RLS + trigger.
- Layout `frontend/app/admin/layout.tsx`: agregar nav "Dashboard", "Ventas",
  "Objetivos".

## Dependencias nuevas (frontend)
- Gráficos: librería ligera (candidato `recharts`) — confirmar en el plan.
- Excel: `xlsx` (SheetJS), export client-side (sin tocar edge functions).

## Lógica clave: prorrateo de ventas en rango libre

Para un rango [inicio, fin] que cruza meses:
1. Gastos = suma de `registros_tickets.monto` confirmados con
   `fecha_ticket` en [inicio, fin], agrupado por `categoria_id`.
2. Ventas estimadas = por cada mes M tocado por el rango:
   `ventas[M].monto * (días de M dentro del rango / días totales de M)`,
   sumando sobre los meses. Marcado como estimado en la UI.
3. % categoría = gasto_categoría / ventas_periodo. Semáforo vs `pct_objetivo`.

En modo preset de mes, ventas = `ventas[mes].monto` exacto (sin prorrateo).

## Fuera de alcance (Fase 3)
- Integración con POS (se explora después; el modelo no cambia).
- Captura de ventas semanal (el modelo mensual + prorrateo cubre el arqueo;
  extensible a semanal después sin rehacer).
- Comparativa entre sucursales como vista dedicada (hoy solo 1 sucursal; el
  selector ya soporta filtrar por sucursal).

## Notas de implementación
- Solo cuentan tickets `estado='confirmado'` en el gasto (no pendientes/rechazados).
- Reusar patrón de las páginas admin existentes (cliente Supabase anon + sesión,
  estética zinc, helpers `Field`).
- `arqueo.ts` debe ser pura y con pruebas (TDD) por el prorrateo de fechas.
