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

export function ticketStatusLabel(status) {
  const labels = {
    pendiente: 'Por confirmar',
    confirmado: 'Confirmado',
    rechazado: 'Rechazado',
    archivado: 'Archivado',
  }
  return labels[String(status ?? '')] ?? String(status ?? '')
}

export function ticketFilterLabel(filter) {
  const labels = {
    todos: 'Todos',
    pendientes: 'Por confirmar',
    alertas: 'Requieren revision',
    confirmados: 'Confirmados',
    fraude: 'Fraude',
  }
  return labels[String(filter ?? '')] ?? String(filter ?? '')
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {{
 *   baseQty?: string | number | null,
 *   baseUnit?: string | null,
 *   baseItem?: string | null,
 *   subQty?: string | number | null,
 *   subUnit?: string | null,
 * }} input
 */
export function buildEquivalenceUpdate(input) {
  const baseQty = positiveNumber(input?.baseQty)
  const baseUnit = cleanText(input?.baseUnit) || null
  const baseItem = cleanText(input?.baseItem) || null
  const subQty = positiveNumber(input?.subQty)
  const subUnit = cleanText(input?.subUnit) || null

  const out = {
    contiene_cantidad: baseQty,
    contiene_unidad: baseUnit,
    contiene_sub_cantidad: null,
    contiene_sub_unidad: null,
  }

  if (!baseQty || !baseUnit) return out
  if (subQty && subUnit) {
    out.contiene_sub_cantidad = subQty
    out.contiene_sub_unidad = subUnit
  } else if (baseItem && baseItem.toLowerCase() !== baseUnit.toLowerCase()) {
    out.contiene_sub_cantidad = 1
    out.contiene_sub_unidad = baseItem
  }
  return out
}
