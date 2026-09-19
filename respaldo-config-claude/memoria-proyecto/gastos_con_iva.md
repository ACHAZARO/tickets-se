---
name: gastos-con-iva
description: "Decision de Alejandro (2026-09-18): los gastos se registran CON IVA; el impuesto va solo a los renglones que lo pagan"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-18T22:41:40.733Z
---

Los renglones de cada ticket deben sumar el TOTAL PAGADO (con IVA/IEPS), no el subtotal: "asi es mas facil de cotejar".
Las facturas imprimen renglones antes de impuestos; `_shared/montos.ts` suma el impuesto solo a los renglones que lo
pagan (tasa 0/8/16/IEPS+IVA, solucion unica) y si no hay una explicacion exacta NO reparte y deja alerta `monto_anomalo`.

**Why:** Alejandro coteja reportes contra los tickets; categorias sin IVA no cuadraban con lo pagado.
**How to apply:** al revisar tickets, los revisores capturan importes TAL COMO ESTAN IMPRESOS y ponen total/subtotal/iva/ieps
en sus campos; el sistema reparte. Nunca repartir IVA parejo a mano si hay productos tasa 0 (agua mineral si paga 16%,
Clamato no). Relacionado: [[revision-lote-contra-foto]].
