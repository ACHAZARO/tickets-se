export const meta = {
  name: 'auditoria-evidencia-tickets',
  description: 'Read-only audit: every path that can destroy evidence of uploaded tickets (photos, rows, original readings), each finding adversarially verified',
  phases: [
    { title: 'Find', detail: 'frontend, edge functions, database/cron/policies, live storage vs rows' },
    { title: 'Verify', detail: 'one skeptic per area tries to refute each finding' },
  ],
}

const REPO = 'C:\\Users\\koach\\Documents\\Claude\\Projects\\revisión de tickets'
const COMMON = `
You are auditing the "Revision de Tickets" app (repo at ${REPO}; Next.js admin in frontend/, Deno Supabase Edge Functions in backend/supabase/functions/, SQL migrations in supabase/migrations/). Supabase project ref: dlmqqmvrgkilptawllep. If you need the live database, load the Supabase MCP tools with ToolSearch (query "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql") and run ONLY read-only SELECT queries. STRICTLY READ-ONLY: never run INSERT/UPDATE/DELETE/ALTER/DROP, never apply migrations, never deploy, never edit files. The Read tool may be truncated by a hook to line 1 on some files: if that happens, read the file with PowerShell (Get-Content -LiteralPath <path> -Encoding utf8) instead.

Business goal (owner, Alejandro): managers upload photos of expense tickets. EVIDENCE of what a manager submitted must NEVER be destroyed, even after a ticket is rejected, marked duplicate or fraud. Evidence = (1) the uploaded photo file in Supabase Storage (buckets 'por-revisar' and 'archivo'); (2) the registros_tickets row (who uploaded: empleado_id, sucursal_id, created_at, hash_imagen, storage_path_original/storage_path_archivo, estado); (3) the amount/reading as originally captured (monto, gemini_raw, ticket_items) — overwriting it without keeping the original counts as PARTIAL loss, because the owner wants a report "total captured by the manager (all uploads, duplicates included)" vs "total officially authorized". Moving a file from 'por-revisar' to 'archivo' is fine if the copy is verified before removing; flag it if the original is removed even when the copy/upload failed.

Report every code path, SQL function, trigger, cron job, RLS policy/grant or UI action that deletes or irreversibly overwrites any of that evidence, with exact location (file:line or DB object name) and a short quote. Also report protections that are MISSING (e.g. a policy that lets an admin user delete rows or storage objects). Do not report harmless deletes of derived data (e.g. alert rows) unless they erase evidence of what the manager submitted; if unsure, include it with destroys_evidence='partial' and explain.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short unique id like FE-1, EF-2, DB-3, LIVE-1' },
          where: { type: 'string', description: 'file:line or DB object' },
          kind: { type: 'string', enum: ['delete_row', 'delete_file', 'overwrite', 'cron', 'policy_or_grant', 'data_already_lost', 'other'] },
          what: { type: 'string' },
          trigger: { type: 'string', description: 'who/what runs it and when' },
          destroys_evidence: { type: 'string', enum: ['yes', 'partial', 'no'] },
          quote: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['id', 'where', 'kind', 'what', 'trigger', 'destroys_evidence', 'quote', 'suggested_fix'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partial'] },
          reason: { type: 'string' },
          corrected_where: { type: 'string' },
        },
        required: ['id', 'verdict', 'reason', 'corrected_where'],
      },
    },
    missed: { type: 'string', description: 'anything in this area the finder missed' },
  },
  required: ['results', 'missed'],
}

const AREAS = [
  { key: 'frontend', label: 'find:frontend', prompt: `${COMMON}

YOUR AREA: the frontend (frontend/app/**, frontend/lib/**, any .mjs helpers). Find every supabase .delete(), storage .remove(), .rpc(...) that deletes, .update() that overwrites evidence fields (monto, gemini_raw, storage paths, estado of rejected tickets back to something else, empleado_id), and every button/flow (e.g. "Eliminar", "Rechazar", "Volver a leer IA", batch re-read, catalog merges) that ends up deleting or overwriting evidence. Trace RPC names to their SQL definitions in supabase/migrations to say what they really do. Use ids FE-1, FE-2...` },
  { key: 'edge', label: 'find:edge-functions', prompt: `${COMMON}

YOUR AREA: all Edge Functions (backend/supabase/functions/**, including _shared). Find storage .remove()/.move(), .delete() on any table, and overwrites of registros_tickets evidence fields (gemini_raw, monto, storage paths, hash) and ticket_items replacement — e.g. procesar-ticket (exact-photo duplicate branch, auto-confirm move), confirmar-admin (move por-revisar -> archivo: is the original removed even if download/upload failed?), confirmar-ticket, reprocesar-ticket (replaces items and gemini_raw: is the original reading kept anywhere?). Use ids EF-1, EF-2...` },
  { key: 'db', label: 'find:database', prompt: `${COMMON}

YOUR AREA: the database. (a) Read every migration in supabase/migrations/*.sql and list SQL functions, triggers and cron jobs that DELETE rows or storage objects, and data migrations that deleted ticket rows/photos. (b) In the LIVE database (read-only SELECTs): list cron jobs (select jobid, schedule, command, active from cron.job), SQL functions whose body contains 'delete' (pg_proc prosrc ilike '%delete%' in schema public), triggers on registros_tickets/ticket_items, RLS policies on public.registros_tickets, public.ticket_items, public.alertas_tickets and storage.objects that allow DELETE (pg_policies where cmd in ('DELETE','ALL')), and table grants of DELETE/TRUNCATE to anon/authenticated on those tables (information_schema.role_table_grants). Say concretely whether a logged-in admin could delete a ticket row or photo today. Use ids DB-1, DB-2...` },
  { key: 'live', label: 'find:live-data', prompt: `${COMMON}

YOUR AREA: the LIVE data, read-only. Check whether evidence has ALREADY been lost: (1) registros_tickets rows whose storage_path_archivo or storage_path_original points to an object that does not exist in storage.objects (bucket 'archivo' or 'por-revisar'), grouped by estado and month of created_at, with counts and a few example ids; (2) storage objects in those buckets that no registro points to (orphans), count and examples; (3) rows with hash_imagen null or storage paths both null; (4) whether any backup/history exists of original readings (look for schema 'respaldo' tables, gemini_raw keys like _revision, _reproceso_manual, _estaba_confirmado) and how many rejected tickets (estado='rechazado') keep monto and photo. Use ids LIVE-1, LIVE-2... In 'notes' give the headline numbers.` },
]

phase('Find')
const results = await pipeline(
  AREAS,
  a => agent(a.prompt, { label: a.label, phase: 'Find', schema: FINDINGS }),
  (found, a) => {
    if (!found || !found.findings || !found.findings.length) return { area: a.key, found, verdicts: null }
    return agent(`${COMMON}

You are a SKEPTICAL VERIFIER for the "${a.key}" area. Another auditor reported the findings below. For EACH one, open the exact location yourself (file or live DB, read-only) and try to REFUTE it: is the code/object really there, does it really delete/overwrite evidence, can it really be triggered in production, is the severity right? Default to 'refuted' if you cannot reproduce the claim from the source. Use 'partial' if it is real but overstated or mislocated, and give the corrected location. Then, in 'missed', list anything important in this area the auditor missed (same rules).

FINDINGS:
${JSON.stringify(found.findings, null, 2)}

AUDITOR NOTES: ${found.notes}`, { label: `verify:${a.key}`, phase: 'Verify', schema: VERDICTS })
      .then(verdicts => ({ area: a.key, found, verdicts }))
  },
)
return results
