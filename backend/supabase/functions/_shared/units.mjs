// --- Conversiones de unidades estandar (metricas) ---
// Volumen -> canonico ml ; Masa -> canonico g.
// Permite que el sistema entienda lt<->ml, kg<->g, galon<->lt sin configurar nada.
const VOLUMEN = {
  ml: 1, mililitro: 1, mililitros: 1, cc: 1,
  l: 1000, lt: 1000, lts: 1000, litro: 1000, litros: 1000,
  gal: 3785.411784, galon: 3785.411784, 'galón': 3785.411784, galones: 3785.411784, gl: 3785.411784,
}
const MASA = {
  g: 1, gr: 1, grs: 1, gramo: 1, gramos: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
}

function infoUnidad(u) {
  const k = (typeof u === 'string' ? u.trim().toLowerCase() : '')
  if (!k) return null
  if (Object.prototype.hasOwnProperty.call(VOLUMEN, k)) return { factor: VOLUMEN[k], canon: 'ml', dim: 'vol' }
  if (Object.prototype.hasOwnProperty.call(MASA, k)) return { factor: MASA[k], canon: 'g', dim: 'masa' }
  return null
}

// Convierte (cantidad, unidad) a su unidad canonica si es metrica; si no, null.
export function toCanonical(quantity, unit) {
  const q = Number(quantity)
  const info = infoUnidad(unit)
  if (!info || !Number.isFinite(q)) return null
  return { quantity: q * info.factor, unit: info.canon, dim: info.dim }
}

// ¿Dos unidades son convertibles entre si? (ambas volumen, o ambas masa)
export function sameDimension(a, b) {
  const ia = infoUnidad(a), ib = infoUnidad(b)
  return !!(ia && ib && ia.dim === ib.dim)
}

// Para mostrar bonito: si es mucho ml/g, sube a lt/kg. No altera el calculo.
export function pretty(quantity, unit) {
  const q = Number(quantity)
  if (unit === 'ml' && Number.isFinite(q) && Math.abs(q) >= 1000) return { quantity: q / 1000, unit: 'lt' }
  if (unit === 'g' && Number.isFinite(q) && Math.abs(q) >= 1000) return { quantity: q / 1000, unit: 'kg' }
  return { quantity: q, unit }
}

export function computeBaseUnits(input) {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const c1 = Number(input.containsQuantity)
  const u1 = clean(input.containsUnit)
  const c2 = Number(input.subQuantity)
  const u2 = clean(input.subUnit)

  if (Number.isFinite(c1) && c1 > 0 && u1) {
    // Nivel 2 presente: 1 unidad = c1 u1, y cada u1 = c2 u2 -> total en u2 (normalizado si es metrico).
    if (Number.isFinite(c2) && c2 > 0 && u2) {
      return normalizar(quantity * c1 * c2, u2, 'equivalence2')
    }
    // Solo nivel 1: 1 unidad = c1 u1.
    return normalizar(quantity * c1, u1, 'equivalence')
  }

  // Sin equivalencia manual: si la unidad de compra es metrica (lt/kg/galon...),
  // la convertimos a su canonico (ml/g) para que sume y se compare bien.
  const purchaseUnit = clean(input.purchaseUnit)
  const metric = toCanonical(quantity, purchaseUnit)
  if (metric) return { quantity: metric.quantity, unit: metric.unit, source: 'metric' }

  const productName = clean(input.productName)
  return {
    quantity,
    unit: productName || purchaseUnit || 'unidad',
    source: 'identity',
  }
}

// Si la unidad final es metrica, la lleva a canonico (ml/g) conservando el "source".
function normalizar(q, u, source) {
  const c = toCanonical(q, u)
  if (c) return { quantity: c.quantity, unit: c.unit, source }
  return { quantity: q, unit: u, source }
}

// Devuelve TODAS las vistas de unidad para una cantidad dada, de la unidad de
// compra (la del ticket) a la mas granular. Ej. 2 caja con (24 pz, c/u 355 ml):
//   [{2,'caja'}, {48,'pz'}, {17040,'ml'}]
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
