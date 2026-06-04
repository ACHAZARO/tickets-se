# PROJECT_STATE.md -- Revision de Tickets

> Estado vivo del proyecto. Actualizar al cerrar cada sesion.

---

## Estado general: EN DESARROLLO

### Ultima sesion: 2026-06-02
- Setup completo: Git, GitHub, Vercel, Supabase, Google Cloud
- Google Sheets integration implementada en confirmar-ticket
- 3 Edge Functions desplegadas y activas
- 4 Supabase Secrets configurados (JWT_SECRET, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEETS_ID)
- Buckets de storage creados (por-revisar, archivo)
- Datos de prueba insertados (sucursal-centro, PIN 1234)
- Fix: verificar_pin search_path para pgcrypto en schema extensions
- Documentacion del proyecto creada (CLAUDE.md, PROJECT_STATE.md)

---

## Que esta LISTO

### Infraestructura
- [x] Repo GitHub (`ACHAZARO/tickets-se`, privado)
- [x] Supabase proyecto `tickets-se` (ref: dlmqqmvrgkilptawllep)
- [x] Schema SQL aplicado (001_initial_schema: 4 tablas + RLS + verificar_pin)
- [x] Vercel proyecto `tickets-se` (URL: tickets-se.vercel.app)
- [x] Vercel env vars configuradas (production)
- [x] Google Cloud proyecto `tickets-se` con Sheets API + Drive API
- [x] Service account `tickets-sheets@tickets-se.iam.gserviceaccount.com`
- [x] Spreadsheet creado y compartido (ID: 1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao)
- [x] Tab `2026-06` con headers configurados

### Codigo
- [x] Frontend scaffold (Next.js 14, Tailwind, dark theme, mobile-first)
- [x] Pagina PIN auth (`/sucursal/[slug]`)
- [x] Pagina subir ticket (`/sucursal/[slug]/subir`) con estados: idle/preview/processing/review/confirming/done/error
- [x] Edge Function `verificar-pin` (rate limiting, JWT session)
- [x] Edge Function `procesar-ticket` (Gemini 1.5 Flash, SHA-256 dupes, Storage upload)
- [x] Edge Function `confirmar-ticket` (Google Sheets append, archivo de imagen)
- [x] Modulo `_shared/google-sheets.ts` (JWT RS256, auto-create tabs, append rows)
- [x] Modulo `_shared/cors.ts`
- [x] Columnas corregidas: storage_path_original, gemini_raw (match con schema)

---

## Que FALTA

### Critico (bloquea uso real)
- [x] Configurar Supabase Secrets (JWT_SECRET, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEETS_ID)
- [x] Desplegar Edge Functions a Supabase (3 funciones activas)
- [x] Crear buckets de Storage (`por-revisar`, `archivo`)
- [x] Insertar datos de prueba (sucursal-centro + Gerente Prueba, PIN: 1234)
- [x] Fix: verificar_pin search_path (pgcrypto en schema `extensions`, no `public`)
- [ ] Testing end-to-end del flujo completo

### Importante (pre-produccion)
- [ ] Vercel env vars para preview/development (bug en CLI v52 con preview envs)
- [ ] Generar QR codes para sucursales
- [ ] Validacion de frontend: mapear correctamente campos entre frontend y edge functions
- [ ] Revisar que el frontend envie Authorization header con JWT (actualmente no lo hace)

### Nice to have
- [ ] PWA manifest para instalacion en home screen
- [ ] Notificaciones de error mas descriptivas
- [ ] Dashboard de tickets procesados
- [ ] Exportar reporte mensual

---

## Decisiones tecnicas

| Decision | Razon | Fecha |
|---|---|---|
| next.config.mjs en vez de .ts | Next.js 14 no soporta .ts config | 2026-06-02 |
| Google Sheets error non-blocking | El ticket debe confirmarse aunque Sheets falle | 2026-06-02 |
| Service account (no OAuth user) | No requiere login del usuario, funciona server-side | 2026-06-02 |
| Session en sessionStorage | Mas simple que Supabase Auth para este caso (PIN, no email) | 2026-06-02 |
| SHA-256 hash para dupes | Deteccion de duplicados por contenido de imagen | 2026-06-02 |

---

## Errores encontrados y resueltos

| Error | Solucion | Fecha |
|---|---|---|
| Vercel build: "next.config.ts not supported" | Renombrar a next.config.mjs | 2026-06-02 |
| Vercel CLI v52: preview env vars piden branch | Solo configuramos production por ahora | 2026-06-02 |
| gcloud default scopes bloqueados para Sheets | Crear spreadsheet manualmente, compartir con SA | 2026-06-02 |
| PowerShell 5.1: ImportPkcs8PrivateKey no existe | Usar Node.js para operaciones con RSA keys | 2026-06-02 |
| Schema vs codigo: storage_path vs storage_path_original | Corregido en procesar-ticket y confirmar-ticket | 2026-06-02 |

