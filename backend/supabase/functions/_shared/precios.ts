import type { CatalogProduct } from './catalog.ts'

// deno-lint-ignore no-explicit-any
type SB = any

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
