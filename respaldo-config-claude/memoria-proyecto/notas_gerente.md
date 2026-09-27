---
name: notas-gerente
description: "26-sep: nota opcional del gerente al subir foto; solo para humanos, NUNCA va a Gemini; sale en API/reporte/Excel"
metadata:
  node_type: memory
  type: project
  originSessionId: f2d5070a-b037-42f0-9967-ad898971705c
  modified: 2026-09-27T02:31:05.587Z
---

Desde 2026-09-26 la app de fotos tiene "Nota (opcional)" (max 500). Se guarda en `registros_tickets.nota`
(migracion 083) y sale en `reporte_tickets` (`notas`, columna Notas antes de Desglose), API `/tickets`, `/ticket`,
`/bandeja`, MCP y el Excel (boton "Descargar reporte" en Tickets + hoja Tickets de Gasto).

**Why:** Alejandro quiere que el gerente explique tickets raros (ej. "se pago con transferencia de otra cuenta por error")
para quien revisa y para la IA de gestion del dueno, pero la IA que LEE el ticket (Gemini) no debe verla: la tomaria
como instruccion.

**How to apply:** nunca pasar `nota` a `procesarEnSegundoPlano`, `reprocesar-ticket` ni a ningun prompt; nada de
`select *` en caminos de IA. Una nota que parece orden para una IA solo se marca (`nota_para_ia` -> aviso rojo en panel,
`nota_alerta` en API); NO manda a Fraude (decision de Claude: no mueve la aprobacion y evitaria falsas alarmas).
Relacionado: [[vision-gestion-por-ia]], [[evidencia-siempre]], [[subidos-vs-oficiales-api]].
