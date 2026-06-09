import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeBaseUnits, formatBaseUnits, unitViews } from './units.mjs'

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
