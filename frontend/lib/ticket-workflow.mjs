function addUnique(map, value) {
  const clean = String(value ?? '').trim()
  if (!clean) return
  const key = clean.toLowerCase()
  if (!map.has(key)) map.set(key, clean)
}

/**
 * @param {{
 *   existing?: string[],
 *   detectedName?: string,
 *   rowDescription?: string,
 *   oldCatalogName?: string,
 *   finalCatalogName?: string,
 *   manualText?: string,
 * }} [input]
 */
export function mergeProductSynonyms(input = {}) {
  const {
    existing = [],
    detectedName = '',
    rowDescription = '',
    oldCatalogName = '',
    finalCatalogName = '',
    manualText = '',
  } = input
  const merged = new Map()
  const finalKey = String(finalCatalogName ?? '').trim().toLowerCase()

  for (const s of existing) addUnique(merged, s)
  for (const s of [detectedName, rowDescription, oldCatalogName]) addUnique(merged, s)
  for (const s of String(manualText ?? '').split(',')) addUnique(merged, s)

  if (finalKey) merged.delete(finalKey)
  return [...merged.values()]
}

/**
 * @param {Array<{ tipo?: string }>} [alerts]
 * @param {boolean} [isOpenFraud]
 */
export function hasReviewAlert(alerts = [], isOpenFraud = false) {
  if (isOpenFraud) return false
  return alerts.length > 0
}

/**
 * @param {Array<{ orden?: number | null }>} [items]
 */
export function nextTicketItemOrder(items = []) {
  let max = -1
  for (const it of items) {
    const orden = Number(it?.orden)
    if (Number.isFinite(orden)) max = Math.max(max, orden)
  }
  return max + 1
}

/**
 * @param {{ detectedName?: string, rowDescription?: string, productName?: string }} [input]
 */
export function resolveItemDescription(input = {}) {
  const detectedName = String(input.detectedName ?? '').trim()
  const rowDescription = String(input.rowDescription ?? '').trim()
  const productName = String(input.productName ?? '').trim()
  const rowEdited = detectedName.toLowerCase() !== rowDescription.toLowerCase()
  return (!rowEdited && productName ? productName : rowDescription) || 'Producto'
}
