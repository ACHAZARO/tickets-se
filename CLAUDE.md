# Revision de Tickets -- CLAUDE.md

## Descripcion
Web app movil para que gerentes de restaurantes (Santa Elena) suban fotos de tickets de gastos operacionales. Backend en Edge Functions (Deno) procesa imagenes con Gemini 1.5 Flash y vuelca los datos a Google Sheets.

## Stack
- **Frontend**: Next.js 14 (Vercel), optimizado para movil
- **DB + Storage**: Supabase (`tickets-se`, ref: `dlmqqmvrgkilptawllep`)
- **Backend IA**: Supabase Edge Functions (Deno/TypeScript) + Gemini 1.5 Flash
- **Destino datos**: Google Sheets API (service account)
- **Repo**: GitHub `ACHAZARO/tickets-se`, monorepo (`/frontend` + `/backend`)

---

## Estructura del proyecto

```
revision de tickets/
+-- CLAUDE.md                          <- ESTE ARCHIVO (guia principal)
+-- PROJECT_STATE.md                   <- estado vivo del proyecto
+-- .gitignore
|
+-- frontend/                          <- Next.js app (Vercel)
|   +-- app/
|   |   +-- layout.tsx                 # Layout global (dark theme)
|   |   +-- page.tsx                   # Landing "/" (redirige o home)
|   |   +-- globals.css                # Tailwind + custom
|   |   +-- sucursal/
|   |       +-- [slug]/
|   |           +-- page.tsx           # PIN auth -> verificar-pin
|   |           +-- subir/
|   |               +-- page.tsx       # Captura + review + confirmar
|   +-- lib/
|   |   +-- supabase.ts               # Cliente Supabase (anon key)
|   +-- .env.local                     # NUNCA commitear
|   +-- .env.local.example             # Template de env vars
|   +-- next.config.mjs                # Config Next.js (.mjs, NO .ts)
|   +-- package.json
|   +-- tailwind.config.ts
|   +-- tsconfig.json
|
+-- backend/                           <- Edge Functions (Deno)
|   +-- supabase/
|       +-- functions/
|           +-- _shared/
|           |   +-- cors.ts            # Headers CORS compartidos
|           |   +-- google-sheets.ts   # Auth SA + append a Sheets
|           +-- verificar-pin/
|           |   +-- index.ts           # POST {slug, pin} -> JWT sesion
|           +-- procesar-ticket/
|           |   +-- index.ts           # POST multipart -> Gemini -> DB
|           +-- confirmar-ticket/
|               +-- index.ts           # POST {registro_id} -> Sheets + archivo
|
+-- supabase/
|   +-- migrations/
|       +-- 001_initial_schema.sql     # Schema completo (4 tablas + RLS)
|
+-- scripts/                           <- Scripts de setup (no produccion)
    +-- create-sheet.js                # Crear spreadsheet (no usado)
    +-- setup-sheet.js                 # Configurar headers del sheet
```

---

## Servicios externos y credenciales

### Supabase
| Campo | Valor |
|---|---|
| Proyecto | tickets-se |
| Ref | `dlmqqmvrgkilptawllep` |
| Region | us-east-1 |
| Plan | Pro |
| URL | `https://dlmqqmvrgkilptawllep.supabase.co` |
| Edge Functions | `https://dlmqqmvrgkilptawllep.functions.supabase.co` |

### Vercel
| Campo | Valor |
|---|---|
| Proyecto | tickets-se |
| Team | achazaros-projects (`team_vuQfWgevRwXGKr6Jq5IAHt41`) |
| URL produccion | `https://tickets-se.vercel.app` |
| Root directory | `./frontend` |

### Google Cloud
| Campo | Valor |
|---|---|
| Proyecto GCP | tickets-se (ID: `606044108682`) |
| Service Account | `tickets-sheets@tickets-se.iam.gserviceaccount.com` |
| APIs habilitadas | Sheets API, Drive API |
| Spreadsheet ID | `1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao` |

### GitHub
| Campo | Valor |
|---|---|
| Repo | `ACHAZARO/tickets-se` (privado) |
| Branch principal | `main` |

---

## Base de datos (schema)

