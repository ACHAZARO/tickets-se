import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeBaseUnits, formatBaseUnits } from './units.mjs'

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

  it('formats missing quantity as a review marker', () => {
    assert.equal(formatBaseUnits(null), 'Revisar')
  })
})
