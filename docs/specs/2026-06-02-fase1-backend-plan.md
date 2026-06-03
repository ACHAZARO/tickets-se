# Fase 1: Backend — Schema, Gemini Mejorado, Alertas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear las tablas nuevas (categorias, catalogo productos, alertas, presupuestos), mejorar el prompt de Gemini con catalogo de productos como contexto, implementar deteccion inteligente de duplicados (folio + datos similares), generar alertas automaticas, y configurar Supabase Auth para el admin.

**Architecture:** Migraciones SQL directas en Supabase. Edge Functions refactorizadas para consultar catalogo antes de llamar a Gemini e insertar alertas post-procesamiento. Nuevo modulo compartido `_shared/catalog.ts` para cargar productos/categorias. Confirmar-ticket genera pestanas por sucursal+mes.

**Tech Stack:** Supabase (PostgreSQL + Edge Functions Deno), Gemini 1.5 Flash, Google Sheets API, Resend (email)

**Spec:** `docs/specs/2026-06-02-backoffice-design.md`

---

## File Structure

```
backend/supabase/functions/
  _shared/
    cors.ts                    (existing, no changes)
    google-sheets.ts           (modify: tab naming sucursal+mes, add unidad+folio columns)
    catalog.ts                 (create: load categories + products from DB)
  verificar-pin/index.ts       (no changes)
  procesar-ticket/index.ts     (modify: new prompt, catalog context, alerts, duplicate detection)
  confirmar-ticket/index.ts    (modify: use sucursal name in tab, add folio+unidad)

supabase/migrations/
  003_backoffice_tables.sql    (create: categorias_gasto, catalogo_productos, alertas_tickets, presupuestos)
  004_registros_add_columns.sql (alter: add folio_ticket, unidad, categoria_id to registros_tickets)
  005_seed_categorias.sql      (insert: 6 initial categories)
```

---

## Task 1: Migration — New Tables

**Files:**
- Create: `supabase/migrations/003_backoffice_tables.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- categorias_gasto
CREATE TABLE public.categorias_gasto (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL UNIQUE,
  orden      INT NOT NULL DEFAULT 0,
  activa     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categorias_gasto ENABLE ROW LEVEL SECURITY;

-- catalogo_productos
CREATE TABLE public.catalogo_productos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  sinonimos         TEXT[] DEFAULT '{}',
  categoria_id      UUID NOT NULL REFERENCES public.categorias_gasto(id),
  unidad_default    TEXT,
  precio_referencia NUMERIC(12,2),
  veces_matched     INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalogo_categoria ON public.catalogo_productos(categoria_id);
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;

-- alertas_tickets
CREATE TABLE public.alertas_tickets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_ticket_id   UUID NOT NULL REFERENCES public.registros_tickets(id) ON DELETE CASCADE,
  tipo                 TEXT NOT NULL CHECK (tipo IN (
    'duplicado', 'posible_duplicado', 'ilegible',
    'producto_no_reconocido', 'sin_unidad', 'monto_anomalo'
  )),
  duplicado_de_id      UUID REFERENCES public.registros_tickets(id),
  resuelta             BOOLEAN NOT NULL DEFAULT false,
  correccion           JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_tipo ON public.alertas_tickets(tipo);
CREATE INDEX idx_alertas_resuelta ON public.alertas_tickets(resuelta);
CREATE INDEX idx_alertas_ticket ON public.alertas_tickets(registro_ticket_id);
ALTER TABLE public.alertas_tickets ENABLE ROW LEVEL SECURITY;

-- presupuestos
CREATE TABLE public.presupuestos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID NOT NULL REFERENCES public.sucursales(id),
  categoria_id  UUID NOT NULL REFERENCES public.categorias_gasto(id),
  mes           DATE NOT NULL,
  monto         NUMERIC(12,2) NOT NULL,
  UNIQUE (sucursal_id, categoria_id, mes)
);
ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run the SQL via `execute_sql` tool against project `dlmqqmvrgkilptawllep`.
Verify: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
Expected: `alertas_tickets`, `catalogo_productos`, `categorias_gasto`, `presupuestos` appear in results alongside existing tables.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_backoffice_tables.sql
git commit -m "feat: add backoffice tables (categorias, catalogo, alertas, presupuestos)"
```

