import test from 'node:test'
import assert from 'node:assert/strict'
import { aUnidadBase, unidadesCompatibles, existenciaEstimada, consumoReal, comprasEntre } from './stock.mjs'

test('aUnidadBase convierte metricas y respeta unidades iguales', () => {
  assert.equal(aUnidadBase(2.5, 'kg', 'g'), 2500)
  assert.equal(aUnidadBase(1, 'lt', 'ml'), 1000)
  assert.equal(aUnidadBase(500, 'g', 'g'), 500)
  assert.equal(aUnidadBase(12, 'pz', 'pz'), 12)
  assert.equal(aUnidadBase(3, 'pz', 'g'), null) // no se puede
})

test('unidadesCompatibles', () => {
  assert.deepEqual(unidadesCompatibles('g'), ['g', 'kg'])
  assert.deepEqual(unidadesCompatibles('ml'), ['ml', 'lt'])
  assert.deepEqual(unidadesCompatibles('pz'), ['pz'])
})

const compras = [
  { fecha: '2026-09-05', cantidad: 10000, monto: 500 },  // 10 kg a $50/kg
  { fecha: '2026-09-20', cantidad: 5000, monto: 300 },   // 5 kg a $60/kg
  { fecha: '2026-10-02', cantidad: 2000, monto: 120 },
]
const conteos = [
  { fecha: '2026-09-01', cantidad: 3000 },
  { fecha: '2026-09-30', cantidad: 4000 },
]

test('existencia estimada = ultimo conteo + compras posteriores', () => {
  const e = existenciaEstimada(conteos, compras)
  assert.equal(e.conConteo, true)
  assert.equal(e.cantidad, 4000 + 2000)
  const sin = existenciaEstimada([], compras)
  assert.equal(sin.conConteo, false)
  assert.equal(sin.cantidad, 17000)
})

test('consumo real = inicial + compras entre conteos - final, con costo promedio del periodo', () => {
  const r = consumoReal(conteos, compras, '2026-09-01', '2026-09-30')
  assert.equal(r.inicial, 3000)
  assert.equal(r.compras, 15000)
  assert.equal(r.final, 4000)
  assert.equal(r.consumo, 14000)          // 3 + 15 - 4 = 14 kg
  assert.equal(Math.round(r.costo), Math.round(14000 * (800 / 15000)))
  assert.equal(consumoReal([{ fecha: '2026-09-30', cantidad: 1 }], compras, '2026-09-01', '2026-09-30'), null)
})

test('comprasEntre excluye el dia del conteo inicial e incluye el final', () => {
  assert.equal(comprasEntre(compras, '2026-09-05', '2026-09-20').cantidad, 5000)
})
