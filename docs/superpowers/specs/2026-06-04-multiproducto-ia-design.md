# Multi-producto por ticket + auto-categorización IA

**Fecha:** 2026-06-04
**Proyecto:** Revisión de Tickets (`tickets-se`)
**Estado:** Diseño aprobado por el usuario, pendiente de implementación
**Prioridad:** ALTA — casi todos los tickets reales son multi-producto; el diseño actual (1 producto/ticket) es inservible.

## Problema

Hoy `registros_tickets` guarda UN solo producto por ticket (columnas `producto`,
`cantidad`, `unidad`, `monto` únicas) y el prompt de Gemini pide un solo producto.
Los tickets reales traen varios renglones → se pierde casi todo.

## Comportamiento deseado (palabras del usuario)

- Gemini debe **interpretar cada renglón** del ticket y **meterlo a una categoría**
  automáticamente (ese es el punto de usar IA). Auto-acepta, no pide permiso por cada uno.
- Solo avisa cuando un renglón es **imposible de categorizar** o **no entiende la unidad**.
- El usuario corrige esas excepciones y **enseña sinónimos** ("este *mckenin* es papa"),
  que se guardan en el catálogo para la próxima.
- Montos: normalmente cada renglón trae su precio; las **notas a mano** a veces solo el total
  → ser tolerante (capturar lo que se pueda, marcar si falta precio por línea).
- Categorías: usa las existentes, pero el usuario puede **agregar categorías** (feature C).

## Modelo de datos (migración nueva, ~010)

### Tabla `ticket_items`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `registro_ticket_id` | UUID NOT NULL | FK `registros_tickets` ON DELETE CASCADE |
| `descripcion` | TEXT NOT NULL | texto del renglón tal como lo leyó Gemini |
| `cantidad` | NUMERIC | nullable |
| `unidad` | TEXT | nullable |
| `monto` | NUMERIC(12,2) | nullable (notas a mano sin precio por línea) |
| `categoria_id` | UUID | FK `categorias_gasto`, nullable si no se pudo categorizar |
| `producto_catalogo_id` | UUID | FK `catalogo_productos`, nullable; si hizo match |
| `necesita_revision` | BOOLEAN DEFAULT false | true si sin categoría o sin unidad |
| `motivo_revision` | TEXT | 'sin_categoria' \| 'sin_unidad' \| 'sin_precio' |
| `created_at` | TIMESTAMPTZ | |

- `registros_tickets` pasa a ser **encabezado**: comercio, fecha, folio, sucursal,
  empleado, monto_total (= suma de items o total leído), estado, storage_path, hash.
  Las columnas `producto/cantidad/unidad/categoria_id` quedan **legacy** (no se borran
  para no romper datos viejos; se dejan de usar para tickets nuevos).
- RLS: admin authenticated full access; lectura por service_role en edge functions.

## Cambios por componente

### `procesar-ticket` (edge function)
- Prompt: devolver `items: [{descripcion, cantidad, unidad, monto, categoria_sugerida, confianza}]`
  además del encabezado. Pasar las 6 categorías + catálogo como contexto para que Gemini
  asigne `categoria_sugerida` (nombre exacto de una categoría existente) por renglón.
- Resolver `categoria_id` por nombre; `producto_catalogo_id` por match con catálogo/sinónimos.
- Insertar encabezado + N `ticket_items`.
- Alertas: una sola alerta por ticket si hay items con `necesita_revision` (sin_categoria /
  sin_unidad). Mantener alertas de duplicado/ilegible a nivel ticket.
- `monto_total`: suma de items con precio; si Gemini dio un total y difiere, marcar.

### `confirmar-ticket` (edge function)
- Append a Google Sheets: **una fila por item** (no por ticket). Columnas: fecha, comercio,
  folio, sucursal, descripcion, cantidad, unidad, monto, categoria.

### `/admin/alertas/[id]` (revisión)
- Mostrar la **lista de renglones** del ticket. Por renglón: editar categoría/unidad,
  y para enseñar sinónimo → agregar/actualizar `catalogo_productos` (nombre + sinónimos +
  categoría + unidad). Marcar item como revisado (necesita_revision=false).
- Aprobar el ticket cuando no queden items pendientes.

### `/admin/dashboard` (arqueo)
- El gasto por categoría debe salir de `ticket_items` (sum monto group by categoria_id)
  de items cuyo ticket está confirmado, no de `registros_tickets.producto`.
- Actualizar `lib/arqueo.ts` data source y el export.

### Feature C — gestión de categorías (`/admin/categorias` o sección)
- CRUD simple de `categorias_gasto` (nombre, orden, activa). Pieza chica e independiente.
  Permite al usuario agregar categorías que luego la IA puede usar.

## Orden de implementación sugerido
1. Migración `ticket_items` + RLS (no rompe nada existente).
2. Feature C (categorías) — rápido, desbloquea "agregar categorías".
3. `procesar-ticket` multi-item + prompt (con datos de prueba, sin romper el flujo de subida).
4. `/admin/alertas/[id]` revisión por renglón + enseñar sinónimos.
5. `confirmar-ticket` → Sheets una fila por item.
6. Dashboard/arqueo desde `ticket_items` + export.
7. E2E con un ticket multi-producto real.

## Notas
- Hacer por capas; cada paso compila y deploya sin romper el flujo de subida actual.
- Mantener compat: tickets viejos (1 producto en registros_tickets) deben seguir
  mostrándose; el dashboard puede unir ambos orígenes durante la transición o migrar
  los viejos a un item cada uno (decidir en implementación).
