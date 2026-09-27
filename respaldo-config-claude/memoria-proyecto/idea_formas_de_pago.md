---
name: idea-formas-de-pago
description: "25-sep (solo idea, NO construido): forma de pago como dimension aparte de la categoria; transferencias ligadas a su ticket; nomina via CheckPro"
metadata:
  node_type: memory
  type: project
  originSessionId: f509d19e-2649-4212-a8d0-63500cd594af
  modified: 2026-09-26T02:25:15.729Z
---

Idea de Alejandro (2026-09-25, pidio solo pensar): clasificar cada salida por forma de pago (efectivo / tarjeta / transferencia), y que el negocio pueda crear sus propias formas (ej. "Tarjeta BBVA empresa", "Caja chica"). Modulo que el admin prende por cuenta. Tambien documentar transferencias y nominas.

Recomendacion dada: la forma de pago es una DIMENSION NUEVA, no una categoria (si "Transferencia" fuera categoria se pierde que fue pollo). Una tabla de formas de pago por cuenta + un campo por ticket. La IA la lee del papel ("VISA ****1234", "efectivo", "cambio"); si no, la aprende por comercio (como la categoria); si no sabe, pregunta con una alerta. Comprobante de transferencia (SPEI) = foto nueva que se LIGA al ticket/factura de la misma compra (no es otro gasto; clave de rastreo = antiduplicado). Nomina = no es compra; mejor traerla de CheckPro por API.

**Why:** lo valioso es el control de caja: solo el efectivo sale de la caja del gerente; un pago con tarjeta o transferencia de la empresa usado para cuadrar caja es fraude.

**How to apply:** cuando lo pida, brainstorming primero; respetar [[app-para-vender-aislamiento]] (formas de pago como dato por cuenta) y [[evidencia-siempre]].
