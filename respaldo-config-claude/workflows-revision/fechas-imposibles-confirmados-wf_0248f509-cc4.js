export const meta = {
  name: 'fechas-imposibles-confirmados',
  description: 'Lee la fecha real de 45 tickets confirmados con fecha imposible (2 lectores independientes por foto)',
  phases: [{ title: 'Leer fechas', detail: '2 lectores por ticket' }],
}

const IMG = 'C:/Users/koach/AppData/Local/Temp/claude/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/e7f6dfb4-e5f5-41ea-a429-fd126748f38b/scratchpad/imgs/'

const SCHEMA = {
  type: 'object',
  properties: {
    fecha: { type: ['string', 'null'], description: 'YYYY-MM-DD de la compra segun la foto, o null si no se puede leer' },
    texto_fecha_visto: { type: 'string', description: 'la fecha tal como aparece escrita/impresa en la foto (literal)' },
    legible: { type: 'boolean' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    total_visto: { type: ['number', 'null'], description: 'total a pagar que se ve en la foto' },
    nota: { type: 'string' },
  },
  required: ['fecha', 'texto_fecha_visto', 'legible', 'confianza', 'total_visto', 'nota'],
}

const prompt = (t, estilo) => `Mira la foto del ticket de gasto de un restaurante en Mexico con la herramienta Read: ${IMG}${t.id}.jpg
Datos del sistema (pueden estar MAL, por eso lo revisamos): fecha guardada ${t.fecha} (IMPOSIBLE: no cuadra con el dia de subida), subido el ${t.subido} (hora de Mexico), comercio "${t.comercio ?? 'sin comercio'}", total $${t.monto}, sucursal ${t.suc}.
${estilo}
Reglas: en Mexico las fechas se escriben dia/mes/año (DD/MM/AA o DD/MM/AAAA). La compra ocurrio ANTES o el mismo dia de la subida (${t.subido}), normalmente dias o semanas antes; nunca despues. Si el año impreso/escrito es imposible (ej. 2020, 2024, 2028) pero dia y mes se leen, reporta la fecha con el año que corresponde (2026 o 2025) y dilo en la nota. Si de plano no hay fecha visible o no se puede leer, fecha=null y legible=false. NO inventes: si dudas entre dos lecturas, confianza "baja" y explica en la nota.`

const tickets = args
phase('Leer fechas')
const res = await parallel(tickets.map(t => () => parallel([
  () => agent(prompt(t, 'Lee la fecha con cuidado, caracter por caracter.'), { label: `A:${t.id.slice(0, 8)}`, phase: 'Leer fechas', schema: SCHEMA }),
  () => agent(prompt(t, 'Eres un segundo lector independiente: busca la fecha en todo el ticket (encabezado, pie, sello, anotaciones a mano) antes de concluir.'), { label: `B:${t.id.slice(0, 8)}`, phase: 'Leer fechas', schema: SCHEMA, model: 'sonnet' }),
]).then(([a, b]) => ({ ...t, a, b }))))
return res.filter(Boolean)