---

## Task 2: Migration — Alter registros_tickets

**Files:**
- Create: `supabase/migrations/004_registros_add_columns.sql`

- [ ] **Step 1: Write migration SQL**

```sql
ALTER TABLE public.registros_tickets
  ADD COLUMN IF NOT EXISTS folio_ticket TEXT,
  ADD COLUMN IF NOT EXISTS unidad TEXT,
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES public.categorias_gasto(id);

CREATE INDEX idx_tickets_folio ON public.registros_tickets(folio_ticket);
```

Note: `categoria_gasto TEXT` column stays for backward compatibility. `categoria_id` is optional and populated when the catalog matches.

- [ ] **Step 2: Apply migration via Supabase MCP**

Run via `execute_sql`. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'registros_tickets' AND column_name IN ('folio_ticket', 'unidad', 'categoria_id');`
Expected: 3 rows returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_registros_add_columns.sql
git commit -m "feat: add folio_ticket, unidad, categoria_id to registros_tickets"
```

---

## Task 3: Seed Initial Categories

**Files:**
- Create: `supabase/migrations/005_seed_categorias.sql`

- [ ] **Step 1: Write seed SQL**

```sql
INSERT INTO public.categorias_gasto (nombre, orden) VALUES
  ('Insumos Alimentos', 1),
  ('Desechables', 2),
  ('Extras', 3),
  ('Gas', 4),
  ('Luz', 5),
  ('Limpieza', 6)
ON CONFLICT (nombre) DO NOTHING;
```

- [ ] **Step 2: Apply via Supabase MCP**

Run via `execute_sql`. Verify: `SELECT nombre, orden FROM public.categorias_gasto ORDER BY orden;`
Expected: 6 rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_seed_categorias.sql
git commit -m "feat: seed initial expense categories"
```

---

## Task 4: Shared Module — Catalog Loader

**Files:**
- Create: `backend/supabase/functions/_shared/catalog.ts`

- [ ] **Step 1: Write catalog loader**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface CatalogProduct {
  id: string
  nombre: string
  sinonimos: string[]
  categoria_nombre: string
  unidad_default: string | null
  precio_referencia: number | null
}

export interface CatalogCategory {
  id: string
  nombre: string
}

export interface Catalog {
  products: CatalogProduct[]
  categories: CatalogCategory[]
}

export async function loadCatalog(): Promise<Catalog> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: categories } = await supabase
    .from('categorias_gasto')
    .select('id, nombre')
    .eq('activa', true)
    .order('orden')

  const { data: products } = await supabase
    .from('catalogo_productos')
    .select('id, nombre, sinonimos, unidad_default, precio_referencia, categorias_gasto:categoria_id(nombre)')
    .eq('activo', true)

  return {
    categories: categories ?? [],
    products: (products ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      nombre: p.nombre as string,
      sinonimos: (p.sinonimos as string[]) ?? [],
      categoria_nombre: (p.categorias_gasto as { nombre: string })?.nombre ?? '',
      unidad_default: p.unidad_default as string | null,
      precio_referencia: p.precio_referencia as number | null,
    })),
  }
}

export function buildCatalogPromptContext(catalog: Catalog): string {
  const catList = catalog.categories.map(c => c.nombre).join(', ')

  if (catalog.products.length === 0) {
    return `Categorias validas: ${catList}\n\nNo hay productos en el catalogo aun. Clasifica libremente usando las categorias anteriores.`
  }

  const prodLines = catalog.products.map(p => {
    const synonyms = p.sinonimos.length > 0 ? ` (tambien: ${p.sinonimos.join(', ')})` : ''
    const unit = p.unidad_default ? ` | unidad: ${p.unidad_default}` : ''
    return `- ${p.nombre}${synonyms} | categoria: ${p.categoria_nombre}${unit}`
  }).join('\n')

  return `Categorias validas: ${catList}\n\nProductos conocidos (usa estos para clasificar si aplican):\n${prodLines}`
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/supabase/functions/_shared/catalog.ts
git commit -m "feat: add catalog loader and prompt builder for Gemini context"
```

---

