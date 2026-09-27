export const meta = {
  name: 'verificar-archivo-seguro',
  description: 'Adversarial review of the safe photo-archiving change (copy, verify, then remove) before deploying',
  phases: [{ title: 'Review', detail: 'three independent lenses on the same diff' }],
}

const REPO = 'C:\\Users\\koach\\Documents\\Claude\\Projects\\revisión de tickets'
const BASE = `
Repo: ${REPO}. Review ONLY the uncommitted diff: run \`git --no-pager diff -- backend/supabase/functions\` plus the new untracked file backend/supabase/functions/_shared/archivo.ts (read it in full). Deno Supabase Edge Functions using https://esm.sh/@supabase/supabase-js@2 (storage-js v2). The Read tool may be truncated to line 1 by a hook on some files: if so, read them with PowerShell Get-Content -LiteralPath <path> -Encoding utf8. Supabase project dlmqqmvrgkilptawllep: if useful, you may run READ-ONLY SELECTs via ToolSearch "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql" (e.g. storage.objects metadata). STRICTLY READ-ONLY: no edits, no deploys, no writes.

Intent of the change: the photo a manager uploads is evidence and must never be lost. When a ticket is confirmed (procesar-ticket autoConfirmar for clean tickets, and confirmar-admin when the admin confirms), the photo used to be downloaded from bucket 'por-revisar', uploaded to 'archivo/AAAA-MM/<name>' WITHOUT checking the upload error, and the original was ALWAYS removed, so a failed upload lost the only copy. New flow: copiarAArchivo() downloads, uploads with upsert, then lists the 'archivo' month folder with search=<name> and compares metadata.size to the byte length; it returns {ruta, verificada} or null. The ticket row is updated to point to the copy (storage_path_archivo), and ONLY if that update succeeded AND verificada is true is the original removed (quitarDePorRevisar). If the copy fails, storage_path_archivo stays null and the UI keeps showing the photo from 'por-revisar'. Also, the exact-duplicate branch of procesar-ticket now returns HTTP 500 if the duplicate photo upload or its row insert fails, instead of 200 with a row pointing to a missing file. A Gemini prompt rule in _shared/gemini.ts also changed (cinta de empaque -> Bodega); just sanity-check it.

Report only real problems with evidence (file:line, why, concrete failure scenario). If you find nothing, say so explicitly. Keep it short.`

const LENSES = [
  { key: 'storage-api', prompt: `${BASE}

LENS: storage-js v2 API correctness. Verify against the real library (you may fetch https://esm.sh/@supabase/storage-js or its GitHub source / Supabase docs with WebFetch/WebSearch if available): does download() return { data: Blob, error }? Does upload(path, ArrayBuffer, { contentType, upsert }) accept an ArrayBuffer and an undefined contentType? Does list(folder, { search, limit }) return objects whose 'metadata.size' is the byte size (check a live storage.objects row's metadata to confirm the field), and does 'search' match by name prefix within that folder? Could list() return the object with metadata null right after upload (eventual consistency) so verification spuriously fails — and if so, is that failure SAFE (original kept, row points to the copy)? Any TypeScript/Deno type error that would break the deploy bundle?` },
  { key: 'regression', prompt: `${BASE}

LENS: regressions. Trace every consumer of storage_path_archivo / storage_path_original and of the 'por-revisar' and 'archivo' buckets across the repo (frontend/app/**, all edge functions incl. reprocesar-ticket image candidates, api-cuentas, SQL functions/cron in supabase/migrations such as limpiar_imagenes_antiguas). With the new behavior a confirmed ticket may (rarely) have storage_path_archivo = null, or have BOTH a copy in 'archivo' and the original still in 'por-revisar'. Does anything break or mis-display in those cases (e.g. UI pathBucket, 'Volver a leer IA', photo signing, Sheets row, re-confirm of an already-archived ticket)? Does confirm still work normally in the happy path (same end state as before: estado confirmado, storage_path_archivo set, original removed)? Is the manager app (frontend/app/sucursal/**) OK with the duplicate branch now returning 500 on failure?` },
  { key: 'evidence', prompt: `${BASE}

LENS: evidence safety, adversarial. Try to construct ANY sequence (failures, retries, concurrent double-confirm, a second confirm after a partial failure, upsert overwriting an existing 'archivo' object with the same name, timeouts in EdgeRuntime.waitUntil, the remove() call failing, the update failing) in which, after this change, a ticket row ends up pointing to a photo file that does not exist, or a photo is deleted with no other copy. Also check the remaining legacy function confirmar-ticket (backend/supabase/functions/confirmar-ticket/index.ts, unchanged, deployed, verify_jwt=false) and say whether anything in the frontend still calls it (grep).` },
]

phase('Review')
const out = await parallel(LENSES.map(l => () => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review' })))
return LENSES.map((l, i) => ({ lens: l.key, report: out[i] }))
