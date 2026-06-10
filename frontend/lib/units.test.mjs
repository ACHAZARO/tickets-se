import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeBaseUnits, formatBaseUnits, unitViews, toCanonical, sameDimension, pretty } from './units.mjs'

describe('computeBaseUnits', () => {
  it('uses explicit catalog equivalence when present', () => {
    const result = computeBaseUnits({
      productName: 'Agua Mineral Penafiel',
      quantity: 5,
      purchaseUnit: 'pz',
      containsQuantity: 24,
      containsUnit: 'Agua Mineral Penafiel 355ml',
    })

    assert.deepEqual(result, {
      quantity: 120,
      unit: 'Agua Mineral Penafiel 355ml',
      source: 'equivalence',
    })
  })

  it('falls back to one product as one base unit', () => {
    const result = computeBaseUnits({
      productName: 'Pan de Nutella',
      quantity: 7,
      purchaseUnit: 'pz',
      containsQuantity: null,
      containsUnit: null,
    })

    assert.deepEqual(result, {
      quantity: 7,
      unit: 'Pan de Nutella',
      source: 'identity',
    })
  })

  it('expands two-level equivalence to the most granular unit', () => {
    // 2 caja, cada caja = 24 pz, cada pz = 355 ml -> 2*24*355 = 17040 ml
    const result = computeBaseUnits({
      productName: 'Caja medias crema',
      quantity: 2,
      purchaseUnit: 'caja',
      containsQuantity: 24,
      containsUnit: 'pz',
      subQuantity: 355,
      subUnit: 'ml',
    })
    assert.deepEqual(result, { quantity: 17040, unit: 'ml', source: 'equivalence2' })
  })

  it('formats missing quantity as a review marker', () => {
    assert.equal(formatBaseUnits(null), 'Revisar')
  })
})

describe('conversiones metricas', () => {
  it('convierte 2.5 lt a 2500 ml (volumen)', () => {
    const r = computeBaseUnits({ productName: 'Leche', quantity: 2.5, purchaseUnit: 'lt', containsQuantity: null, containsUnit: null })
    assert.deepEqual(r, { quantity: 2500, unit: 'ml', source: 'metric' })
  })

  it('convierte kg a g y galon a ml', () => {
    assert.deepEqual(toCanonical(3, 'kg'), { quantity: 3000, unit: 'g', dim: 'masa' })
    assert.deepEqual(toCanonical(1, 'galon'), { quantity: 3785.411784, unit: 'ml', dim: 'vol' })
    assert.equal(toCanonical(5, 'pz'), null) // no es metrico
  })

  it('normaliza la unidad final de una equivalencia metrica', () => {
    // 1 garrafon = 20 lt -> 20000 ml
    const r = computeBaseUnits({ productName: 'Agua', quantity: 1, purchaseUnit: 'garrafon', containsQuantity: 20, containsUnit: 'lt' })
    assert.deepEqual(r, { quantity: 20000, unit: 'ml', source: 'equivalence' })
  })

  it('reconoce dimensiones compatibles y formatea bonito', () => {
    assert.equal(sameDimension('lt', 'ml'), true)
    assert.equal(sameDimension('kg', 'g'), true)
    assert.equal(sameDimension('lt', 'kg'), false)
    assert.deepEqual(pretty(2500, 'ml'), { quantity: 2.5, unit: 'lt' })
    assert.deepEqual(pretty(500, 'ml'), { quantity: 500, unit: 'ml' })
  })
})

describe('unitViews', () => {
  it('returns caja, pieza and ml views for a two-level product', () => {
    const views = unitViews({
      productName: 'Caja medias crema',
      quantity: 2,
      purchaseUnit: 'caja',
      containsQuantity: 24,
      containsUnit: 'pz',
      subQuantity: 355,
      subUnit: 'ml',
    })
    assert.deepEqual(views, [
      { quantity: 2, unit: 'caja' },
      { quantity: 48, unit: 'pz' },
      { quantity: 17040, unit: 'ml' },
    ])
  })
})
