---
name: multiproducto-gemini
description: Multi-producto por ticket implementado; Gemini bloqueado por billing y modelo 1.5 retirado
metadata: 
  node_type: memory
  type: project
  originSessionId: c8978e0f-c3d2-4712-b7ef-121c5899992d
  modified: 2026-09-18T17:20:48.284Z
---

**Multi-producto (2026-06-04):** los tickets traen varios renglones. Implementado:
tabla `ticket_items` (migracion 010), procesar-ticket extrae lista y auto-categoriza
cada renglon, alerta solo por excepciones (sin_categoria/sin_unidad). confirmar-ticket
manda 1 fila/item a Sheets. Frontend subir muestra lista; dashboard arqueo suma desde
ticket_items; /admin/alertas/[id] corrige por renglon + ensena sinonimos; /admin/categorias CRUD.

**Bug del contrato frontend-backend (estaba roto desde siempre):** la PIN page descartaba
el `session_token` de verificar-pin, asi que subir llamaba a procesar-ticket SIN auth y con
campos viejos (slug/empleadoId en vez de imagen + Bearer). Arreglado: PIN guarda session_token,
subir manda Authorization Bearer y solo imagen, confirma con registro_id. procesar-ticket
deriva sucursal/empleado del JWT (no confia en el cliente).

**Gemini FUNCIONANDO (resuelto, verificado E2E):**
- `gemini-1.5-flash` RETIRADO (404); `gemini-2.0-flash` da 429 "free tier limit: 0".
  SOLUCION: fallback de modelos en procesar-ticket. gemini-2.5-flash tiene cuota free.
  **CORRECCION 2026-09-18: el tier gratis NO alcanza** (~20-25 lecturas/dia por modelo). Ver
  [[gemini-cuota-rafagas]]. Override con secret `GEMINI_MODEL`.
- Edge functions verify_jwt=false (JWT HMAC propio). Deploy via MCP deploy_edge_function
  (no hay token CLI). Imagen->base64 con encodeBase64 de Deno std (no String.fromCharCode).

**Arquitectura ASYNC (2026-06-04):** procesar-ticket responde {recibido:true} al instante y
procesa con Gemini en segundo plano via `EdgeRuntime.waitUntil()`. Auto-confirma tickets
limpios (archivo + Sheets + estado confirmado); deja 'pendiente' los que generan alerta.
Gerente solo ve "¡Enviado! Gracias". subir soporta varias fotos. Esto elimino el "stuck
en procesando" y es lo que el usuario pidio.

**Todo el admin opera POR SUCURSAL (2026-06-04):** selector global de sucursal en el header
(contexto en frontend/lib/sucursal-context.tsx, persistido en localStorage) que filtra TODAS
las secciones. Dashboard/Tickets/Alertas/Objetivos filtran por la sucursal activa. Categorias
y catalogo tienen sucursal_id (NULL=global): el admin y la IA cargan global + de la sucursal.
Migracion 013. loadCatalog(sucursalId) en catalog.ts. Nueva pantalla /admin/tickets (lista con
foto via URLs firmadas + descarga ZIP del periodo). Buckets privados -> createSignedUrl
(migracion 011). pg_cron borra imagenes +1 año (migracion 012). Modelo fijado gemini-2.5-flash.

[[fase3_arqueo_modelo]] [[vercel_git_deploy]]
