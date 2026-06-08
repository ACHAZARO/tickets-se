export function computeBaseUnits(input) {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const containsQuantity = Number(input.containsQuantity)
  const containsUnit = clean(input.containsUnit)
  if (Number.isFinite(containsQuantity) && containsQuantity > 0 && containsUnit) {
    return {
      quantity: quantity * containsQuantity,
      unit: containsUnit,
      source: 'equivalence',
    }
  }

  const productName = clean(input.productName)
  const purchaseUnit = clean(input.purchaseUnit)
  return {
    quantity,
    unit: productName || purchaseUnit || 'unidad',
    source: 'identity',
  }
}

export function formatBaseUnits(result, maximumFractionDigits = 2) {
  if (!result) return 'Revisar'
  return `${result.quantity.toLocaleString('es-MX', { maximumFractionDigits })} ${result.unit}`
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