### Tablas
- **`sucursales`** -- slug URL-safe para QR/rutas. RLS: lectura publica de sucursales activas.
- **`empleados`** -- PIN hasheado con bcrypt (pgcrypto). Nunca texto plano.
- **`sucursal_empleados`** -- relacion N:M entre sucursales y empleados.
- **`registros_tickets`** -- auditoria completa + campos Gemini + hash anti-dupes + `sheets_row_id`.

### Columnas clave de `registros_tickets`
| Columna | Tipo | Uso |
|---|---|---|
| `storage_path_original` | TEXT | Ruta en bucket `por-revisar` |
| `storage_path_archivo` | TEXT | Ruta en bucket `archivo` (post-confirmacion) |
| `gemini_raw` | JSONB | Respuesta completa del modelo |
| `hash_imagen` | TEXT | SHA-256 para deteccion de duplicados |
| `estado` | TEXT | `pendiente` -> `confirmado` / `rechazado` / `archivado` |
| `sheets_row_id` | TEXT | Rango de fila insertada en Google Sheets |

### Funcion SQL
`verificar_pin(p_slug, p_pin)` -- SECURITY DEFINER, valida PIN sin exponer logica al cliente. Retorna `empleado_id` (UUID) o NULL.

### Buckets de Storage
- **`por-revisar`** -- imagenes recien subidas, pendientes de confirmacion
- **`archivo`** -- imagenes confirmadas, organizadas por `YYYY-MM/`

---

## Flujo principal (happy path)

```
1. Gerente escanea QR -> /sucursal/[slug]
2. Ingresa PIN -> Edge Function verificar-pin -> JWT sesion (1hr)
3. Toma foto del ticket -> preview en pantalla
4. "Procesar ticket" -> Edge Function procesar-ticket:
   a. Sube imagen a Storage (por-revisar)
   b. SHA-256 -> deteccion de duplicados
   c. Gemini 1.5 Flash extrae: fecha, comercio, producto, cantidad, monto, categoria
   d. Inserta en registros_tickets (estado: pendiente)
   e. Retorna datos extraidos al frontend
5. Gerente revisa datos -> "Confirmar y guardar"
6. Edge Function confirmar-ticket:
   a. Mueve imagen: por-revisar -> archivo/YYYY-MM/
   b. Append fila a Google Sheets (pestana del mes)
   c. Actualiza registro: estado=confirmado, sheets_row_id
7. Pantalla de exito -> puede subir otro ticket
```

---

## Edge Functions -- env vars requeridos

Configurados como Supabase Secrets (`npx supabase secrets set`):

| Variable | Descripcion |
|---|---|
| `SUPABASE_URL` | Auto-provisto por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provisto por Supabase |
| `JWT_SECRET` | Secret para firmar/verificar tokens de sesion (HMAC SHA-256) |
| `GEMINI_API_KEY` | API key de Google AI Studio para Gemini 1.5 Flash |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON completo de la service account key |
| `GOOGLE_SHEETS_ID` | `1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao` |

---

## Convenciones de codigo

### Edge Functions (Deno)
- Imports desde URLs (deno.land, esm.sh) -- NO `npm:`
- TypeScript estricto, sin `any` explicitos
- CORS headers en `_shared/cors.ts` -- incluir en TODAS las respuestas
- Errores de Google Sheets son **non-blocking**: el ticket se confirma aunque Sheets falle
- Siempre validar JWT de sesion antes de operar

### Frontend (Next.js)
- Next.js 14 con App Router
- Config en `next.config.mjs` (NO `.ts` -- Next 14 no lo soporta)
- Tailwind CSS, dark theme por defecto
- Optimizado para movil (dvh, safe-area, touch targets)
- Session en `sessionStorage` (no cookies, no Supabase Auth)
- Componentes en `/app` (no `/components` separado por ahora)

### Git
- Commits en espanol o ingles, conventional commits
- NUNCA `git add .` -- siempre paths especificos
- NUNCA force-push, NUNCA `--no-verify`
- NUNCA commitear `.env.local` ni keys de service account

---

## Skills disponibles (ya instaladas)

