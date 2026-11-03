import { matchProductInCatalog, resolveCategoria } from './catalog.ts'
import type { Catalog } from './catalog.ts'
import type { GeminiItem, GeminiResult } from './gemini.ts'
import { aplicarImpuestos, impuestosPorRenglon, noCuadra, quitarDescuentoDoble, repartirSinImporte, sinTotal } from './montos.ts'

// De la lectura de la IA a los renglones del ticket: liga cada uno al catalogo, pone categoria y unidad y cuadra los montos
// contra el total. Lo comparten procesar-ticket y reprocesar-ticket para que subir y releer den exactamente lo mismo.
export interface Renglon {
  registro_ticket_id: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
  producto_catalogo_id: string | null
  necesita_revision: boolean
  motivo_revision: string | null
  orden: number
  categoria_nombre: string | null
}

// Decision de Alejandro (07-oct): lo que manda a revision es el TIPO DE PAPEL, no el nombre del comercio. Una nota a mano o
// una remision de talonario las ve siempre una persona, aunque todo se vea bien; en la pantalla se aprueban en lote.
export function papelPideRevision(tipo: string | null | undefined, sinFecha?: boolean): string | null {
  const papel = tipo === 'nota_a_mano' ? 'Nota escrita a mano' : tipo === 'remision' ? 'Remisión de proveedor' : null
  if (!papel) return null
  return sinFecha ? `${papel}, sin fecha: se usó el día en que se subió.` : `${papel}.`
}

