# PROJECT_STATE.md — Revision de Tickets

> Estado vivo del proyecto. Ultima actualizacion: 2026-06-08.

## Coordinacion Claude + Codex
- `CLAUDE.md` y `AGENTS.md` son la guia estable para ambos agentes; mantenerlos sincronizados.
- Este archivo es la fuente viva para estado real, decisiones recientes, deuda conocida y proximo trabajo.
- Antes de pulir o corregir, leer primero estos tres archivos y luego el area afectada.
- Codex hizo auditoria local el 2026-06-08: build frontend OK, sin cambios de codigo aun.

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
| `/admin/alertas` | Legacy: la ruta existe, pero ya no esta en el nav. La operacion diaria se hace desde `/admin/tickets`. |
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
### Migraciones aplicadas: 001–022
  (017 = categoria nullable + RPC ligar_huerfano; 018 = precio_historial + equivalencias;
   019 = consumo_inventario; 020 = backfill productos en limbo; 021 = descuentos;
   022 = CHECK de alertas para Tickets unificado)

---

## Edge Functions (Deno, verify_jwt=false, auth JWT HMAC propio)
- `verificar-pin` — PIN → session_token.
- `procesar-ticket` (v25) — async: responde rapido + Gemini multi-producto en background + auto-confirma.
  Aprende comercios/productos, registra precios (alerta `precio_anomalo` vs promedio) y matchea con
  PRECISION (sinonimos <4 chars solo exactos; match por token completo, no substring).
  Aprende comercios (`aprenderComercio`) y **auto-aprende productos** (`aprenderProductos`): cada renglon
  que entiende y categoriza, si no existe en el catalogo, lo inserta solo en el catalogo de la sucursal.
  Prompt usa el nombre del comercio para distinguir (gasolinera→combustible vs gas de cocina) y normaliza
  abreviaturas/erratas (popt→popote).
- `confirmar-ticket` — confirmacion manual (1 fila/item a Sheets). (El happy path auto-confirma desde procesar-ticket.)
- `confirmar-admin` (verify_jwt=true) — el admin confirma un ticket revisado desde Alertas (archiva + Sheets + estado).
- `reprocesar-ticket` (verify_jwt=true) — segunda pasada manual de IA desde Tickets; reemplaza renglones y deja el ticket pendiente para revision.
- `enviar-alerta-email` — Resend para alertas criticas.
- Deploy: via Supabase MCP `deploy_edge_function` (no hay token para el CLI de supabase).

## Cambios 2026-06-08 — pulido Tickets + IA + Entradas
- `/admin/tickets` queda como centro de revision: muestra chips de alerta, permite editar encabezado, editar/agregar/borrar renglones, ensenar sinonimos/equivalencias, confirmar, rechazar, eliminar y relanzar IA.
- `/admin/alertas` se quita del nav. La tabla `alertas_tickets` sigue como backend de senales, pero el admin ya no debe operar desde una pantalla separada.
- IA: se sube calidad de imagen movil a 2400px/JPEG 0.86; Gemini conserva descripcion literal y usa catalogo solo para categoria/unidad.
- IA: se detiene auto-aprendizaje de productos desde lecturas crudas. Producto nuevo queda pendiente para que el admin lo confirme desde Tickets, evitando contaminar catalogo.
- Duplicados exactos: ahora crean registro `rechazado` con alerta `duplicado`, para que aparezcan auditables en Tickets.
- `sin_fecha`: si Gemini no lee fecha valida se usa fecha de subida, se marca `_fecha_asumida` y se genera alerta para revisar.
- Entradas/Dashboard/Excel: unidades base se muestran siempre. Si no hay equivalencia, se usa identidad 1:1 con el nombre del producto (ej. `7 Pan de Nutella`).
- Nueva funcion `reprocesar-ticket`: segunda pasada manual, reemplaza renglones actuales, resuelve alertas previas y genera nuevas senales.
- Verificado local: `node --test frontend/lib/units.test.mjs` OK; `npm run build` OK; `http://localhost:3000/admin/tickets` responde 200 en dev.
- Pendiente de despliegue: Supabase CLI no tiene `SUPABASE_ACCESS_TOKEN` y `db push --linked` no ve link activo. Aplicar migracion 022 y desplegar `procesar-ticket` + `reprocesar-ticket` desde Supabase MCP/Dashboard o con `supabase login`.

## Auditoria Codex 2026-06-08
- Verificacion local: `npm run build` en `/frontend` termino OK con Next 14.2.29 y genero 18 rutas.
- `CLAUDE.md` estaba desfasado vs este archivo: migraciones 001-013, Gemini 1.5 en env vars y estructura sin funciones nuevas. Se sincronizo junto con `AGENTS.md`.
- Deuda detectada: `/sucursal/[slug]/subir/page.tsx` conserva estados `review/confirming`, `ticketData`, `registroId` y llamada a `confirmar-ticket`, pero el flujo actual async nunca llena esos estados. No rompe build, pero conviene limpiarlo o decidir si se revive review del gerente.
- Deuda detectada: `confirmar-ticket` queda como funcion legacy para confirmacion manual del gerente. El camino admin usa `confirmar-admin`. Antes de desplegar cambios, decidir si se mantiene por compatibilidad o se retira del frontend/backend.
- Riesgo a revisar en produccion: `procesar-ticket` hace auto-confirmacion en background; si falla mover archivo o Sheets, el error es non-blocking/solo log. Validar que el admin vea claramente tickets limpios que no llegaron a Sheets si ocurre una falla externa.
- Riesgo a revisar en datos: los descuentos entran como monto negativo y dashboard netea gasto operativo. Confirmar con usuarios si quieren ver ahorro separado por sucursal/periodo en Tickets, Excel y Sheets, no solo en Dashboard.

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