## Task 5: Refactor procesar-ticket — Gemini Mejorado + Alertas + Duplicados

**Files:**
- Modify: `backend/supabase/functions/procesar-ticket/index.ts`

This is the biggest refactor. Changes:
1. Import and use catalog loader
2. New prompt with catalog context, folio extraction, units, confidence
3. Smart duplicate detection (folio + data similarity) post-Gemini
4. Insert alerts when needed
5. Populate new columns (folio_ticket, unidad, categoria_id)

- [ ] **Step 1: Update the Gemini prompt**

Replace the existing `GEMINI_PROMPT` constant with a function that takes catalog context:

```typescript
function buildGeminiPrompt(catalogContext: string): string {
  return `Analiza esta imagen de un ticket o comprobante de gasto y extrae la siguiente informacion en formato JSON:
{
  "folio_ticket": "numero de ticket, nota, factura o folio visible, o null si no hay",
  "fecha": "YYYY-MM-DD o null si no se puede determinar",
  "comercio": "nombre del establecimiento o null",
  "producto": "descripcion del producto o servicio principal o null",
  "cantidad": numero o null,
  "unidad": "kg, pz, ml, lt, caja, bulto, u otro, o null si no se puede determinar",
  "monto": numero decimal (total) o null,
  "categoria_gasto": "una de las categorias validas listadas abajo",
  "confianza": "alta si los datos son claros, media si algunos son ambiguos, baja si el ticket es ilegible o muy borroso"
}

${catalogContext}

Si hay texto escrito a mano, tambien incluyelo en tu analisis.
Si el producto aparece en la lista de productos conocidos, usa su categoria y unidad.
Responde UNICAMENTE con el JSON, sin explicaciones adicionales.`
}
```

- [ ] **Step 2: Add duplicate detection function**

Add after the imports:

```typescript
async function detectSmartDuplicate(
  supabase: ReturnType<typeof createClient>,
  sucursalId: string,
  folio: string | null,
  comercio: string | null,
  monto: number | null,
  fecha: string | null
): Promise<string | null> {
  if (folio) {
    const { data } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('sucursal_id', sucursalId)
      .eq('folio_ticket', folio)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()
    if (data) return data.id
  }

  if (comercio && monto && fecha) {
    const montoMin = monto * 0.9
    const montoMax = monto * 1.1
    const { data } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('sucursal_id', sucursalId)
      .eq('fecha_ticket', fecha)
      .ilike('comercio', comercio)
      .gte('monto', montoMin)
      .lte('monto', montoMax)
      .limit(1)
      .maybeSingle()
    if (data) return data.id
  }

  return null
}
```

- [ ] **Step 3: Add alert creation function**

```typescript
async function createAlert(
  supabase: ReturnType<typeof createClient>,
  registroId: string,
  tipo: string,
  duplicadoDeId?: string
): Promise<void> {
  await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId,
    tipo,
    duplicado_de_id: duplicadoDeId ?? null,
  })
}
```

- [ ] **Step 4: Add catalog matching function**

```typescript
function matchProductInCatalog(
  producto: string | null,
  catalog: CatalogProduct[]
): CatalogProduct | null {
  if (!producto) return null
  const lower = producto.toLowerCase()
  return catalog.find(p =>
    p.nombre.toLowerCase() === lower ||
    p.sinonimos.some(s => s.toLowerCase() === lower) ||
    p.nombre.toLowerCase().includes(lower) ||
    lower.includes(p.nombre.toLowerCase()) ||
    p.sinonimos.some(s => lower.includes(s.toLowerCase()))
  ) ?? null
}
```

- [ ] **Step 5: Refactor the main handler**

Update the `serve` handler to:
1. Load catalog before calling Gemini
2. Use new prompt with catalog context
3. After Gemini response: match product, detect duplicates, create alerts
4. Populate new columns (folio_ticket, unidad, categoria_id)
5. Increment `veces_matched` on matched product

Key changes in the insert block (after Gemini response parsing):

