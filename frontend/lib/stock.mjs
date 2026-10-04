// Calculos del Stock por conteo fisico (migracion 088). Sin dependencias de React para poder probarlos.
//
//   existencia estimada = ultimo conteo + compras despues de ese conteo
//   consumo real        = conteo inicial + compras entre los dos conteos - conteo final
//
// Las cantidades se comparan en la "unidad base" de cada articulo (la mas granular: g, ml, pz...).
import { toCanonical } from './units.mjs'

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
