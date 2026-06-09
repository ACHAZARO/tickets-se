export function computeBaseUnits(input) {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const c1 = Number(input.containsQuantity)
  const u1 = clean(input.containsUnit)
  const c2 = Number(input.subQuantity)
  const u2 = clean(input.subUnit)

  if (Number.isFinite(c1) && c1 > 0 && u1) {
    // Nivel 2 presente: 1 unidad = c1 u1, y cada u1 = c2 u2 -> total en la unidad mas granular (u2).
    if (Number.isFinite(c2) && c2 > 0 && u2) {
      return { quantity: quantity * c1 * c2, unit: u2, source: 'equivalence2' }
    }
    // Solo nivel 1: 1 unidad = c1 u1.
    return { quantity: quantity * c1, unit: u1, source: 'equivalence' }
  }

  const productName = clean(input.productName)
  const purchaseUnit = clean(input.purchaseUnit)
  return {
    quantity,
    unit: productName || purchaseUnit || 'unidad',
    source: 'identity',
  }
}

// Devuelve TODAS las vistas de unidad para una cantidad dada, de la unidad de
// compra (la del ticket) a la mas granular. Ej. 2 caja con (24 pz, c/u 355 ml):
//   [{2,'caja'}, {48,'pz'}, {17040,'ml'}]
// Asi una pantalla puede mostrar inventario en "caja" y recetas en "ml".
export function unitViews(input) {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return []
  const purchaseUnit = clean(input.purchaseUnit) || clean(input.productName) || 'unidad'
  const c1 = Number(input.containsQuantity)
  const u1 = clean(input.containsUnit)
  const c2 = Number(input.subQuantity)
  const u2 = clean(input.subUnit)

  const views = [{ quantity, unit: purchaseUnit }]
  if (Number.isFinite(c1) && c1 > 0 && u1) {
    views.push({ quantity: quantity * c1, unit: u1 })
    if (Number.isFinite(c2) && c2 > 0 && u2) {
      views.push({ quantity: quantity * c1 * c2, unit: u2 })
    }
  }
  return views
}

export function formatBaseUnits(result, maximumFractionDigits = 2) {
  if (!result) return 'Revisar'
  return `${result.quantity.toLocaleString('es-MX', { maximumFractionDigits })} ${result.unit}`
}

// "2 caja = 48 pz = 17,040 ml"
export function formatUnitViews(views, maximumFractionDigits = 2) {
  if (!views || views.length === 0) return ''
  return views
    .map(v => `${v.quantity.toLocaleString('es-MX', { maximumFractionDigits })} ${v.unit}`)
    .join(' = ')
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