## Cambios 2026-06-07 — descuentos + scope "Todas"
- **Descuentos** (categoría operativa global + producto, migración 021; procesar-ticket v25):
  la IA captura descuentos/promos como renglón con monto NEGATIVO (categoría "Descuentos") →
  resta del gasto operativo (dinero ahorrado). Dashboard: gasto operativo neto, dona usa solo
  gasto positivo, tarjeta "Ahorro (descuentos)".
- **Fix scope "Todas"**: Catálogo/Cerebro/Comercios mostraban solo lo global → ahora "Todas"
  muestra todas las sucursales. Antes los productos por-sucursal quedaban invisibles.
- **Fix aprendizaje en Tickets/Editar**: ahora crea/liga el producto (antes quedaba en limbo).
  Migración 020: backfill de 36 renglones en limbo (ej. hielo).
- procesar-ticket en **v25**.

## Cambios 2026-06-06 (b) — más desglose y correcciones
- Dashboard: tabla "En dónde se gasta (comercios)" (tickets, gasto, % del total).
- Reporte (Excel): columna "Precio unitario prom." por producto.
- Entradas: columna Categoría (en tabla y CSV).
- Alertas: contador "Cambio de precio".
- Fix: borrar producto del catálogo desligaba mal (FK NO ACTION) → ahora desliga renglones
  primero y verifica el error (antes fallaba en silencio y reaparecía al recargar).

## Cambios 2026-06-06 — pulido y precisión
- **Matcher de productos preciso** (procesar-ticket v24 + catalog.ts): sinónimos/nombres de <4
  chars (gas, 1, ala) solo coinciden EXACTO; el match por palabra es por token completo, no
  substring. Antes "gas" o "1" como sinónimo arrastraba renglones equivocados. Datos limpiados.
- **Sinónimos al renombrar**: en la revisión, lo que leyó la IA originalmente queda como sinónimo
  del producto final aunque solo renombres (no solo al "vincular"). Dedup case-insensitive.
- **Reporte (Excel) multi-hoja** en dashboard: Resumen, Categorías, Comercios, Productos, Detalle.
- **Catálogo**: renombrar producto (el nombre viejo → sinónimo) + equivalencias.
- **Cerebro liga**: forzar categoría de comercio; equivalencia al ligar contenedores.
- **Tickets**: botón "Confirmar ticket" para pendientes (los empuja al arqueo + resuelve alertas).
- **Precios/Entradas** leen la fuente real (renglones confirmados) → muestran TODO.
- Se elimina la página `/admin/huerfanos` (ahora viven en el Cerebro). Nav: Entradas (antes Inventario).
- Pendiente conocido: `consumo_inventario` (migración 019) quedó sin UI tras renombrar a Entradas;
  disponible para una futura pantalla de stock real.

## Cambios 2026-06-05 (b) — precios visibles, inventario y pulido
- **procesar-ticket v23**: alerta de precio compara vs PROMEDIO de hasta 5 compras previas,
  requiere ≥2 registros y misma unidad (menos falsos positivos).
- **confirmar-admin v2**: registra precio de renglones ligados durante la revisión.
- **/admin/precios**: último precio, anterior, variación %; fila expandible con mini-gráfica.
- **/admin/inventario** (migración 019): unidades base compradas − consumo manual = disponible.
- **Dashboard**: unidades base por equivalencia en "Productos más comprados".
- **Cerebro**: buscadores por columna + ligado masivo de huérfanos.
- Nav admin: + Precios, + Inventario.

## Cambios 2026-06-05 (Cerebro completo + precios)
- **procesar-ticket v22**: registra precio unitario por renglón (precio_historial),
  detecta saltos >40% vs referencia → alerta `precio_anomalo`. Liga total a producto en
  notas de un solo renglón. Subida múltiple con reintentos + progreso.
- **Nuevas pantallas admin**: `/admin/huerfanos` (cola sin categoría, RPC ligar_huerfano con
  back-fill) y `/admin/cerebro` (tablero de 3 paneles ligados Comercios/Categorías/Productos
  con resaltado cruzado, ligar huérfanos, mover producto).
- **Catálogo**: borrar categoría con reasignación; editar producto (mover categoría, unidad,
  sinónimos) y **equivalencias** (1 unidad contiene X de Y).
- **Revisión de alertas**: precio/cantidad editables, vincular renglón a producto existente
  (el texto mal leído queda como sinónimo), guardado con feedback + renglón listo se colapsa.
- **Tickets**: editar renglones de cualquier ticket; filtro por comercio; lista por fecha de subida.
- **Dashboard**: filtro por artículo, tarjeta "Auto-clasificado %", split operativo/no operativo.
- Migraciones 017 y 018. PLAN_CEREBRO.md: todas las fases 0–7 ✅.

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
- Siguiente sesion de pulido: revisar primero deuda `confirmar-ticket`/pantalla review legacy, visibilidad de fallas Sheets y UX movil de subida multiple.
- Re-aprender comercio al confirmar desde Alertas (que las correcciones del admin refuercen el mapa comercio→categoria).
- Marcar esquinas de la foto para recortar ruido a Gemini (opcional; 2.5-flash lee bien).
- markitdown (Microsoft): util solo si suben PDFs/facturas digitales, no para fotos.
- Decidir si se elimina el flujo legacy `confirmar-ticket` del gerente o si se revive una pantalla de review manual antes de confirmar.