### Para este proyecto
| Skill | Cuando usarla |
|---|---|
| `superpowers:systematic-debugging` | Bugs en edge functions o frontend |
| `superpowers:verification-before-completion` | Antes de cerrar cualquier feature |
| `superpowers:brainstorming` | Antes de disenar features nuevas |
| `superpowers:writing-plans` | Tareas multi-paso |
| `superpowers:executing-plans` | Seguir un plan aprobado |
| `code-review` | Despues de cambios significativos |
| `session-budget` | Tareas largas o autonomas (/loop) |
| `frontend-design` | Redisenos grandes de UI |
| `anthropic-skills:pdf` / `xlsx` | Si necesitan reportes |
| `vercel:deploy` / `vercel:status` | Problemas de deployment |

### NO usar en este proyecto
- `gws-*` -- No usamos Google Workspace directamente
- `ruflo-*` -- Over-engineering
- `checkpro-codex` -- Solo para CheckPro
- `wings-palace` -- Solo para Wings Palace

---

## Workflow de sesion

### Al iniciar
1. Lee este `CLAUDE.md`
2. Lee `PROJECT_STATE.md` para ver el estado actual
3. Identifica la tarea y el area afectada (frontend/backend/schema)

### Durante el trabajo
- Commits frecuentes con mensajes descriptivos
- Push a GitHub despues de cada commit significativo
- Si cambias schema: crear nueva migracion SQL
- Si cambias edge functions: desplegar con `npx supabase functions deploy <nombre>`
- Si cambias frontend: Vercel auto-deploya desde GitHub

### Al cerrar sesion (OBLIGATORIO)
1. **Actualiza `PROJECT_STATE.md`** con:
   - Que se hizo
   - Que quedo pendiente
   - Decisiones tecnicas tomadas
   - Errores encontrados y como se resolvieron
2. **Commit y push** de los cambios a GitHub
3. **Guarda memoria** si hubo decisiones no-obvias

---

## Compatibilidad con Codex CLI

Este proyecto puede trabajarse desde Codex CLI. Consideraciones:

### Codex puede
- Leer/editar archivos del frontend y backend
- Correr `npm` commands en `/frontend`
- Correr `git` commands
- Leer este CLAUDE.md y PROJECT_STATE.md

### Codex NO puede
- Ejecutar Supabase MCP tools (usar CLI en su lugar)
- Ejecutar Vercel MCP tools (usar CLI: `npx vercel`)
- Abrir navegador para OAuth flows
- Acceder a secrets de Supabase directamente

### Comandos CLI equivalentes para Codex

```bash
# Supabase
npx supabase functions deploy verificar-pin --project-ref dlmqqmvrgkilptawllep
npx supabase functions deploy procesar-ticket --project-ref dlmqqmvrgkilptawllep
npx supabase functions deploy confirmar-ticket --project-ref dlmqqmvrgkilptawllep
npx supabase migration new <nombre>
npx supabase db push --project-ref dlmqqmvrgkilptawllep

# Vercel (desde /frontend)
cd frontend && npx vercel --prod

# Google Sheets (no hay CLI, usar scripts/setup-sheet.js como referencia)
```

### Archivos que Codex debe leer primero
1. `CLAUDE.md` (este archivo)
2. `PROJECT_STATE.md`
3. El archivo especifico que va a editar

---

## Migraciones aplicadas
- `001_initial_schema` -- 4 tablas, RLS, funcion `verificar_pin`, triggers `updated_at`

---

## Notas tecnicas importantes

1. **`next.config.mjs`** -- Next.js 14 NO soporta `.ts`. Usar `.mjs`.
2. **`date_trunc` no es IMMUTABLE** -- filtrar por mes con rangos explicitos, no con funciones.
3. **SHA-256 anti-dupes** -- campo `hash_imagen` en `registros_tickets`.
4. **Google Sheets tabs** -- se crean automaticamente por mes (`2026-06`). El codigo en `_shared/google-sheets.ts` maneja la creacion.
5. **Rate limiting** -- `verificar-pin` tiene rate limit en memoria (5 intentos/minuto por slug). Se resetea en cold start.
6. **RLS** -- activo en todas las tablas. Solo `sucursales` tiene policy publica de lectura. Todo lo demas requiere service_role.

---

**Ultima actualizacion:** 2026-06-02
