# Revision de Tickets -- AGENTS.md

## Descripcion
Web app movil para que gerentes de restaurantes (Santa Elena) suban fotos de tickets de gastos operacionales. Backend en Edge Functions (Deno) procesa imagenes con Gemini (vision) **en segundo plano**, extrae **multiples productos por ticket**, auto-categoriza cada renglon y vuelca los datos a Google Sheets. Un admin web audita el costo vs ventas **por sucursal**.

> **Estado vivo y "como funciona al momento": ver `PROJECT_STATE.md`.** Este archivo es la guia estable; PROJECT_STATE tiene el detalle actualizado del flujo, tablas y secciones del admin.

## Colaboracion Claude + Codex
- Claude y Codex trabajan sobre el mismo repo local. Antes de cambiar codigo, ambos deben leer `CLAUDE.md`/`AGENTS.md`, `PROJECT_STATE.md` y el archivo especifico a tocar.
- `CLAUDE.md` y `AGENTS.md` deben mantenerse sincronizados en instrucciones estables. `PROJECT_STATE.md` manda para el estado vivo, hallazgos recientes, pendientes y decisiones.
- Codex puede encargarse de auditorias locales, builds, ediciones y verificacion en el workspace. Claude puede continuar desde estos documentos sin asumir memoria externa.
- Si un agente encuentra deuda o bugs sin corregir en la sesion, debe dejarlos en `PROJECT_STATE.md` con fecha, evidencia y siguiente accion sugerida.
- No pisar cambios no propios. Revisar `git status` antes de editar, usar paths especificos al stagear y nunca commitear secretos.

### Reparto de despliegues (IMPORTANTE)
- **Codex NO puede desplegar edge functions ni aplicar migraciones** (no tiene token de Supabase CLI/MCP). **Claude SI** (via Supabase MCP).
- Por eso: cuando **Codex** cree/edite una **edge function** (`backend/supabase/functions/...`) o una **migracion** (`supabase/migrations/...`), debe dejar una linea **`PENDIENTE DEPLOY (Claude)`** en la seccion de abajo. **Claude** la despliega/aplica por MCP y marca la linea como hecha con la version desplegada.
- Frontend: lo despliega Vercel solo al hacer push a `main` (ambos agentes ok).

### Bitacora de sincronizacion Claude <-> Codex
- 2026-06-08 (Claude): desplegado lo que dejo Codex en el commit `39e259d` y que faltaba en la nube:
  - `procesar-ticket` -> **v26** (descripcion literal, alerta `sin_fecha`, NO auto-aprende productos, duplicado = ticket `rechazado` con `es_duplicado`/`duplicado_de`). Incluye la regla de `Descuentos` (Claude).
  - `reprocesar-ticket` -> **v1** desplegada (verify_jwt=true). El boton "Releer con IA" de Tickets ya funciona.
  - Migracion **022** (CHECK de tipos de alerta con `sin_fecha`/`precio_anomalo`) aplicada en la BD (estaba solo en archivo).
  - Verificado: columnas `es_duplicado`/`duplicado_de` existen; `hash_imagen` NO es UNIQUE (la insercion de duplicado de Codex es segura).
  - Fix Claude: feedback "✓ Guardado" al guardar renglon en Tickets (se habia perdido en la unificacion).
- Estado de edge functions desplegadas: verificar-pin v9, procesar-ticket **v26**, confirmar-ticket v11, confirmar-admin v2, enviar-alerta-email v2, reprocesar-ticket **v1**.
- Migraciones aplicadas en la nube: 001–020, **022** (021 Descuentos se aplico por SQL directo: categoria+producto "Descuentos" ya existen).

- 2026-06-08 (b) (Claude): auditoría multi-agente + endurecimiento de seguridad. Migraciones 023
  (RLS admin-only via `admin_users`/`is_admin()`) y 024 (grants de RPC) aplicadas. Edge functions
  redeployadas con auth real de admin: procesar-ticket **v27**, confirmar-admin **v3**,
  reprocesar-ticket **v2**, enviar-alerta-email **v3**. NOTA para Codex: las edge functions con
  service_role deben validar admin en código con `requireAdmin()` (auth.getUser + admin_users);
  NO confiar en verify_jwt. Si agregas un admin nuevo, insértalo en `admin_users`.

