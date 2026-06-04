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
| `/admin/catalogo` | Productos conocidos que entrenan a la IA. Por sucursal (global + de la sucursal). Sinonimos, unidad, precio ref. |
| `/admin/categorias` | CRUD de categorias de gasto. Por sucursal (global + de la sucursal). |
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

### Migraciones aplicadas: 001–013

---

## Edge Functions (Deno, verify_jwt=false, auth JWT HMAC propio)
- `verificar-pin` — PIN → session_token.
- `procesar-ticket` (v15) — async: responde rapido + Gemini multi-producto en background + auto-confirma.
- `confirmar-ticket` — confirmacion manual (1 fila/item a Sheets). (El happy path auto-confirma desde procesar-ticket.)
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

## Pendiente / ideas
- Marcar esquinas de la foto para recortar ruido a Gemini (opcional; 2.5-flash lee bien).
- markitdown (Microsoft): util solo si suben PDFs/facturas digitales, no para fotos.
- Confirmacion manual de tickets pendientes desde el admin (hoy se resuelven via alertas).
