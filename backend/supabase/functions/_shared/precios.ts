import type { CatalogProduct } from './catalog.ts'
import { mismoComercio } from './duplicados.ts'

// deno-lint-ignore no-explicit-any
type SB = any

// Renglon de envio o moto ("Moto envio", "c/envio", "Moto Ale"): su precio depende del proveedor, no del producto.
export function esEnvio(texto: string | null | undefined): boolean {
  const s = (texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /\benvios?\b/.test(s) || /^\s*moto\b/.test(s)
}

// Mediana: una compra mal capturada en el historial no mueve la referencia (el promedio si).
export function mediana(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Guarda en el historial el precio unitario de cada producto del ticket. Solo se llama al
// CONFIRMAR: una lectura sin revisar (pendiente) no debe ensuciar la referencia de precios.
// Salta renglones en otra unidad que la del producto (limones por pieza vs por kg).
export async function guardarPrecios(
  supabase: SB,
  items: { producto_catalogo_id: string | null; monto: number | null; cantidad: number | null; unidad: string | null }[],
  productos: CatalogProduct[],
  sucursalId: string, registroId: string, fecha: string | null,
): Promise<void> {
  await supabase.from('precio_historial').delete().eq('registro_ticket_id', registroId)
  const vistos = new Set<string>()
  for (const it of items) {
    const pid = it.producto_catalogo_id
    const monto = Number(it.monto)
    const cant = Number(it.cantidad)
    if (!pid || vistos.has(pid) || !Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
    const prod = productos.find(p => p.id === pid)
    if (prod?.unidad_default && it.unidad && it.unidad !== prod.unidad_default) continue
    vistos.add(pid)
    const unit = monto / cant
    try {
      await supabase.from('precio_historial').insert({
        producto_catalogo_id: pid, sucursal_id: sucursalId, registro_ticket_id: registroId, precio_unitario: unit, fecha,
      })
      await supabase.from('catalogo_productos').update({ precio_referencia: unit }).eq('id', pid)
    } catch (e) { console.error('guardarPrecios:', e) }
  }
}

// Revisa (SIN escribir nada) si algun renglon ligado a un producto trae un precio unitario
// muy distinto (+-40%) a la mediana de sus ultimas 5 compras. Misma regla que procesar-ticket;
// requiere 3+ compras previas y la misma unidad. excluirRegistroId evita compararse consigo mismo.
export async function hayPrecioAnomalo(
  supabase: SB,
  items: { producto_catalogo_id: string | null; monto: number | null; cantidad: number | null; unidad: string | null }[],
  productos: CatalogProduct[],
  excluirRegistroId: string,
): Promise<boolean> {
  for (const it of items) {
    const pid = it.producto_catalogo_id
    const monto = Number(it.monto)
    const cant = Number(it.cantidad)
    if (!pid || !Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
    const prod = productos.find(p => p.id === pid)
    // Los envios se comparan por proveedor (envioMuyAlto), no contra todas las motos de la sucursal.
    if (prod && esEnvio(prod.nombre)) continue
    const mismaUnidad = !prod?.unidad_default || !it.unidad || it.unidad === prod.unidad_default
    if (!mismaUnidad) continue
    try {
      const { data: previos } = await supabase.from('precio_historial')
        .select('precio_unitario').eq('producto_catalogo_id', pid)
        .or(`registro_ticket_id.is.null,registro_ticket_id.neq.${excluirRegistroId}`)
        .order('created_at', { ascending: false }).limit(5)
      const prev = ((previos ?? []) as { precio_unitario: number }[]).map(r => Number(r.precio_unitario))
        .filter(n => Number.isFinite(n) && n > 0)
      if (prev.length < 3) continue
      const ref = mediana(prev)
      const ratio = (monto / cant) / ref
      if (ref > 0 && (ratio > 1.4 || ratio < 0.6)) return true
    } catch (e) { console.error('hayPrecioAnomalo:', e) }
  }
  return false
}

// Envio mucho mas caro de lo normal con ESE proveedor (Adan Melchor cobra $60-80: uno de $430 se revisa,
// decision Alejandro 18-sep). Referencia: mediana de sus ultimos 10 envios confirmados en la sucursal
// (con 3 o mas); sin ese historial, se revisa cualquier envio de mas de $150. Devuelve el motivo o null.
export async function envioMuyAlto(
  supabase: SB,
  items: { descripcion: string | null; monto: number | null; producto_catalogo_id: string | null }[],
  productos: CatalogProduct[], sucursalId: string, comercio: string | null, excluirRegistroId: string,
  propias?: Set<string>,
): Promise<string | null> {
  const idsEnvio = productos.filter(p => esEnvio(p.nombre)).map(p => p.id)
  const montos = items
    .filter(it => esEnvio(it.descripcion) || (!!it.producto_catalogo_id && idsEnvio.includes(it.producto_catalogo_id)))
    .map(it => Number(it.monto)).filter(n => Number.isFinite(n) && n > 0)
  if (!montos.length) return null
  const envio = Math.max(...montos)
  let previos: number[] = []
  if (comercio && idsEnvio.length) {
    try {
      const { data } = await supabase.from('ticket_items')
        .select('monto, registros_tickets!inner(comercio, sucursal_id, estado)')
        .in('producto_catalogo_id', idsEnvio).neq('registro_ticket_id', excluirRegistroId)
        .eq('registros_tickets.sucursal_id', sucursalId).eq('registros_tickets.estado', 'confirmado')
        .order('created_at', { ascending: false }).limit(300)
      previos = ((data ?? []) as { monto: number; registros_tickets: { comercio: string | null } | null }[])
        .filter(r => mismoComercio(comercio, r.registros_tickets?.comercio, propias))
        .map(r => Number(r.monto)).filter(n => Number.isFinite(n) && n > 0).slice(0, 10)
    } catch (e) { console.error('envioMuyAlto:', e) }
  }
  const pesos = (n: number) => `$${n.toFixed(2)}`
  if (previos.length >= 3) {
    const ref = mediana(previos)
    return envio > Math.max(ref * 1.5, ref + 40)
      ? `Envio de ${pesos(envio)}; con este proveedor suele ser ${pesos(ref)}. Confirmar con la gerente.` : null
  }
  return envio > 150 ? `Envio de ${pesos(envio)} (mas de $150). Confirmar con la gerente.` : null
}