```typescript
// Load catalog
const catalog = await loadCatalog()
const catalogContext = buildCatalogPromptContext(catalog)

// Use improved prompt
const prompt = buildGeminiPrompt(catalogContext)

// ... (Gemini call stays same, just use `prompt` instead of GEMINI_PROMPT) ...

// Match product in catalog
const matchedProduct = matchProductInCatalog(
  datosExtraidos.producto as string | null,
  catalog.products
)

// Resolve categoria_id
let categoriaId: string | null = null
if (matchedProduct) {
  const cat = catalog.categories.find(c => c.nombre === matchedProduct.categoria_nombre)
  categoriaId = cat?.id ?? null
} else {
  const cat = catalog.categories.find(c =>
    c.nombre.toLowerCase() === (datosExtraidos.categoria_gasto as string || '').toLowerCase()
  )
  categoriaId = cat?.id ?? null
}

// Insert record with new columns
const { data: registro, error: insertError } = await supabase
  .from('registros_tickets')
  .insert({
    sucursal_id: sucursalId,
    empleado_id: empleadoId,
    hash_imagen: hashImagen,
    storage_path_original: storagePath,
    estado: 'pendiente',
    fecha_ticket: datosExtraidos.fecha ?? null,
    folio_ticket: datosExtraidos.folio_ticket ?? null,
    comercio: datosExtraidos.comercio ?? null,
    producto: datosExtraidos.producto ?? null,
    cantidad: datosExtraidos.cantidad ?? null,
    unidad: datosExtraidos.unidad ?? null,
    monto: datosExtraidos.monto ?? null,
    categoria_gasto: datosExtraidos.categoria_gasto ?? null,
    categoria_id: categoriaId,
    gemini_raw: datosExtraidos,
  })
  .select('id')
  .single()

// Post-insert: alerts and catalog updates
if (registro) {
  // Smart duplicate detection
  const dupId = await detectSmartDuplicate(
    supabase, sucursalId,
    datosExtraidos.folio_ticket as string | null,
    datosExtraidos.comercio as string | null,
    datosExtraidos.monto as number | null,
    datosExtraidos.fecha as string | null
  )
  if (dupId && dupId !== registro.id) {
    await createAlert(supabase, registro.id, 'posible_duplicado', dupId)
  }

  // Confidence alert
  if (datosExtraidos.confianza === 'baja') {
    await createAlert(supabase, registro.id, 'ilegible')
  }

  // Product not in catalog
  if (!matchedProduct && datosExtraidos.producto) {
    await createAlert(supabase, registro.id, 'producto_no_reconocido')
  }

  // Missing unit
  if (!datosExtraidos.unidad) {
    await createAlert(supabase, registro.id, 'sin_unidad')
  }

  // Anomalous amount
  if (matchedProduct?.precio_referencia && datosExtraidos.monto) {
    if ((datosExtraidos.monto as number) > matchedProduct.precio_referencia * 1.5) {
      await createAlert(supabase, registro.id, 'monto_anomalo')
    }
  }

  // Increment match counter
  if (matchedProduct) {
    await supabase.from('catalogo_productos')
      .update({ veces_matched: matchedProduct.veces_matched + 1 })
      .eq('id', matchedProduct.id)
  }
}
```

- [ ] **Step 6: Deploy and test**

Deploy via Supabase MCP `deploy_edge_function`. Test by verifying the function is ACTIVE.

- [ ] **Step 7: Commit**

```bash
git add backend/supabase/functions/procesar-ticket/index.ts
git commit -m "feat: improved Gemini prompt with catalog, smart duplicates, alerts"
```

---

## Task 6: Refactor confirmar-ticket — Sucursal+Mes Tabs

**Files:**
- Modify: `backend/supabase/functions/confirmar-ticket/index.ts`
- Modify: `backend/supabase/functions/_shared/google-sheets.ts`

- [ ] **Step 1: Update google-sheets.ts — tab naming and columns**

Change the `enviarAGoogleSheets` function:
- Tab name: `${sucursalNombre} ${YYYY-MM}` instead of just `YYYY-MM`
- Add `sucursal_nombre` parameter to determine tab name
- Update headers to include Folio and Unidad:
  `['Fecha', 'Folio', 'Comercio', 'Producto', 'Cantidad', 'Unidad', 'Monto', 'Categoria', 'Empleado', 'Archivo', 'Confirmado']`
- Update `TicketRow` interface to include `folio_ticket` and `unidad`
- Update row array to include new fields

