export const meta = {
  name: 'reverificar-archivo-seguro',
  description: 'Second adversarial pass on the fixed safe-archiving diff (race, evidence, types) before deploy',
  phases: [{ title: 'Recheck' }],
}
const REPO = 'C:\\Users\\koach\\Documents\\Claude\\Projects\\revisión de tickets'
const BASE = `Repo ${REPO}. Review ONLY the current uncommitted diff: \`git --no-pager diff -- backend/supabase/functions\` plus the untracked file backend/supabase/functions/_shared/archivo.ts (read in full with PowerShell Get-Content -LiteralPath <path> -Encoding utf8 if the Read tool is truncated). Deno Supabase Edge Functions, supabase-js v2 from esm.sh. READ-ONLY: no edits, no deploys, no DB writes.
Context: a previous review found (1) a race where autoConfirmar (procesar-ticket, background) and confirmar-admin (admin click) could both confirm the same ticket and the loser wrote storage_path_archivo=null after the winner removed the original, leaving the row pointing to no photo; (2) unverified copies were still being pointed to; (3) contentType could be the string 'undefined'. The fixes: copiarAArchivo now returns the archivo path ONLY when the copy is verified (else null); autoConfirmar first claims the ticket with update estado='confirmado' WHERE estado='pendiente' ... select('id') and returns false (touching nothing, and the caller skips guardarPrecios) if it did not win; both functions only write storage_path_archivo when they just archived it (never null it), and only remove the original from 'por-revisar' after that row update succeeded; confirmar-admin skips the update entirely when there is nothing to change.
Report only real defects with file:line and a concrete failing sequence; say explicitly if none.`
phase('Recheck')
const [a, b] = await parallel([
  () => agent(`${BASE}

LENS: concurrency + evidence. Re-run the race analysis on the NEW code: admin confirm vs background autoConfirmar in both orders, double admin click, 'Volver a leer IA' (reprocesar-ticket sets estado back to 'pendiente' on a confirmed ticket, then the admin re-confirms: storage_path_archivo already set -> no copy, no remove), a ticket manually REJECTED by the admin while the IA is still running (autoConfirmar must not confirm it now), and failures at each await. Can any row end up pointing to a missing file, or any photo be deleted without a verified copy the row points to? Also: does autoConfirmar claiming 'confirmado' BEFORE the photo copy break anything that reads estado (e.g. frontend lists, resumen_tickets RPC, api-cuentas) during the few seconds in between?`, { label: 'recheck:race', phase: 'Recheck' }),
  () => agent(`${BASE}

LENS: code correctness. Check TypeScript/Deno validity of every changed line (return types Promise<boolean>, all code paths return, spread of conditional objects into supabase update, '.select('id')' after update returning an array, unused imports or variables that would fail a strict lint), that every caller of autoConfirmar and copiarAArchivo matches the new signatures (grep all functions), and that behavior in the happy path is unchanged: clean ticket -> estado confirmado, confirmado_en set, photo in archivo/AAAA-MM/, storage_path_archivo set, original removed from por-revisar, prices saved, one Sheets call.`, { label: 'recheck:code', phase: 'Recheck' }),
])
return { race: a, code: b }