- 2026-06-09 (Claude): sprint de pulido + features (todo desplegado en `main`).
  - Kiosko: pantalla de PIN rehecha mobile-first; eliminado bloque "review/confirming" muerto en `subir`.
  - **Equivalencias**: unidad ahora es texto libre (datalist) en tickets y catálogo; equivalencia visible
    para cualquier unidad no-base. **Dos niveles** (caja→pz→ml): migración **025** aplicada por MCP
    (`contiene_sub_cantidad`/`contiene_sub_unidad`). `units.mjs`: `computeBaseUnits` 2 niveles + `unitViews()`.
  - Stock: vista multi-unidad ("1 caja · 24 pz · 8,520 ml").
  - Rendimiento del modal de Tickets: imagen redimensionada vía transform de Storage + lazy thumbnails;
    selector de producto por renglón cambiado de `<select>` (todo el catálogo × renglón) a **buscador con
    `<datalist>` compartido**. NOTA Codex: el renglón liga por nombre exacto del catálogo (o crea por nombre al guardar).
  - `confirmar-admin` -> **v4** (confirmación atómica/claim para no duplicar fila en Sheets).
  - Edge `confirmar-ticket` quedó huérfana (ya nada la llama); borrar opcional en Dashboard.
  - OJO numeración: en repo `023`=RLS y `024`=grants ya existían; la equivalencia quedó como **025**.

- 2026-06-10 (Claude): conversiones de unidad métricas (lt/ml/kg/g/galón) en units.mjs (toCanonical/
  sameDimension/pretty) + consumo en cualquier unidad en Stock. Y **Revisión de fraude**: pestaña en
  Tickets, marcado manual/auto, 4 reglas en `lib/fraude.mjs`, migración **026** (`sospecha_*`) aplicada
  por MCP. NOTA Codex: la detección corre en frontend (botón "Buscar sospechas") y persiste flags por
  update directo a `registros_tickets` (RLS admin). Si tocas, no re-marcar tickets ya `descartada`/`confirmada`.

### PENDIENTE DEPLOY (Claude)
- 2026-06-13 (Codex): aplicar migracion **028** (`ticket_items.orden`) y despues desplegar `procesar-ticket`, `reprocesar-ticket`, `confirmar-admin` y `confirmar-ticket`. Incluye: fix de relectura desde bucket `archivo`, orden estable de renglones segun lectura IA, y orden de renglones al mandar a Sheets.

### PENDIENTE MANUAL (Alejandro, en Supabase Dashboard)
- (sin pendientes) — "Allow new users to sign up" ya fue deshabilitado por Alejandro (2026-06-09).

## Stack
- **Frontend**: Next.js 14 (Vercel), optimizado para movil + panel `/admin`
- **DB + Storage**: Supabase (`tickets-se`, ref: `dlmqqmvrgkilptawllep`)
- **Backend IA**: Supabase Edge Functions (Deno/TypeScript) + **Gemini 2.5-flash** (configurable via secret `GEMINI_MODEL`; el 1.5-flash fue retirado por Google). Procesamiento **async** (`EdgeRuntime.waitUntil`).
- **Destino datos**: Google Sheets API (service account), una fila por renglon
- **Repo**: GitHub `ACHAZARO/tickets-se`, monorepo (`/frontend` + `/backend`)

---

## Estructura del proyecto

```
revision de tickets/
+-- AGENTS.md                          <- ESTE ARCHIVO (guia principal)
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
|   |               +-- page.tsx       # Captura + envio async
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
|           |   +-- index.ts           # Legacy gerente: POST {registro_id} -> Sheets + archivo
|           +-- confirmar-admin/
|           |   +-- index.ts           # Admin confirma tickets revisados
|           +-- reprocesar-ticket/
|           |   +-- index.ts           # Admin relanza IA y reemplaza renglones
|           +-- enviar-alerta-email/
|               +-- index.ts           # Resend para alertas criticas
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

## Flujo principal (happy path) — ASYNC, multi-producto

```
1. Gerente escanea QR -> /sucursal/[slug]
2. Ingresa PIN -> verificar-pin -> session_token (JWT HMAC propio, 1hr) en sessionStorage
3. Toma/elige UNA O VARIAS fotos -> "Enviar"
4. procesar-ticket (con Authorization: Bearer session_token):
   a. Deriva sucursal/empleado del JWT (no confia en el cliente)
   b. Sube imagen a por-revisar, SHA-256 anti-duplicado
   c. Inserta registros_tickets (encabezado, estado: pendiente)
   d. RESPONDE YA {recibido:true}  ->  "¡Enviado! Gracias" (no espera a la IA)
