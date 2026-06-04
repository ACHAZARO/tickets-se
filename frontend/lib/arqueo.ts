// Logica pura de arqueo de costos (Fase 3).
// Sin dependencias de UI ni de Supabase: recibe datos y calcula.
// Gasto real (de tickets confirmados) vs ventas, % por categoria y semaforo.

export interface VentaMes {
  mes: string // 'YYYY-MM-01'
  monto: number
}

export interface GastoCategoria {
  categoria_id: string
  categoria_nombre: string
  gasto: number
}

export interface Objetivo {
  categoria_id: string
  pct_objetivo: number // 30 = 30%
}

export interface FilaArqueo {
  categoria_id: string
  categoria_nombre: string
  gasto: number
  pct_venta: number | null // gasto / venta * 100; null si venta = 0
  pct_objetivo: number | null
  estado: 'ok' | 'excede' | 'sin_objetivo' | 'sin_venta'
}

export interface ResultadoArqueo {
  ventaTotal: number
  gastoTotal: number
  pctGastoTotal: number | null
  filas: FilaArqueo[]
  estimado: boolean // true cuando la venta fue prorrateada (rango libre)
}

// --- Helpers de fecha (trabajan en UTC sobre 'YYYY-MM-DD') ---

/** Numero de dias del mes que contiene la fecha 'YYYY-MM-..' */
export function diasEnMes(anio: number, mesIdx0: number): number {
  return new Date(Date.UTC(anio, mesIdx0 + 1, 0)).getUTCDate()
}

/** Parsea 'YYYY-MM-DD' a {anio, mes0, dia} en UTC, ignorando hora. */
function parseISO(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

/** Dias (inclusive) entre dos fechas ISO. */
function diasInclusive(inicio: string, fin: string): number {
  const a = parseISO(inicio).getTime()
  const b = parseISO(fin).getTime()
  return Math.floor((b - a) / 86_400_000) + 1
}

/**
 * Prorratea ventas mensuales sobre un rango [inicio, fin] arbitrario.
 * Por cada mes tocado: monto * (dias del mes dentro del rango / dias del mes).
 * Devuelve la venta estimada total y si hubo prorrateo (rango no alineado a mes completo).
 */
export function prorratearVentas(
  ventas: VentaMes[],
  inicio: string,
  fin: string
): { venta: number; estimado: boolean } {
  const ini = parseISO(inicio)
  const end = parseISO(fin)
  let total = 0
  let estimado = false

  for (const v of ventas) {
    const mesIni = parseISO(v.mes)
    const anio = mesIni.getUTCFullYear()
    const mes0 = mesIni.getUTCMonth()
    const dias = diasEnMes(anio, mes0)
    const mesFin = new Date(Date.UTC(anio, mes0, dias))

    // interseccion [max(ini,mesIni), min(end,mesFin)]
    const lo = ini > mesIni ? ini : mesIni
    const hi = end < mesFin ? end : mesFin
    if (lo > hi) continue // mes fuera del rango

    const diasSolapados =
      Math.floor((hi.getTime() - lo.getTime()) / 86_400_000) + 1

    if (diasSolapados >= dias) {
      total += v.monto // mes completo
    } else {
      total += v.monto * (diasSolapados / dias)
      estimado = true
    }
  }
  return { venta: total, estimado }
}

/**
 * Calcula el arqueo: por categoria, gasto y % de venta vs objetivo.
 * `ventaTotal` ya viene resuelta (exacta para mes, prorrateada para rango libre).
 */
export function calcularArqueo(
  gastos: GastoCategoria[],
  ventaTotal: number,
  objetivos: Objetivo[],
  estimado = false
): ResultadoArqueo {
  const objByCat = new Map(objetivos.map(o => [o.categoria_id, o.pct_objetivo]))
  const gastoTotal = gastos.reduce((s, g) => s + g.gasto, 0)

  const filas: FilaArqueo[] = gastos
    .map(g => {
      const pctVenta = ventaTotal > 0 ? (g.gasto / ventaTotal) * 100 : null
      const pctObj = objByCat.has(g.categoria_id) ? objByCat.get(g.categoria_id)! : null
      let estado: FilaArqueo['estado']
      if (ventaTotal <= 0) estado = 'sin_venta'
      else if (pctObj == null) estado = 'sin_objetivo'
      else estado = (pctVenta as number) > pctObj ? 'excede' : 'ok'
      return {
        categoria_id: g.categoria_id,
        categoria_nombre: g.categoria_nombre,
        gasto: g.gasto,
        pct_venta: pctVenta,
        pct_objetivo: pctObj,
        estado,
      }
    })
    .sort((a, b) => b.gasto - a.gasto)

  return {
    ventaTotal,
    gastoTotal,
    pctGastoTotal: ventaTotal > 0 ? (gastoTotal / ventaTotal) * 100 : null,
    filas,
    estimado,
  }
}

/** Rango ISO [primer dia, ultimo dia] de un mes 'YYYY-MM'. */
export function rangoDeMes(mes: string): { inicio: string; fin: string } {
  const [y, m] = mes.split('-').map(Number)
  const dias = diasEnMes(y, m - 1)
  const mm = String(m).padStart(2, '0')
  return { inicio: `${y}-${mm}-01`, fin: `${y}-${mm}-${String(dias).padStart(2, '0')}` }
}

export { diasInclusive }
