// deno-lint-ignore no-explicit-any
type SB = any

// Palabras que no distinguen a un comercio (razon social, conectores) y los nombres de los
// propios restaurantes (notas internas "Wings Palace" no son un proveedor).
const RELLENO = new Set([
  'sa', 'de', 'cv', 'rl', 'sab', 'sapi', 'la', 'el', 'los', 'las', 'y', 'del', 'restaurant', 'sucursal', 'mexico',
  'wings', 'palace', 'santa', 'elena',
])

// Tokens significativos del nombre de un comercio: minusculas, sin acentos, >= 4 letras
// ("Cervezas y Ref. Jalapa SA de CV" -> cervezas, jalapa).
// Un mismo proveedor que factura con otra razon social. Coca-Cola FEMSA emite tickets como
// "Coca-Cola FEMSA" y facturas como "PROPIMEX S. de R.L." (o "PROPI MEX"): todo cuenta como 'femsa'.
const ALIAS = new Map<string, string>([
  ['propimex', 'femsa'], ['femsa', 'femsa'], ['coca', 'femsa'], ['cola', 'femsa'], ['kof', 'femsa'],
])

export function tokensComercio(nombre: string | null | undefined): Set<string> {
  const limpio = (nombre ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/propi\s*mex/g, 'propimex')
  const out = new Set<string>()
  for (const t of limpio.split(/\s+/)) {
    const canon = ALIAS.get(t)
    if (canon) out.add(canon)
    else if (t.length >= 4 && !RELLENO.has(t)) out.add(t)
  }
  return out
}

// Mismo proveedor: si ambos nombres tienen 2+ palabras significativas deben compartir 2
// (evita juntar "Papeleria ... de Jalapa" con "Cervezas y Refrescos de Jalapa", o dos
// proveedores con el mismo apellido); si uno solo tiene 1 palabra ("FEMSA"), basta esa.
export function mismoComercio(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = tokensComercio(a)
  const tb = tokensComercio(b)
  if (!ta.size || !tb.size) return false
  let comunes = 0
  for (const t of ta) if (tb.has(t)) comunes++
  return comunes >= Math.min(2, ta.size, tb.size)
}

const sumarDias = (fecha: string, dias: number) => new Date(Date.parse(fecha + 'T00:00:00Z') + dias * 864e5).toISOString().slice(0, 10)

// Folio que identifica un comprobante: sin signos ni ceros a la izquierda debe tener 3+ caracteres.
// Algunas impresoras reinician el folio cada dia ("0000000001" de Quesos La Noria): eso no es un folio.
const folioUtil = (folio: string | null | undefined) => (folio ?? '').replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').length >= 3
const mismoFolio = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').toLowerCase() === (b ?? '').replace(/[^a-z0-9]/gi, '').replace(/^0+/, '').toLowerCase()

// Busca otro ticket de la misma sucursal que parezca el mismo gasto:
// 1) mismo folio (±30 dias de la fecha del ticket);
// 2) mismo comercio + misma fecha + monto (±10%);
// 3) FACTURA + TICKET de la misma compra: comercio parecido, monto (±1.5%) y fechas a ±10 dias
//    (la factura CFDI suele llevar otra fecha, otro folio y la razon social completa).
//    Solo si UNO de los dos es factura y el otro no: dos notas o dos facturas con folios
//    distintos y el mismo monto son compras que se repiten (pipa de agua, pan, gas), no duplicados.
// excludeId evita que un ticket se detecte a si mismo.
export async function detectSmartDuplicate(
  supabase: SB, sucursalId: string, folio: string | null,
  comercio: string | null, monto: number | null, fecha: string | null,
  excludeId?: string, tipoDocumento?: string | null,
): Promise<string | null> {
  const noSelf = excludeId ?? '00000000-0000-0000-0000-000000000000'
  if (folio && folioUtil(folio)) {
    // Ventana de ±30 dias alrededor de la FECHA DEL TICKET (no de hoy): al releer tickets
    // viejos la ventana "ultimos 30 dias desde hoy" nunca encontraba nada. Dos proveedores
    // distintos pueden repetir un folio corto: si ambos traen comercio, debe ser el mismo.
    let q = supabase.from('registros_tickets').select('id, comercio')
      .eq('sucursal_id', sucursalId).eq('folio_ticket', folio).neq('estado', 'rechazado').neq('id', noSelf)
    q = fecha
      ? q.gte('fecha_ticket', sumarDias(fecha, -30)).lte('fecha_ticket', sumarDias(fecha, 30))
      : q.gte('created_at', new Date(Date.now() - 60 * 864e5).toISOString())
    const { data } = await q.order('created_at', { ascending: true }).limit(5)
    const hit = ((data ?? []) as { id: string; comercio: string | null }[])
      .find(r => !comercio || !r.comercio || mismoComercio(comercio, r.comercio))
    if (hit) return hit.id
  }
  if (comercio && monto && fecha) {
    // Mismo comercio, dia y monto. Si los dos traen folio util y es distinto, son dos compras
    // (dos galones de jugo en notas seguidas, dos visitas al super el mismo dia).
    const { data } = await supabase.from('registros_tickets').select('id, folio_ticket')
      .eq('sucursal_id', sucursalId).eq('fecha_ticket', fecha).ilike('comercio', comercio).neq('estado', 'rechazado').neq('id', noSelf)
      .gte('monto', monto * 0.9).lte('monto', monto * 1.1)
      .order('created_at', { ascending: true })
      .limit(5)
    const hit = ((data ?? []) as { id: string; folio_ticket: string | null }[])
      .find(r => !(folioUtil(folio) && folioUtil(r.folio_ticket) && !mismoFolio(folio, r.folio_ticket)))
    if (hit) return hit.id
  }
  if (comercio && monto && monto > 0 && fecha && tokensComercio(comercio).size > 0) {
    const { data } = await supabase.from('registros_tickets').select('id, comercio, tipo:gemini_raw->>tipo_documento')
      .eq('sucursal_id', sucursalId).neq('estado', 'rechazado').neq('id', noSelf)
      .gte('fecha_ticket', sumarDias(fecha, -10)).lte('fecha_ticket', sumarDias(fecha, 10))
      .gte('monto', monto * 0.985).lte('monto', monto * 1.015)
      .order('created_at', { ascending: true })
      .limit(20)
    const esFactura = tipoDocumento === 'factura'
    const hit = ((data ?? []) as { id: string; comercio: string | null; tipo: string | null }[])
      .find(r => esFactura !== (r.tipo === 'factura') && mismoComercio(comercio, r.comercio))
    if (hit) return hit.id
  }
  return null
}
