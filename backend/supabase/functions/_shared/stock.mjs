// Calculos del Stock por conteo fisico (migracion 088). Sin dependencias de React para poder probarlos.
//
//   existencia estimada = ultimo conteo + compras despues de ese conteo
//   consumo real        = conteo inicial + compras entre los dos conteos - conteo final
//
// Las cantidades se comparan en la "unidad base" de cada articulo (la mas granular: g, ml, pz...).
import { toCanonical, computeBaseUnits } from './units.mjs'

// OJO: este archivo y units.mjs estan COPIADOS en backend/supabase/functions/_shared/ (los usa la edge function
// conteo-gerente). Deben ser identicos: lo vigila stock.test.mjs. Si cambias uno, copia al otro lado.

/**
 * Unidad base y cantidad de UN renglon comprado (misma regla en el panel y en el celular del gerente).
 * Devuelve null si no se puede medir, o { servicio: true } si es un servicio (no va al inventario).
 */
export function baseDeRenglon(prod, row) {
  const compra = ((prod?.unidad_default ?? row?.unidad) ?? '').trim() || null
  const base = computeBaseUnits({
    productName: prod?.nombre, quantity: Number(row?.cantidad ?? 0), purchaseUnit: compra,
    containsQuantity: prod?.contiene_cantidad, containsUnit: prod?.contiene_unidad,
    subQuantity: prod?.contiene_sub_cantidad, subUnit: prod?.contiene_sub_unidad,
  })
  if (!base) return null
  let unidad = base.source !== 'identity' ? base.unit : compra
  if (unidad && prod?.nombre && unidad.toLowerCase() === String(prod.nombre).toLowerCase()) unidad = null
  if (unidad && /^servicios?$/i.test(unidad)) return { servicio: true }
  return { cantidad: base.quantity, unidad }
}

/** La unidad mas usada de un articulo ({ g: 12, pz: 1 } -> 'g'); empate: orden alfabetico. Asi no depende del orden. */
export function unidadMasComun(cuenta) {
  let mejor = null, n = -1
  for (const [u, c] of Object.entries(cuenta ?? {}).sort(([a], [b]) => a.localeCompare(b))) if (c > n) { mejor = u; n = c }
  return mejor
}

/** Fecha (AAAA-MM-DD) en Mexico de un instante: los tickets sin fecha usan su hora de subida, no la UTC. */
export function fechaMexico(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Unidades en las que se puede capturar un articulo cuya unidad base es `base`. */
export function unidadesCompatibles(base) {
  const b = (base ?? '').trim().toLowerCase()
  if (b === 'g' || b === 'kg') return ['g', 'kg']
  if (b === 'ml' || b === 'lt' || b === 'l') return ['ml', 'lt']
  return b ? [b] : []
}

/**
 * Convierte (cantidad, unidad) a la unidad base del articulo. Devuelve null si no se puede (ej. pz -> g).
 * Misma unidad: igual. Metricas compatibles (kg -> g, lt -> ml): por factor.
 */
export function aUnidadBase(cantidad, unidad, base) {
  const q = Number(cantidad)
  if (!Number.isFinite(q)) return null
  const u = (unidad ?? '').trim().toLowerCase()
  const b = (base ?? '').trim().toLowerCase()
  if (!u || !b || u === b) return q
  const cu = toCanonical(q, u)
  const cb = toCanonical(1, b)
  if (cu && cb && cu.unit === cb.unit && cb.quantity > 0) return cu.quantity / cb.quantity
  return null
}

/** Ultimo conteo con fecha <= `hasta` (o el ultimo de todos). `conteos`: [{ fecha, cantidad }] en unidad base. */
export function conteoHasta(conteos, hasta) {
  let mejor = null
  for (const c of conteos ?? []) {
    if (hasta && c.fecha > hasta) continue
    if (!mejor || c.fecha > mejor.fecha) mejor = c
  }
  return mejor
}

/** Suma de compras (en unidad base) con fecha en (desde, hasta]. Sin `desde`: desde siempre. */
export function comprasEntre(compras, desde, hasta) {
  let cantidad = 0, monto = 0
  for (const c of compras ?? []) {
    if (desde && c.fecha <= desde) continue
    if (hasta && c.fecha > hasta) continue
    cantidad += Number(c.cantidad) || 0
    monto += Number(c.monto) || 0
  }
  return { cantidad, monto }
}

/** Existencia estimada hoy: ultimo conteo + compras posteriores. Sin conteo: solo compras (no es real). */
export function existenciaEstimada(conteos, compras) {
  const ultimo = conteoHasta(conteos, null)
  if (!ultimo) return { cantidad: comprasEntre(compras, null, null).cantidad, conConteo: false, ultimo: null }
  return { cantidad: ultimo.cantidad + comprasEntre(compras, ultimo.fecha, null).cantidad, conConteo: true, ultimo }
}

/**
 * Consumo real entre dos fechas de conteo (d0 < d1): inicial = ultimo conteo <= d0, final = ultimo conteo en (d0, d1].
 * Costo: precio promedio por unidad base de las compras del periodo (si no hubo, el de todas las compras).
 * Devuelve null si al articulo le falta alguno de los dos conteos.
 */
export function consumoReal(conteos, compras, d0, d1) {
  const inicial = conteoHasta(conteos, d0)
  const final = conteoHasta((conteos ?? []).filter(c => c.fecha > d0), d1)
  if (!inicial || !final) return null
  const entre = comprasEntre(compras, inicial.fecha, final.fecha)
  const consumo = inicial.cantidad + entre.cantidad - final.cantidad
  const todas = comprasEntre(compras, null, null)
  const precio = entre.cantidad > 0 ? entre.monto / entre.cantidad : todas.cantidad > 0 ? todas.monto / todas.cantidad : 0
  return { inicial: inicial.cantidad, compras: entre.cantidad, final: final.cantidad, consumo, costo: consumo * precio }
}
