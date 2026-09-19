export const meta = {
  name: 'buscar-envios-a-mano',
  description: 'Revisar fotos del cafe de agosto solo para detectar totales o envios escritos a mano sobre el ticket impreso',
  phases: [{ title: 'Envios', detail: 'revisores de ~20 fotos cada uno' }],
}
const SCRATCH = 'C:/Users/koach/AppData/Local/Temp/claude/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/e7f6dfb4-e5f5-41ea-a429-fd126748f38b/scratchpad'
const IDS = args.ids
const SCHEMA = {
  type: 'object',
  properties: {
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          total_impreso: { type: ['number', 'null'], description: 'total del comprobante (impreso o el del recuadro TOTAL de la nota)' },
          total_a_mano: { type: ['number', 'null'], description: 'total escrito a mano por la gerente FUERA/ENCIMA del comprobante (p. ej. "Total y envio $656", "c/envio $1,460"), o null si no hay' },
          envio: { type: ['number', 'null'], description: 'monto del envio: si esta escrito ("envio $80") ese; si solo esta el total con envio, total_a_mano - total_impreso. null si no hay envio' },
          es_suma_de_varios: { type: 'boolean', description: 'true si el total a mano claramente suma varios tickets engrapados (diferencia de cientos o miles, se ven otros papeles)' },
          nota: { type: 'string', description: 'que dice exactamente lo escrito a mano (breve)' },
        },
        required: ['id', 'total_impreso', 'total_a_mano', 'envio', 'es_suma_de_varios', 'nota'],
      },
    },
  },
  required: ['tickets'],
}
phase('Envios')
const trozos = []
for (let i = 0; i < IDS.length; i += 20) trozos.push(IDS.slice(i, i + 20))
const res = await parallel(trozos.map((ids, k) => () => agent(
  `Revisa ${ids.length} fotos de comprobantes de gastos de un cafe. Las fotos ya estan descargadas en ${SCRATCH}/imgs/<id>.jpg (si alguna no existe, obten su url con execute_sql SOLO LECTURA: ToolSearch "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql", project_id "dlmqqmvrgkilptawllep", "select url from _tmp_firmas where id='<id>'", y bajala con curl; no repitas URLs).
Ids: ${JSON.stringify(ids)}
Abre CADA foto con Read. Tu UNICA tarea: ver si la gerente escribio a mano, sobre o junto al comprobante, un total distinto al impreso, sobre todo con la palabra "envio" o "moto" ("Total y envio $656", "c/envio $1,460", "+envio", "$70 envio"). La gerente paga un envio (moto) de ~$40-160 por muchas compras y lo anota asi. Reporta cada ticket (aunque no tenga nada: total_a_mano=null, envio=null). Si el total a mano es mucho mayor (cientos o miles) porque suma varios tickets engrapados, pon es_suma_de_varios=true y envio=null salvo que el envio este escrito aparte. No confundas: precios unitarios, cambio, "efectivo", folios o numeros del vendedor NO son total a mano.`,
  { label: `envios ${k + 1}`, phase: 'Envios', schema: SCHEMA },
)))
const todos = res.filter(Boolean).flatMap(r => r.tickets || [])
const con = todos.filter(t => t.envio)
log(`Revisados ${todos.length}/${IDS.length}; con envio ${con.length}`)
return { total: todos.length, con_envio: con.length, faltan: IDS.filter(id => !todos.some(t => t.id === id)) }