# Revisión de Tickets — CLAUDE.md

## Descripción
Web app móvil para que gerentes de restaurantes suban fotos de tickets de gastos operacionales. Backend en Edge Functions (Deno) procesa imágenes con Gemini 1.5 Flash y vuelca los datos a Google Sheets.

## Stack
- **Frontend**: Next.js (Vercel), optimizado para móvil
- **DB + Storage**: Supabase (`tickets-se`, ref: `dlmqqmvrgkilptawllep`)
- **Backend IA**: Supabase Edge Functions (Deno/TypeScript) + Gemini 1.5 Flash (`gemini-1.5-flash`)
- **Destino datos**: Google Sheets API
- **Repo**: Monorepo (`/frontend` + `/backend`)

## Estructura de carpetas (objetivo)
```
/
├── frontend/          # Next.js app
├── backend/           # Edge Functions (Deno)
│   └── supabase/
│       └── functions/
├── supabase/
│   └── migrations/    # SQL migrations
└── CLAUDE.md
```

## Supabase
- **Proyecto**: tickets-se
- **Ref**: dlmqqmvrgkilptawllep
- **Región**: us-east-1
- **Plan**: Pro

### Tablas
- `sucursales` — slug URL-safe para QR/rutas
- `empleados` — PIN hasheado con bcrypt (pgcrypto)
- `sucursal_empleados` — relación N:M
- `registros_tickets` — auditoría completa + campos Gemini + hash anti-dupes

### Función clave
`verificar_pin(slug, pin)` — SECURITY DEFINER, valida PIN sin exponer lógica al cliente.

## Flujo principal
1. Gerente escanea QR → `/sucursal/[slug]`
2. Ingresa PIN → `verificar_pin()` en Supabase
3. Sube foto → Supabase Storage `/por-revisar/`
4. Edge Function procesa con Gemini 1.5 Flash → JSON
5. Gerente confirma en pantalla
6. Datos → Google Sheets (pestaña del mes) + foto mueve a `/archivo/`

## Migraciones aplicadas
- `001_initial_schema` ✓

## Notas técnicas
- Edge Functions usan Deno/TypeScript (no Python). SDK: `@google/generative-ai`
- RLS activo en todas las tablas. Solo `sucursales` tiene policy pública de lectura
- Detección de duplicados: SHA-256 de la imagen (campo `hash_imagen`)
- `date_trunc` no es IMMUTABLE — filtrar por mes con rangos de fecha explícitos