---

## Fase 1 Backend — COMPLETADA (2026-06-03)

Todo en branch `feat/fase1-backoffice-backend`:
- [x] 4 tablas nuevas: categorias_gasto, catalogo_productos, alertas_tickets, presupuestos
- [x] 3 columnas nuevas en registros_tickets: folio_ticket, unidad, categoria_id
- [x] 6 categorias iniciales seeded
- [x] Modulo catalog.ts: loader + prompt builder + product matcher
- [x] procesar-ticket mejorado: catalogo como contexto Gemini, folio, unidad, confianza, 3 capas anti-duplicados, alertas automaticas
- [x] confirmar-ticket: tabs por sucursal+mes, columnas folio y unidad
- [x] Supabase Auth: admin user + RLS policies para tablas backoffice
- [x] enviar-alerta-email: notificaciones via Resend para alertas criticas
- [x] 4 edge functions desplegadas y activas

## Fase 2 Admin Panel — COMPLETADA (2026-06-03)

Todo en branch `feat/fase2-admin-panel` (mergeada Fase 1 a main antes de iniciar):
- [x] Task 10: Login admin (`/admin/login`) + auth guard client-side + layout con nav (bc55f34)
- [x] Task 11: Dashboard de alertas (`/admin/alertas`) con contadores, filtros y lista con thumbnails (871d45b)
- [x] Task 12: Detalle de alerta (`/admin/alertas/[id]`) con foto, correccion de datos, aprobar/rechazar y alta al catalogo (3e68d1e)
- [x] Task 13: Catalogo de productos (`/admin/catalogo`) — tabla editable con alta, edicion en panel, busqueda y toggle activo (7ea3ee0)
- Auth: Supabase Auth client-side (sessionStorage del SDK), single admin user. Sin @supabase/ssr.
- Typecheck (tsc --noEmit) limpio en todo el frontend.
- Deploy a produccion verificado: /admin/login, /admin/alertas, /admin/catalogo responden 200.

## Fix infra deploy (2026-06-03)
- El proyecto Vercel NUNCA estuvo conectado a Git: todos los deploys eran manuales por CLI desde frontend/. El CLAUDE.md asumia auto-deploy que no existia.
- Conectado `vercel git connect` a `ACHAZARO/tickets-se`, production branch `main`.
- Seteado `rootDirectory: frontend` via API (monorepo: el Next.js no esta en la raiz). Sin esto, los builds por Git push fallarian al buildear desde la raiz del repo.
- Remote local corregido: owner en mayusculas `ACHAZARO` (antes `achazaro` daba aviso "repository moved" 301).

## Fase 3 Auditoria de costos — COMPLETADA (2026-06-03)

En `main` (commits 3d8ce11, e890194). Spec en docs/superpowers/specs/2026-06-03-fase3-auditoria-costos-design.md.
Concepto: NO es presupuesto plano — el gasto esperado es % de la venta. Auditoria
(arqueo) semanal/mensual: gasto real de tickets confirmados vs ventas.
- [x] Migracion 008: tablas `ventas` (mensual por sucursal) y `objetivos_costo` (% por categoria), RLS admin.
- [x] `lib/arqueo.ts`: logica pura (prorrateo de ventas por dias en rango libre, % por categoria, semaforo). Verificada con casos.
- [x] `/admin/dashboard`: arqueo con selector mes/rango libre, filtro sucursal, tarjetas, tabla con semaforo, dona (conic-gradient) y tendencia 6 meses (SVG/CSS, sin libreria de charts). Export a Excel (SheetJS, import dinamico).
- [x] `/admin/ventas`: captura manual mensual por sucursal, copiar mes anterior.
- [x] `/admin/objetivos`: % objetivo de costo por categoria.
- [x] Nav actualizado, /admin -> /admin/dashboard. Build limpio, deploy auto verificado (rutas 200).
- Modelo de periodo A+C: ventas mensuales (robusto) + selector de rango libre con venta prorrateada (marcada "estimada").
- Ventas hoy: captura manual. POS pendiente de explorar (no cambia el modelo).
- Datos de prueba sembrados en prod (junio 2026, marcados TEST/_test): 3 tickets confirmados, venta 30000, 3 objetivos. Borrables.