Key changes to `TicketRow`:
```typescript
export interface TicketRow {
  fecha_ticket: string | null
  folio_ticket: string | null
  comercio: string | null
  producto: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_gasto: string | null
  sucursal_nombre: string
  empleado_nombre: string
  storage_path: string
  confirmado_en: string
}
```

Key change to tab name in `enviarAGoogleSheets`:
```typescript
const tabName = `${registro.sucursal_nombre} ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
```

Key change to row:
```typescript
const row = [
  registro.fecha_ticket ?? '',
  registro.folio_ticket ?? '',
  registro.comercio ?? '',
  registro.producto ?? '',
  registro.cantidad ?? '',
  registro.unidad ?? '',
  registro.monto ?? '',
  registro.categoria_gasto ?? '',
  registro.empleado_nombre,
  registro.storage_path,
  registro.confirmado_en,
]
```

Headers (11 columns, A:K):
```typescript
['Fecha', 'Folio', 'Comercio', 'Producto', 'Cantidad', 'Unidad', 'Monto', 'Categoria', 'Empleado', 'Archivo', 'Confirmado']
```

Update all range references from `A:J` to `A:K` and `A1:J1` to `A1:K1`.

- [ ] **Step 2: Update confirmar-ticket to pass new fields**

In `confirmar-ticket/index.ts`, update the `enviarAGoogleSheets` call to include the new fields:

```typescript
sheetsRowId = await enviarAGoogleSheets({
  fecha_ticket: registro.fecha_ticket,
  folio_ticket: registro.folio_ticket,
  comercio: registro.comercio,
  producto: registro.producto,
  cantidad: registro.cantidad,
  unidad: registro.unidad,
  monto: registro.monto,
  categoria_gasto: registro.categoria_gasto,
  sucursal_nombre: registro.sucursales?.nombre ?? sessionPayload.slug,
  empleado_nombre: registro.empleados?.nombre ?? 'Desconocido',
  storage_path: archivoPath,
  confirmado_en: confirmadoEn,
})
```

- [ ] **Step 3: Deploy both functions via MCP and test**

Deploy `confirmar-ticket` via `deploy_edge_function`. Verify ACTIVE status.

- [ ] **Step 4: Commit**

```bash
git add backend/supabase/functions/_shared/google-sheets.ts backend/supabase/functions/confirmar-ticket/index.ts
git commit -m "feat: sheets tabs by sucursal+month, add folio and unidad columns"
```

---

## Task 7: Supabase Auth — Admin User

- [ ] **Step 1: Create admin user via Supabase MCP**

Use `execute_sql` to verify auth schema exists:
```sql
SELECT count(*) FROM auth.users;
```

Then create the admin user via the Supabase Dashboard or Management API. The user's email is `alepolch@gmail.com`. The password must be set by the user through the Supabase Auth signup flow or dashboard.

Alternative: use the Supabase Auth Admin API via an Edge Function to create the user programmatically.

- [ ] **Step 2: Create RLS policies for admin access**

```sql
-- Allow authenticated admin to read all backoffice tables
CREATE POLICY "Admin read categorias" ON public.categorias_gasto
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read catalogo" ON public.catalogo_productos
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read alertas" ON public.alertas_tickets
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read presupuestos" ON public.presupuestos
  FOR ALL USING (auth.role() = 'authenticated');
