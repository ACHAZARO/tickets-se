---
name: respaldo-drive-recuperacion
description: "Kit de recuperacion (RECUPERACION.md, DIRECTORIO_CUENTAS.md) y respaldo a Google Drive; _secretos nunca va a Drive"
metadata: 
  node_type: memory
  type: project
  originSessionId: d4febada-f1fb-4d53-96ce-131954e6ef19
  modified: 2026-09-19T20:46:21.061Z
---

2026-09-19: Alejandro pidio poder cambiar de computadora sin perder el hilo. Quedo:
- `RECUPERACION.md` (donde nos quedamos + pasos PC nueva) y `DIRECTORIO_CUENTAS.md` (cuentas, correos, 2FA, plan de
  respaldo de accesos) en la raiz del proyecto; indice maestro de todo el workspace en `Documents\Claude\RECUPERACION.md`.
- Cuentas maestras: `koach700@me.com` (GitHub ACHAZARO sin 2FA, Vercel achazaro con 2FA en el cel, Supabase solo via GitHub)
  y `alepolch@gmail.com` (Google Cloud, Gemini, Sheets, admin de la app). Alejandro hara esa semana el plan de §8.
- Respaldo a Drive: `Documents\Claude\respaldar_claude_a_drive.ps1` (acceso `RESPALDO A DRIVE.cmd` en el Escritorio) ->
  `G:\Mi unidad\Respaldo Claude\`. Manual e incremental, nunca borra.

**Why:** una copia de la llave `tk_` de api-cuentas subio a Drive en texto plano (13:55) porque el script no excluia `_secretos`.
**How to apply:** `_secretos` debe seguir en el `$xd` del script; nunca guardar llaves fuera de `_secretos`/boveda cifrada.
Al cerrar sesiones sustanciales: actualizar RECUPERACION.md §2-4, refrescar `respaldo-config-claude/` y correr el respaldo.
Relacionado: [[gemini-cuota-rafagas]], [[vercel-git-deploy]].
