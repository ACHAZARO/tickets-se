---
name: evidencia-siempre
description: "Regla de Alejandro (19-sep-2026): nunca destruir evidencia de lo que suben los gerentes; Subidos vs Oficiales para cobrar"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-19T19:46:03.963Z
---

Nunca se borra ni se pisa sin copia lo que sube un gerente: foto, fila del ticket y el monto tal como lo presento (lo que
dice el papel), aunque el ticket se rechace, sea duplicado o fraude. En sucursales reales un ticket malo se RECHAZA, no se
elimina. Toda correccion de datos guarda respaldo (tablas `respaldo.rNNN_*`).

Matices de Alejandro (19-sep): (1) la tarea mensual que borra fotos de mas de 1 ano ESTA BIEN (antes se descarga un
respaldo); ojo: hoy falla cada mes porque Supabase bloquea borrar fotos por SQL, habria que rehacerla con la API de Storage
antes de jun-2027 si se quiere que funcione. (2) "Eliminar" con candado en pantalla (solo admin) esta bien. (3) A futuro,
cuando se escale a app para vender: permisos por usuario (p. ej. gerente sin eliminar, solo ver). (4) Pasar la foto a
'archivo' ya es seguro (copia verificada antes de quitar el original).

**Why:** el reporte "Subidos vs Oficiales" sirve para decirle al gerente "subiste $X, solo valen $Y, debes $X-Y" si usa
tickets de mas (duplicados, facturas dobles, alterados) para cuadrar su gasto real.
**How to apply:** antes de cualquier cambio que borre o sobrescriba tickets/fotos/montos, preservar lo original. Auditoria
completa con hallazgos y arreglos en `AUDITORIA_EVIDENCIA.md` del repo (19-sep): lo mas grave es que la base aun permite
borrar filas y fotos al admin, un cron borra fotos de mas de 1 ano, y "Subidos" usa el monto ya corregido (ej. Jugotropick
1-jul: papel alterado a $420, se cuenta $210 en ambos lados). Relacionado: [[envios-y-motos]].

**Correccion (Alejandro, 19-sep, misma tarde):** lo del "monto tal como lo presento (lo que dice el papel)" NO aplica a tickets alterados: un ticket alterado se registra con el monto REAL y va a Fraude para revisar con el gerente; no se crea una columna `monto_papel`. La regla de no borrar/pisar foto y fila SI se mantiene. Ver [[subidos-vs-oficiales-api]].
