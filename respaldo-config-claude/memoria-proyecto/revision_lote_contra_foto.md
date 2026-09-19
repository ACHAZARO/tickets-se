---
name: revision-lote-contra-foto
description: Metodo probado (sep-2026) para revisar tickets en lote contra la foto y cargar las correcciones sin pasar SQL gigante por el chat
metadata: 
  node_type: memory
  type: project
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-19T00:34:29.329Z
---

Metodo usado en agosto WP (150), lote 2 WP (262) y el 18-sep con Santa Elena completo (508) + resto de WP (376):

1. Firmar URLs de fotos desde una pestana PROPIA del admin en Chrome (no la del usuario): token en localStorage
   `sb-dlmqqmvrgkilptawllep-auth-token`, anon key sacada de los chunks JS; storage sign por lotes de 100 (48 h) e insert
   en `public._tmp_firmas` (borrar filas antes: no hay policy de select, el upsert falla con RLS).
2. Workflow de revisores (~15-18 tickets c/u, script en workflows/scripts/revision-tickets-contra-foto-*.js) con reglas por
   sucursal; devuelven lista FINAL de renglones + producto existente o producto_nuevo. Resultados: journal.jsonl (extraer.py).
3. `aplicar_decisiones.py` (envios, engrapados, etc.) -> `generar_revision.py --suc --in --extra fusion --pref --tag`
   genera `carga_<tag>.json`. Consolidar productos nuevos con fusion_*.json (a_existente / fusion / unidad / excluir).
4. CARGA SIN COPIAR SQL: input file inyectado en la pestana + herramienta file_upload de Chrome -> la pagina lo sube a
   `_tmp_carga` (RLS insert admin) -> `select aplicar_revision('<tag>', '<sucursal_id>')` (migracion 046). Verificar con
   totales de control (esperado_<tag>.json). NUNCA pedir a un agente que copie SQL grande: sonnet lo abrevio con "(...)".
5. Rehacer renglones: reprocesar-ticket `{desde_guardada:true}` + confirmar-admin desde la pagina (4 en paralelo), luego
   migracion de cierre (rechazos, sospechas, alertas) y reconstruir precio_historial de la sucursal.

**Why:** asi se revisan cientos de tickets con calidad de humano y la carga es exacta y verificable.
**How to apply:** repetir para cualquier mes atrasado o sucursal nueva. Relacionado: [[gemini-cuota-rafagas]], [[envios-y-motos]].
