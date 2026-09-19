export const meta = {
  name: 'verdad-prueba-modelos',
  description: 'Lectura cuidadosa (verdad) de 22 tickets para comparar modelos de IA',
  phases: [{ title: 'Verdad', detail: '1 lector cuidadoso por foto' }],
}
const IMG = 'C:/Users/koach/AppData/Local/Temp/claude/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/e7f6dfb4-e5f5-41ea-a429-fd126748f38b/scratchpad/imgs/'
const SCHEMA = {
  type: 'object',
  properties: {
    comercio: { type: ['string', 'null'], description: 'quien VENDE (emisor); null si no aparece (nota a mano sin nombre)' },
    fecha: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    folio: { type: ['string', 'null'] },
    tipo_documento: { type: 'string', enum: ['ticket', 'factura', 'nota_a_mano', 'remision', 'otro'] },
    monto_total: { type: ['number', 'null'], description: 'total a pagar' },
    items: { type: 'array', items: { type: 'object', properties: {
      descripcion: { type: 'string', description: 'lo que dice el ticket, corregido a lo que realmente es si esta abreviado/con error (ej. "cebollin")' },
      cantidad: { type: ['number', 'null'] }, unidad: { type: ['string', 'null'] },
      monto: { type: ['number', 'null'] },
      categoria: { type: 'string', enum: ['Insumos Alimentos', 'Desechables', 'Extras', 'Gas', 'Luz', 'Limpieza', 'Descuentos', 'Otros gastos operativos', 'DUDA'] },
      legible: { type: 'boolean' },
    }, required: ['descripcion', 'cantidad', 'unidad', 'monto', 'categoria', 'legible'] } },
    suma_items_cuadra: { type: 'boolean', description: 'la suma de montos de renglones == monto_total (±1 peso)' },
    notas: { type: 'string', description: 'dudas, partes ilegibles, explicaciones' },
  },
  required: ['comercio', 'fecha', 'folio', 'tipo_documento', 'monto_total', 'items', 'suma_items_cuadra', 'notas'],
}
const REGLAS = `Categorias (restaurante de alitas en Xalapa, Mexico):
- Insumos Alimentos: comida, bebidas para vender (refrescos, cerveza, agua embotellada, jugos), hielo, condimentos, salsas.
- Desechables: vasos, tapas, contenedores, bolsas, servilletas, popotes, papel aluminio/film, charolas.
- Limpieza: cloro, desengrasante, fabuloso, fibras, jabon, papel higienico, toallas, atomizadores.
- Gas: gas LP de cocina (pipas, cilindros). Luz: recibo de luz.
- Descuentos: renglon aparte con monto NEGATIVO.
- Otros gastos operativos: gastos necesarios para operar que no son insumos: "moto servicio" (lleva insumos), viaje/pipa de agua, vacaciones/prima vacacional, internet, servicios.
- Extras (NO operativo): equipo/herramientas, cosas no necesarias para operar, envios de comida al dueño ("Ale moto"), "moto + nombre de persona" (va en Extras).
- DUDA: si de plano no sabes.
Un ticket de gas LP o gasolina tiene UN solo renglon (el combustible). No son renglones: subtotal, IVA, total, cambio, forma de pago, litros/precio sueltos, leyendas. El comercio es quien VENDE; si "RESTAURANT WINGS PALACE" aparece como cliente, NO es el comercio. Las notas a mano de mercado escritas en un talonario "Wings Palace" van con comercio null. Fechas mexicanas DD/MM/AA.`
const tickets = args
phase('Verdad')
const res = await parallel(tickets.map(id => () => agent(
  `Eres el auditor que establece la VERDAD de un ticket para medir que tan bien lo leen otros modelos. Mira la foto con la herramienta Read: ${IMG}${id}.jpg (si hace falta, amplia zonas recortando con Python/PIL en un archivo temporal).
Transcribe TODO el ticket con maximo cuidado: comercio, fecha, folio, tipo de documento, total y CADA renglon (cantidad, unidad, importe). Letra a mano: lee con cuidado; si una parte es ilegible, marca legible=false en ese renglon y explicalo en notas; NO inventes.
${REGLAS}`,
  { label: `verdad:${id.slice(0, 8)}`, phase: 'Verdad', schema: SCHEMA, effort: 'high' }).then(v => ({ id, verdad: v }))))
return res.filter(Boolean)
