---
name: envios-y-motos
description: "Decisiones de Alejandro (18-sep-2026) sobre envios a mano, motos, papeles repetidos, fraude, Bodega y Adan Melchor"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-19T19:46:00.778Z
---

- **Envio anotado a mano** ("c/envio $1,460", "y envio $1,920"): SI se pago (la gerente del cafe lo hace bien). Renglon
  aparte "Moto envio" en Otros gastos operativos. Todo lo que la gerente suma a mano como envio va a "Moto envio" (pan,
  proveedores, etc.). Si dice envio/moto se agrega aunque sea caro y el sistema lo manda a revisar (alerta `envio_alto`).
  Un total a mano SIN decir envio y >$200 sobre lo impreso = tickets engrapados: se deja lo impreso. Ojo: si el revisor ya
  lo capturo como renglon ("c/envio", "+envio") no agregar otro (paso con 3 notas de pan, corregido en 053).
- **Envio muy alto se revisa, no se acepta:** Adan Melchor cobra $60-80 de envio (confirmado por la gerente). Referencia
  por proveedor = mediana de sus ultimos envios; >1.5x (o +$40) se revisa; sin historial, >$150 se revisa. Alejandro
  valido el umbral: un envio de $149 con Adan Melchor "es razonable, pero si debe ser ticket para revisar". Los ya
  confirmados de 24-jul ($140) y 6-ago ($149) se quedan como estan; la regla aplica de aqui en adelante.
- **Total a mano que junta VARIOS proveedores:** la gerente a veces escribe en un ticket la suma de ese dia con otros
  proveedores + la moto (Adan Melchor 17-sep: $1,920 = Adan $1,490.09 + El Fenix $339.60 + moto $90). Antes de tomar una
  diferencia grande como envio, buscar tickets de ese mismo dia que la expliquen. Si el otro ticket SI se subio, cada uno
  queda con lo suyo; si no se subio, desglosar dentro del ticket. Correcciones manuales asi NO deben ensenar nada a la IA
  (sin sinonimos ni renglones ajenos ligados al catalogo).
- **"Bodega" escrito a mano** en un ticket = insumo del tostador (categoria Bodega). Ojo: en el de Adan 17-sep el playo del
  mismo ticket si era del cafe; solo las bolsas eran Bodega.
- **Motos:** producto unico "Moto envio"; categoria por renglon: dueno o familia (Ale, Polo, mama Polo, Toto) = Extras;
  cualquier otra moto = Otros gastos operativos.
- **Papel repetido** (factura + ticket de la misma compra, reimpresion, mismo folio): se RECHAZA solo y va a FRAUDE junto
  con el original (el original si cuenta); asi se le cobra al gerente si lo reporto dos veces. No cerrar como "descartada".
  Fotos identicas (mismo archivo) = rechazo tecnico, no fraude.
- **Alteraciones y comprobantes reutilizados** (corrector, numeros encimados, gas de talonario viejo, notas sin vendedor
  por montos altos): de agosto en adelante van a Fraude aunque no se cuenten.
- **Precio fuera de rango** (p. ej. aceite Ave a $745 vs $490): avisarle.
- **NO hay proveedores "de confianza"** (Alejandro lo corrigio 18-sep noche): Adan Melchor pasa por las reglas normales.
  Solo se sabe que en el cafe le compran bolsas metalizadas y playo.
- **Categoria Bodega** (solo cafe, no cuenta en el gasto de operacion): lo del tostador: bolsas metalizadas para cafe y
  cinta de empaque (y su despachador). Se decide por PRODUCTO, no por comercio: El Fenix / El Iris tambien venden cosas de
  la cafeteria (grapas, papeleria).
- Meses anteriores a agosto (mayo-julio): Claude decide con criterio sin preguntar.

**Why:** Alejandro quiere gestionar lo minimo y cotejar reportes contra lo que salio de caja; el fraude se revisa aparte.
**How to apply:** al revisar tickets aplicar estas reglas sin preguntar; preguntar solo casos raros de agosto en adelante.
Relacionado: [[gastos-con-iva]], [[revision-lote-contra-foto]].