```

- [ ] **Step 3: Commit migration**

```bash
git add supabase/migrations/006_auth_policies.sql
git commit -m "feat: RLS policies for admin access to backoffice tables"
```

---

## Task 8: Edge Function — enviar-alerta-email (Resend)

**Files:**
- Create: `backend/supabase/functions/enviar-alerta-email/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RESEND_API = 'https://api.resend.com/emails'
const ADMIN_EMAIL = 'alepolch@gmail.com'
const ALERT_TYPES_EMAIL = ['duplicado', 'ilegible']

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { registro_ticket_id, tipo } = await req.json()

    if (!ALERT_TYPES_EMAIL.includes(tipo)) {
      return new Response(JSON.stringify({ skipped: true, reason: 'tipo not critical' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: ticket } = await supabase
      .from('registros_tickets')
      .select('comercio, monto, fecha_ticket, sucursales:sucursal_id(nombre)')
      .eq('id', registro_ticket_id)
      .single()

    const sucursal = (ticket?.sucursales as { nombre: string })?.nombre ?? 'Desconocida'
    const subject = tipo === 'duplicado'
      ? `Ticket duplicado detectado - ${sucursal}`
      : `Ticket ilegible - ${sucursal}`

    const body = `
      <h2>Alerta: ${tipo === 'duplicado' ? 'Posible ticket duplicado' : 'Ticket ilegible'}</h2>
      <p><strong>Sucursal:</strong> ${sucursal}</p>
      <p><strong>Comercio:</strong> ${ticket?.comercio ?? 'No detectado'}</p>
      <p><strong>Monto:</strong> $${ticket?.monto ?? '?'}</p>
      <p><strong>Fecha:</strong> ${ticket?.fecha_ticket ?? 'No detectada'}</p>
      <p><a href="https://tickets-se.vercel.app/admin/alertas">Ver en el panel de administracion</a></p>
    `

    const emailRes = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Tickets SE <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject,
        html: body,
      }),
    })

    const emailResult = await emailRes.json()
    return new Response(JSON.stringify({ sent: true, id: emailResult.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Email error:', err)
    return new Response(JSON.stringify({ error: 'Error sending email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Add Resend API key as Supabase secret**

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxx --project-ref dlmqqmvrgkilptawllep
```

Note: User needs to create a free Resend account at resend.com and get an API key first.

- [ ] **Step 3: Deploy via MCP**

Deploy `enviar-alerta-email` via `deploy_edge_function` with `verify_jwt: false`.

- [ ] **Step 4: Update procesar-ticket to call enviar-alerta-email**

After creating critical alerts (duplicado, ilegible), call the email function:

```typescript
if (tipo === 'duplicado' || tipo === 'ilegible') {
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/enviar-alerta-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ registro_ticket_id: registro.id, tipo }),
  }).catch(err => console.error('Email notification error:', err))
}
```

This is fire-and-forget (non-blocking).

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/functions/enviar-alerta-email/index.ts backend/supabase/functions/procesar-ticket/index.ts
git commit -m "feat: email alerts for duplicate and illegible tickets via Resend"
```

---

## Task 9: Deploy All + Integration Test

- [ ] **Step 1: Deploy all edge functions via MCP**

Deploy in order:
1. `procesar-ticket` (modified)
2. `confirmar-ticket` (modified)
3. `enviar-alerta-email` (new)

All with `verify_jwt: false` and include `_shared/cors.ts`, `_shared/google-sheets.ts`, `_shared/catalog.ts` as dependencies.

- [ ] **Step 2: Verify all functions are ACTIVE**

Use `list_edge_functions` MCP tool. Expected: 4 functions, all ACTIVE.

- [ ] **Step 3: Integration test — verify categories loaded**

```sql
SELECT id, nombre, orden FROM public.categorias_gasto ORDER BY orden;
```
Expected: 6 categories.

- [ ] **Step 4: Integration test — verify schema**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'registros_tickets'
AND column_name IN ('folio_ticket', 'unidad', 'categoria_id')
ORDER BY column_name;
```
Expected: 3 columns.

- [ ] **Step 5: Push to GitHub**

```bash
git push
```

- [ ] **Step 6: Update PROJECT_STATE.md**

Mark Phase 1 tasks as completed. Add any issues found during testing.

---

## Post-Phase 1 State

After completing this phase:
- 4 new tables in Supabase (categorias_gasto, catalogo_productos, alertas_tickets, presupuestos)
- registros_tickets has 3 new columns (folio_ticket, unidad, categoria_id)
- 6 initial categories seeded
- Gemini prompt includes catalog context and extracts folio + unidad + confianza
- Smart duplicate detection (3 layers: hash, folio, data similarity)
- Automatic alerts for: posible_duplicado, ilegible, producto_no_reconocido, sin_unidad, monto_anomalo
- Email notifications for critical alerts (duplicado, ilegible)
- Google Sheets tabs named by sucursal+month with folio and unidad columns
- Supabase Auth with admin RLS policies
- Ready for Phase 2 (Web /admin)