5. EN SEGUNDO PLANO (EdgeRuntime.waitUntil):
   a. Gemini 2.5-flash extrae LISTA de renglones + auto-categoria (catalogo de la sucursal como contexto)
   b. Inserta N ticket_items (un renglon por producto)
   c. Alertas SOLO por excepcion (ilegible / producto_no_reconocido / sin_unidad / duplicado)
   d. Si NO hay alertas -> AUTO-CONFIRMA: mueve a archivo/AAAA-MM/, 1 fila por item a Sheets, estado=confirmado
   e. Si hay alertas -> queda pendiente para revision del admin
6. Admin (/admin) revisa alertas, corrige por renglon y ensena sinonimos. Audita por sucursal.
```

---

## Edge Functions -- env vars requeridos

Configurados como Supabase Secrets (`npx supabase secrets set`):

| Variable | Descripcion |
|---|---|
| `SUPABASE_URL` | Auto-provisto por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provisto por Supabase |
| `JWT_SECRET` | Secret para firmar/verificar tokens de sesion (HMAC SHA-256) |
| `GEMINI_API_KEY` | API key de Google AI Studio para Gemini 2.5 Flash |
| `GEMINI_MODEL` | Opcional; override del modelo Gemini sin redeploy |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON completo de la service account key |
| `GOOGLE_SHEETS_ID` | `1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao` |

---

## Convenciones de codigo

### Edge Functions (Deno)
- Imports desde URLs (deno.land, esm.sh) -- NO `npm:`
- TypeScript estricto; evitar `any` explicitos salvo wrappers pequenos para Supabase/Edge con `deno-lint-ignore` localizado
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
1. Lee este `AGENTS.md`
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
- Leer este AGENTS.md y PROJECT_STATE.md

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
npx supabase functions deploy confirmar-admin --project-ref dlmqqmvrgkilptawllep
npx supabase functions deploy reprocesar-ticket --project-ref dlmqqmvrgkilptawllep
npx supabase functions deploy enviar-alerta-email --project-ref dlmqqmvrgkilptawllep
npx supabase migration new <nombre>
npx supabase db push --project-ref dlmqqmvrgkilptawllep

# Vercel (desde /frontend)
cd frontend && npx vercel --prod

# Google Sheets (no hay CLI, usar scripts/setup-sheet.js como referencia)
```

### Archivos que Codex debe leer primero
1. `AGENTS.md` (este archivo)
2. `PROJECT_STATE.md`
3. El archivo especifico que va a editar

---

## Migraciones aplicadas (001–022)
- `001` schema base (sucursales, empleados, registros_tickets, verificar_pin)
- `002` fix search_path pgcrypto · `003` tablas backoffice · `004` columnas registros · `005` seed categorias
- `006` auth/RLS admin · `007` RLS read empleados · `008` ventas + objetivos_costo
- `009` admin sucursales/empleados + RPC admin_guardar_empleado · `010` ticket_items (multi-producto)
- `011` RLS storage (fotos para admin) · `012` pg_cron limpiar imagenes +1 año
- `013` categorias y catalogo por sucursal (sucursal_id NULL=global)
- `014` eliminar tickets admin · `015` categoria cuenta_operativo · `016` comercios conocidos
- `017` cerebro/huerfanos + RPC ligar_huerfano · `018` precios/equivalencias
- `019` consumo_inventario · `020` backfill productos en limbo · `021` descuentos
- `022` tipos de alerta para flujo unificado en Tickets (`sin_fecha`, `precio_anomalo`)

---

## Notas tecnicas importantes

1. **`next.config.mjs`** -- Next.js 14 NO soporta `.ts`. Usar `.mjs`.
2. **`date_trunc` no es IMMUTABLE** -- filtrar por mes con rangos explicitos, no con funciones.
3. **SHA-256 anti-dupes** -- campo `hash_imagen` en `registros_tickets`.
4. **Google Sheets tabs** -- se crean automaticamente por mes (`2026-06`). El codigo en `_shared/google-sheets.ts` maneja la creacion.
5. **Rate limiting** -- `verificar-pin` tiene rate limit en memoria (5 intentos/minuto por slug). Se resetea en cold start.
6. **RLS** -- activo en todas las tablas. Solo `sucursales` tiene policy publica de lectura. Todo lo demas requiere service_role.

---

**Ultima actualizacion:** 2026-06-08 — Tickets concentra revision, renglones y relectura IA. Detalle vivo en `PROJECT_STATE.md`.