const pesos = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Cuenta escrita a mano de toda una vuelta de compras ("compra $1,332 + envio $171"): suma varios tickets. La IA ya no la toma como
// compra, pero siempre la ve una persona: es donde se notan los comprobantes que faltan y donde se puede contar algo dos veces.
export function motivoCuentaAMano(r: GeminiResult['resumen_mano']): string | null {
  const compra = Number(r?.compra_total) || 0
  const envio = Number(r?.envio) || 0
  const total = Number(r?.total) || 0
  if (compra <= 0 && total <= 0) return null
  const partes = [compra > 0 ? `compra ${pesos(compra)}` : '', envio > 0 ? `envío ${pesos(envio)}` : ''].filter(Boolean).join(' + ')
  return `A mano dice: ${partes}${total > 0 ? ` = ${pesos(total)}` : ''}. Esa cuenta suma varios tickets: revisa que estén todos y que este solo cuente lo suyo.`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Un ticket de un mes que el dueno ya cerro no se aprueba solo: cambiaria unas cuentas ya cuadradas sin avisar.
export async function motivoMesCerrado(
  // deno-lint-ignore no-explicit-any
  supabase: any, sucursalId: string, fecha: string | null,
): Promise<string | null> {
  if (!fecha) return null
  const { data: suc } = await supabase.from('sucursales').select('cuenta_id').eq('id', sucursalId).maybeSingle()
  if (!suc?.cuenta_id) return null
  const { data } = await supabase.from('meses_cerrados').select('mes').eq('cuenta_id', suc.cuenta_id).eq('mes', `${fecha.slice(0, 7)}-01`).maybeSingle()
  if (!data) return null
  const mes = MESES[Number(fecha.slice(5, 7)) - 1] ?? fecha.slice(0, 7)
  return `Este ticket es de ${mes}, que ya cerraste. Si lo apruebas se suma a ese mes; si debe contar en este, cámbiale la fecha.`
}

// Lo que se le agrega al prompt en la segunda lectura, cuando en la primera los renglones no sumaron el total.
export const AVISO_NO_CUADRO = `

OJO: en una lectura anterior de esta misma foto los renglones no sumaron el total. Vuelve a leerla renglon por renglon, de arriba a abajo, sin saltarte ninguno y revisando cada importe.`

// La lectura no cuadra con el total (hecho el mismo cuadre de impuestos y descuentos que se le va a hacer al guardarla).
export function lecturaNoCuadra(datos: GeminiResult, catalog: Catalog): boolean {
  const copia = JSON.parse(JSON.stringify(datos)) as GeminiResult & Record<string, unknown>
  const raw = (Array.isArray(copia.items) ? copia.items : []).filter(it => it && (it.descripcion || it.monto != null))
  if (!raw.length) return true
  const total = copia.monto_total ?? (raw.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null)
  const { items } = construirRenglones('prueba', raw, catalog, copia, total)
  return sinTotal(items, total) || noCuadra(items, total, copia.tipo_documento)
}

export function construirRenglones(
  registroId: string, rawItems: GeminiItem[], catalog: Catalog, datos: GeminiResult & Record<string, unknown>, montoTotal: number | null,
): { items: Renglon[]; matchedIds: Set<string>; anySinCategoria: boolean; anySinUnidad: boolean; anyProductoNuevo: boolean } {
  const matchedIds = new Set<string>()
  const items: Renglon[] = rawItems.map((it, index) => {
    const desc = (it.descripcion ?? 'Producto').toString().slice(0, 500)
    const matched = matchProductInCatalog(desc, catalog.products, it.producto_catalogo)
    if (matched) matchedIds.add(matched.id)
    let cat = resolveCategoria(it.categoria ?? null, catalog.categories)
    if (!cat && matched) cat = resolveCategoria(matched.categoria_nombre, catalog.categories)
    // Sin unidad en el papel va por pieza: preguntarle a un dueno "falta la unidad" no le dice nada.
    const unidad = (it.unidad && String(it.unidad).trim()) || matched?.unidad_default || 'pz'
    let necesita = false, motivo: string | null = null
    if (!cat) { necesita = true; motivo = 'sin_categoria' }
    else if (!unidad) { necesita = true; motivo = 'sin_unidad' }
    else if (!matched) { necesita = true; motivo = 'producto_nuevo' }
    // En un papel impreso, un renglon sin cantidad es 1 (si no, no entra a Entradas ni a Stock).
    const impreso = datos.tipo_documento === 'ticket' || datos.tipo_documento === 'factura'
    const cantidad = it.cantidad ?? (impreso && Number(it.monto) > 0 ? 1 : null)
    return {
      registro_ticket_id: registroId, descripcion: desc,
      cantidad, unidad, monto: it.monto ?? null,
      categoria_id: cat?.id ?? null, producto_catalogo_id: matched?.id ?? null,
      necesita_revision: necesita, motivo_revision: motivo,
      orden: index,
      categoria_nombre: cat?.nombre ?? null,
    }
  })

  // Si solo hay un renglon sin precio pero el ticket tiene total, liga el total a ese renglon (notas a mano: "alitas 50 pzas $850").
  const conMonto = items.filter(it => it.monto != null && Number(it.monto) > 0)
  if (montoTotal != null && conMonto.length === 0 && items.length === 1) items[0].monto = montoTotal
  // Nota con varios renglones sin importe y solo el total (pan): se reparte por cantidad.
  if (repartirSinImporte(items, montoTotal, datos.tipo_documento)) datos._montos_repartidos = true
  // Importes que ya traian el descuento + renglon "Descuento": se restaria dos veces.
  if (quitarDescuentoDoble(items, montoTotal, datos)) datos._descuento_doble_quitado = true
  // Facturas: los renglones vienen antes de IVA/IEPS; se suma el impuesto a los renglones que lo pagan para que sumen el
  // total pagado (gastos CON IVA).
  const impuestos = impuestosPorRenglon(items, montoTotal, datos)
  if (impuestos) {
    aplicarImpuestos(items, impuestos, Number(montoTotal))
    datos._impuestos_sumados = Math.round(impuestos.reduce((s, x) => s + x, 0) * 100) / 100
  }
  return {
    items, matchedIds,
    anySinCategoria: items.some(it => it.motivo_revision === 'sin_categoria'),
    anySinUnidad: items.some(it => it.motivo_revision === 'sin_unidad'),
    anyProductoNuevo: items.some(it => it.motivo_revision === 'producto_nuevo'),
  }
}
