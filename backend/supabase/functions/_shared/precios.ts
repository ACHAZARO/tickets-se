import type { CatalogProduct } from './catalog.ts'
import { mismoComercio } from './duplicados.ts'

// deno-lint-ignore no-explicit-any
type SB = any

// Renglon de envio o moto ("Moto envio", "c/envio", "Moto Ale"): su precio depende del proveedor, no del producto.
export function esEnvio(texto: string | null | undefined): boolean {
  const s = (texto ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /\benvios?\b/.test(s) || /^\s*moto\b/.test(s)
}

// Unidades de medida equivalentes (como las escribe la IA o el nombre del articulo).
const BASE: Record<string, string> = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', g: 'g', gr: 'g', grs: 'g', gramos: 'g',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l', ml: 'ml' }
const base = (u: string | null | undefined) => BASE[(u ?? '').toLowerCase().trim()] ?? null

// Cantidad del renglon en la unidad del articulo. Si el nombre trae la presentacion ("HIELO FRESKYHIELO 5 KG",
// "XX Lager barril 20L") y el articulo se mide en esa unidad, la misma bolsa puede venir como "1 pz", "1 kg" o "5 kg":
// - en piezas/paquetes/barriles: cantidad x presentacion (2 pz = 10 kg);
// - 1 en la unidad de medida de algo que viene de N (1 kg de una bolsa de 5 kg no existe): es 1 bolsa = N.
// Devuelve null si no se puede comparar (otra unidad sin presentacion conocida).
export function cantidadEnUnidadDelArticulo(
  it: { cantidad: number | null; unidad: string | null }, prod: CatalogProduct | undefined,
): number | null {
  const cant = Number(it.cantidad)
  if (!Number.isFinite(cant) || cant <= 0) return null
  const uProd = prod?.unidad_default ?? null
  if (!uProd || !it.unidad || it.unidad === uProd) {
    const bProd = base(uProd)
    if (bProd && cant === 1) {
      const pres = presentacion(prod?.nombre ?? '', bProd)
      if (pres && pres !== 1) return pres
    }
    return cant
  }
  const bProd = base(uProd)
  if (!bProd) return null
  // El renglon viene en la misma medida escrita distinto (lt vs l): igual que arriba.
  if (base(it.unidad) === bProd) {
    const pres = presentacion(prod?.nombre ?? '', bProd)
    return cant === 1 && pres && pres !== 1 ? pres : cant
  }
  if (base(it.unidad)) return null // otra medida (g vs kg): no se adivina
  const pres = presentacion(prod?.nombre ?? '', bProd)
  return pres ? cant * pres : null
}

// "HIELO 5 KG" -> 5 (kg); "barril 20L" -> 20 (l). Solo si la medida del nombre es la unidad del articulo.
function presentacion(nombre: string, bUnidad: string): number | null {
  const m = nombre.toLowerCase().replace(/,/g, '.').matchAll(/(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grs?|g|gramos|lts?|litros?|l|ml)(?![a-z])/g)
  for (const x of m) if (base(x[2]) === bUnidad) { const n = Number(x[1]); if (n > 0) return n }
  return null
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
    if (!pid || vistos.has(pid) || !Number.isFinite(monto) || monto <= 0) continue
    const prod = productos.find(p => p.id === pid)
    // En la unidad del articulo (2 pz de "HIELO 5 KG" = 10 kg); sin forma de convertir, no se guarda.
    const cant = cantidadEnUnidadDelArticulo(it, prod)
    if (cant == null) continue
    // Ocasionales y no autorizados no llevan historial de precios (migracion 094).
    if (prod && (prod.uso ?? 'normal') !== 'normal') continue
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
    if (!pid || !Number.isFinite(monto) || monto <= 0) continue
    const prod = productos.find(p => p.id === pid)
    // Los envios se comparan por proveedor (envioMuyAlto), no contra todas las motos de la sucursal.
    if (prod && esEnvio(prod.nombre)) continue
    if (prod && (prod.uso ?? 'normal') !== 'normal') continue
    // Misma bolsa leida como "1 pz", "1 kg" o "5 kg": se compara en la unidad del articulo (no da falsa alarma x5).
    const cant = cantidadEnUnidadDelArticulo(it, prod)
    if (cant == null) continue
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
