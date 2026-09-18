// Cuadre de renglones contra el total del ticket.
// Las facturas imprimen cada renglon ANTES de impuestos (IVA, IEPS) y el total CON impuestos, asi que
// los reportes por categoria no sumaban lo pagado. Decision Alejandro (2026-09-18): los gastos van
// CON IVA para poder cotejarlos contra el ticket. El impuesto se suma SOLO a los renglones que lo
// pagan (hay facturas con productos tasa 0 e IEPS en un solo renglon) y solo si la diferencia se
// explica como impuesto; si no, se deja como esta y noCuadra() levanta la alerta.

type ConMonto = { monto: number | null }
type DatosImpuesto = { subtotal?: number | null; iva?: number | null; ieps?: number | null; tipo_documento?: string | null }

const redondea = (n: number) => Math.round(n * 100) / 100
const num = (x: unknown): number | null => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))

// Tasas por renglon: exento, IEPS 8% (botanas, dedos de queso), IVA 16%, IEPS 8% + IVA 16% sobre el precio con IEPS.
const TASAS = [0, 0.08, 0.16, 0.2528]

// Busca que tasa paga cada renglon para que la suma de impuestos de exacto la diferencia (y, si se
// leyo el IVA, que la parte de IVA de exacto el IVA). Devuelve el impuesto por renglon, o null si no
// hay una sola explicacion (ninguna o varias distintas).
function porTasas(montos: number[], gap: number, iva: number | null): number[] | null {
  const n = montos.length
  const tasas = n <= 7 ? TASAS : n <= 14 ? [0, 0.16] : null
  if (!tasas) return null
  const tol = Math.max(0.05, 0.01 * n)
  let solucion: number[] | null = null
  const idx = new Array(n).fill(0)
  const combinaciones = tasas.length ** n
  for (let c = 0; c < combinaciones; c++) {
    let k = c
    let imp = 0, parteIva = 0
    for (let i = 0; i < n; i++) {
      idx[i] = k % tasas.length; k = Math.floor(k / tasas.length)
      const t = tasas[idx[i]]
      imp += montos[i] * t
      if (t === 0.16) parteIva += montos[i] * 0.16
      else if (t === 0.2528) parteIva += montos[i] * 1.08 * 0.16
    }
    if (Math.abs(imp - gap) > tol) continue
    if (iva !== null && Math.abs(parteIva - iva) > tol) continue
    const impuestos = montos.map((m, i) => redondea(m * tasas[idx[i]]))
    if (solucion && solucion.some((v, i) => Math.abs(v - impuestos[i]) > 0.02)) return null // ambigua
    solucion = impuestos
  }
  return solucion
}

// Impuesto que le toca a cada renglon (mismo orden), o null si la diferencia total-suma no se puede
// explicar como impuesto. Reglas, en orden:
// 1) Todos los renglones con importe; diferencia positiva y menor a 50% (IEPS cerveza + IVA ~47%).
// 2) Si se leyo subtotal: debe ser la suma de renglones. Si se leyeron subtotal e IVA: subtotal + IVA
//    (+ IEPS) debe dar el total. Si solo IVA: la diferencia debe ser el IVA (+ IEPS). Sin subtotal ni
//    IVA leidos solo se acepta en facturas.
// 3) IVA parejo al 16% (lo normal en distribuidoras): se reparte proporcional en todos los renglones.
// 4) Si no, se busca que renglones pagan 16%/8% (solucion unica) y solo a esos se les suma.
// 5) Si no hay solucion unica, no se reparte (alerta monto_anomalo).
export function impuestosPorRenglon(items: ConMonto[], total: number | null, datos: DatosImpuesto): number[] | null {
  const T = num(total)
  if (T === null || !(T > 0) || !items.length || items.some(it => num(it.monto) === null)) return null
  const montos = items.map(it => Number(it.monto))
  const suma = montos.reduce((s, m) => s + m, 0)
  const gap = redondea(T - suma)
  if (!(suma > 0) || gap <= 0.5 || gap / suma > 0.5) return null

  const sub = num(datos.subtotal)
  const iva = num(datos.iva)
  const ieps = num(datos.ieps) ?? 0
  const tolera = (x: number) => Math.max(1, Math.abs(x) * 0.005)
  const leyoSub = sub !== null && sub > 0
  // Base gravable: el subtotal impreso es la suma de renglones, o la suma SIN el renglon de descuento
  // (facturas que imprimen el subtotal antes del descuento).
  let base: number | null = null
  if (leyoSub) {
    const positivos = montos.filter(m => m > 0).reduce((s, m) => s + m, 0)
    if (Math.abs(sub! - suma) <= tolera(sub!)) base = sub!
    else if (Math.abs(sub! - positivos) <= tolera(sub!)) base = sub! - (positivos - suma)
    else return null // faltan o sobran renglones
  }
  if (base !== null && iva !== null && Math.abs(base + iva + ieps - T) > tolera(T)) return null
  if (!leyoSub && iva !== null && Math.abs(iva + ieps - gap) > tolera(gap)) return null
  if (!leyoSub && iva === null && datos.tipo_documento !== 'factura') return null

  if (Math.abs(gap - suma * 0.16) <= Math.max(0.5, suma * 0.002)) return montos.map(m => m * gap / suma)
  // Si no hay una sola forma exacta de explicar el impuesto (dos renglones del mismo precio, o IEPS en
  // facturas de 8+ renglones) NO se reparte: repartir parejo le cargaria IVA a productos exentos.
  // El ticket queda con alerta monto_anomalo para revisarlo.
  return porTasas(montos, gap, iva !== null ? iva : null)
}

// Suma a cada renglon su impuesto y deja el centavo de redondeo en el renglon mas grande, para que
// la suma sea exactamente el total.
export function aplicarImpuestos(items: ConMonto[], impuestos: number[], total: number): void {
  items.forEach((it, i) => { it.monto = redondea(Number(it.monto) + impuestos[i]) })
  const resto = redondea(total - items.reduce((s, it) => s + Number(it.monto), 0))
  if (resto !== 0) {
    const mayor = items.reduce((a, b) => Math.abs(Number(b.monto)) > Math.abs(Number(a.monto)) ? b : a)
    mayor.monto = redondea(Number(mayor.monto) + resto)
  }
}

// Los renglones no suman el total: probable lectura incompleta o renglon mal leido. Renglones sin
// importe cuentan como 0, salvo que TODOS vengan sin importe (nota con solo el total).
// Tolerancia: tickets impresos $1 o 0.5%; notas a mano $1 o 2%.
export function noCuadra(items: ConMonto[], total: number | null, tipo?: string | null): boolean {
  const T = num(total)
  if (T === null || !(T > 0) || !items.length || items.every(it => num(it.monto) === null)) return false
  const suma = items.reduce((s, it) => s + (num(it.monto) ?? 0), 0)
  return Math.abs(T - suma) > Math.max(1, T * (tipo === 'nota_a_mano' ? 0.02 : 0.005))
}

// Sin total no se puede auditar el gasto. Excepcion: total 0 legitimo (descuento del 100%) con
// renglones que suman 0.
export function sinTotal(items: ConMonto[], total: number | null): boolean {
  const T = num(total)
  if (T !== null && T > 0) return false
  if (T === 0 && items.length && items.every(it => num(it.monto) !== null)) {
    return Math.abs(items.reduce((s, it) => s + Number(it.monto), 0)) > 0.5
  }
  return true
}
