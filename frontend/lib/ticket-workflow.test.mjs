import test from 'node:test'
import assert from 'node:assert/strict'

import { hasReviewAlert, mergeProductSynonyms, nextTicketItemOrder, resolveItemDescription } from './ticket-workflow.mjs'

test('mergeProductSynonyms keeps OCR text and old names as synonyms when product is renamed', () => {
  const result = mergeProductSynonyms({
    existing: ['XX Lager', 'packce123'],
    detectedName: 'PACKCE123',
    rowDescription: 'PACKCE123',
    oldCatalogName: 'Cerveza anterior',
    finalCatalogName: 'Caja de cerveza XX',
    manualText: 'XX 355, caja 24',
  })

  assert.deepEqual(result, ['XX Lager', 'packce123', 'Cerveza anterior', 'XX 355', 'caja 24'])
})

test('hasReviewAlert excludes tickets that are already in open fraud review', () => {
  const alerts = [{ tipo: 'producto_no_reconocido' }, { tipo: 'sin_unidad' }]

  assert.equal(hasReviewAlert(alerts, true), false)
  assert.equal(hasReviewAlert(alerts, false), true)
})

test('nextTicketItemOrder appends after the highest known order', () => {
  assert.equal(nextTicketItemOrder([{ orden: 0 }, { orden: 3 }, { orden: null }]), 4)
  assert.equal(nextTicketItemOrder([]), 0)
})

test('resolveItemDescription uses linked product name when OCR text was not manually edited', () => {
  assert.equal(resolveItemDescription({
    detectedName: 'PACKCE123',
    rowDescription: 'PACKCE123',
    productName: 'Caja de cerveza XX',
  }), 'Caja de cerveza XX')

  assert.equal(resolveItemDescription({
    detectedName: 'PACKCE123',
    rowDescription: 'Caja cerveza XX 24 pz',
    productName: 'Caja de cerveza XX',
  }), 'Caja cerveza XX 24 pz')
})
