export const meta = {
  name: 'revision-reparto-iva',
  description: 'Revision adversarial del reparto de IVA en renglones y alerta de no-cuadre (edge functions)',
  phases: [{ title: 'Revision', detail: '3 revisores con enfoques distintos sobre el diff' }],
}
const REPO = 'C:/Users/koach/Documents/Claude/Projects/revisión de tickets'
const CONTEXTO = `Repo: ${REPO}. Cambio SIN commitear (ver con: git -C "${REPO}" diff -- backend/supabase/functions ; y el archivo nuevo backend/supabase/functions/_shared/montos.ts).
Objetivo del cambio: las facturas imprimen renglones ANTES de IVA/IEPS y el total CON impuestos; el dueno quiere que los renglones (que alimentan reportes por categoria) sumen el total pagado. factorImpuestos() decide si la diferencia total-suma es impuesto (subtotal impreso = suma, o diferencia = iva leido, o factura con diferencia <=17%) y aplicarFactor() escala todos los renglones (descuentos incluidos) dejando el centavo en el renglon mayor. noCuadra() levanta alerta 'monto_anomalo' si los renglones (todos con importe) no suman el total (+-$1 o 2%).
Se usa en procesar-ticket/index.ts (subida del gerente; se movio el guardado del encabezado DESPUES de armar renglones para registrar _impuestos_repartidos en gemini_raw) y reprocesar-ticket/index.ts (relectura y modo desde_guardada, que rehace renglones desde gemini_raw).
Otros datos: GeminiResult trae subtotal, iva, monto_total, tipo_documento (ticket|factura|nota_a_mano|remision|otro). Renglones pueden traer monto null (notas con solo total). Existe regla previa: si hay 1 renglon sin monto se le pone el total. hayPrecioAnomalo/guardarPrecios usan monto/cantidad del renglon. confirmar-admin NO recalcula montos.
Es codigo Deno de Supabase Edge Functions en produccion. Solo LEE; no edites nada.`
const SCHEMA = { type: 'object', properties: { hallazgos: { type: 'array', items: { type: 'object', properties: {
  archivo: { type: 'string' }, linea: { type: 'number' }, severidad: { type: 'string', enum: ['bug', 'riesgo', 'detalle'] },
  problema: { type: 'string' }, escenario: { type: 'string', description: 'datos concretos -> resultado incorrecto' }, arreglo: { type: 'string' } },
  required: ['archivo', 'severidad', 'problema', 'escenario', 'arreglo'] } } }, required: ['hallazgos'] }
const LENTES = [
  ['correctitud', 'Busca errores de logica y de flujo: orden de operaciones en procesar-ticket tras mover el guardado del encabezado (que pasa si falla algo antes, variables usadas antes de definirse, returns tempranos, auto-confirmacion), doble alerta monto_anomalo, interaccion con la regla de 1 renglon sin monto, desde_guardada aplicado dos veces (idempotencia), redondeo y signos (descuentos negativos, suma cero o negativa).'],
  ['datos_reales', 'Piensa en tickets reales mexicanos: facturas CFDI con descuento antes de IVA, IEPS de cerveza/refresco/botana, articulos tasa 0 mezclados con 16%, tickets de Costco/Sams/Chedraui que ya traen IVA incluido pero imprimen desglose de IVA, gasolina/gas LP, notas a mano con totales tachados, tickets donde Gemini ya metio el IVA como renglon, propinas, "cambio en monedero". Para cada tipo di si factorImpuestos/noCuadra harian lo correcto o danarian datos (repartir algo que no es impuesto, o dejar de alertar un error de lectura).'],
  ['regresiones', 'Busca regresiones y efectos colaterales: tipos TypeScript (Deno) que no compilen, imports faltantes o sin usar, que tickets antes auto-confirmados ahora queden detenidos por noCuadra sin razon, impacto en precio anomalo e historial de precios (precios con IVA vs historial sin IVA), y cualquier cosa del diff que cambie comportamiento no intencional.'],
]
phase('Revision')
const res = await parallel(LENTES.map(([k, foco]) => () => agent(`${CONTEXTO}\n\nTu enfoque: ${foco}\n\nDevuelve solo hallazgos REALES con escenario concreto (si no hay, lista vacia). No inventes; verifica leyendo el codigo.`, { label: `revisor:${k}`, phase: 'Revision', schema: SCHEMA })))
return res.filter(Boolean).flatMap((r, i) => (r.hallazgos || []).map(h => ({ lente: LENTES[i][0], ...h })))
