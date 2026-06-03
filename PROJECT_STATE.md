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

## Proxima sesion debe

1. Merge branch feat/fase1-backoffice-backend a main
2. Fase 2: Web /admin (login, dashboard alertas, correccion tickets, catalogo)
3. Fase 3: Google Sheets dashboard con graficos y presupuestos
4. Configurar Resend API key cuando se cree cuenta
5. Test E2E del flujo completo (frontend -> edge functions -> sheets)
