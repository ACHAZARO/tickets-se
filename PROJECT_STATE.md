# PROJECT_STATE.md -- Revision de Tickets

> Estado vivo del proyecto. Actualizar al cerrar cada sesion.

---

## Estado general: EN DESARROLLO

### Ultima sesion: 2026-06-02
- Setup completo: Git, GitHub, Vercel, Supabase, Google Cloud
- Google Sheets integration implementada en confirmar-ticket
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
- [ ] Configurar Supabase Secrets (JWT_SECRET, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEETS_ID)
- [ ] Desplegar Edge Functions a Supabase
- [ ] Crear buckets de Storage (`por-revisar`, `archivo`)
- [ ] Insertar datos de prueba (sucursal + empleado con PIN)
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

## Proxima sesion debe

1. Completar configuracion de Supabase secrets
2. Desplegar las 3 edge functions
3. Crear buckets de storage
4. Insertar datos de prueba
5. Test end-to-end del flujo completo