## Admin de sucursales/empleados — COMPLETADO (2026-06-04)

En `main` (commit e74d040). Migracion 009.
- [x] `/admin/sucursales`: CRUD de sucursales (nombre, slug auto-generado, direccion, toggle activa).
- [x] Enlace copiable (`/sucursal/{slug}`) y QR descargable (lib `qrcode`) por sucursal.
- [x] Gestion de empleados por sucursal: alta/edicion (nombre + PIN + activo).
- [x] Migracion 009: RLS admin para sucursales/empleados/sucursal_empleados + RPC
  `admin_guardar_empleado` (SECURITY DEFINER, hashea PIN con pgcrypto). Verificado:
  bcrypt OK bajo authenticated, anon recibe permission denied.
- Nav admin actualizado con "Sucursales".

## Fix login admin (2026-06-04)
- Usuario alepolch@gmail.com no podia entrar. Causa doble (creado por SQL directo):
  (1) faltaba registro en `auth.identities` (provider email); (2) columnas de token
  (`email_change`, `confirmation_token`, etc.) en NULL — GoTrue truena al convertir
  NULL->string ("Database error querying schema"). Arreglado: identity insertada +
  columnas puestas en ''. Login verificado OK contra /auth/v1/token.
- LECCION: crear usuarios admin desde Supabase Dashboard / Admin API, NO por SQL directo.

## PENDIENTE GRANDE: Multi-producto + auto-categorizacion IA
Spec completo en docs/superpowers/specs/2026-06-04-multiproducto-ia-design.md (APROBADO).
Casi todos los tickets son multi-producto; el diseno actual (1 producto/ticket) es inservible.
Refactor profundo: tabla `ticket_items`, prompt Gemini multi-item + auto-categoria, alerta
solo por excepciones, revision por renglon + enseñar sinonimos, Sheets 1 fila/item, dashboard
desde ticket_items. Hacer por capas. Incluye feature C (CRUD de categorias, pieza chica).

## Multi-producto + IA robusta — IMPLEMENTADO (2026-06-04)

En `main`. Spec: docs/superpowers/specs/2026-06-04-multiproducto-ia-design.md.
- [x] Migracion 010: tabla `ticket_items` (renglones). registros_tickets = encabezado.
- [x] procesar-ticket (v13): prompt multi-item, auto-categoriza cada renglon, inserta N
  ticket_items, alerta SOLO por excepciones. Deriva sucursal/empleado del JWT. Parsing robusto.
- [x] confirmar-ticket + google-sheets: una fila por item en el Sheet.
- [x] Frontend subir: ARREGLADO el contrato roto con el backend (mandaba sin token y con
  campos viejos). Ahora manda Authorization Bearer con session_token, solo imagen, confirma
  con registro_id. Muestra lista de renglones. PIN page ahora guarda session_token.
- [x] dashboard arqueo: gasto por categoria desde ticket_items.
- [x] /admin/alertas/[id]: revision por renglon (corrige categoria/unidad, ensena sinonimos).
- [x] /admin/categorias: CRUD de categorias (feature C).
- Migracion 009 ya existia (sucursales/empleados).

### BLOQUEO CRITICO: Gemini requiere billing
- gemini-1.5-flash fue RETIRADO por Google (404). El codigo usa gemini-2.0-flash, configurable
  via secret `GEMINI_MODEL` (cambiar sin redeploy).
- La API key de Gemini da 429 "free tier limit: 0" -> el proyecto Google NO tiene cuota free.
  **ACCION DEL USUARIO**: habilitar billing en el proyecto Google de la GEMINI_API_KEY (o usar
  una key con cuota). Sin esto, Gemini no procesa (el codigo NO falla: marca ilegible + item de
  respaldo). En cuanto haya billing, todo el flujo funciona sin tocar codigo.
- Edge functions deben tener verify_jwt=false (usan JWT propio HMAC). Ya configurado.

## Proxima sesion debe

1. (USUARIO) Habilitar billing de Gemini y probar subida real de un ticket multi-producto.
2. Test E2E en navegador con login admin real (alepolch@gmail.com): dashboard, capturar venta, fijar objetivos, exportar Excel, crear sucursal/empleado, descargar QR.
2. Borrar datos de prueba (TEST / gemini_raw._test=true) cuando ya no se necesiten.
3. Explorar integracion POS para ventas (hoy es captura manual).
4. Test E2E del flujo completo de subida (frontend -> edge functions -> sheets).
5. Generar QR codes para sucursales.
6. (Opcional) Presets rapidos de periodo (esta semana, etc.) y captura de ventas semanal si se requiere arqueo intra-mes.
