'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  calcularArqueo, prorratearVentas, rangoDeMes,
  type GastoCategoria, type VentaMes, type Objetivo, type ResultadoArqueo,
} from '@/lib/arqueo'
import type { TicketDetalle } from '@/lib/export-xlsx'

interface Sucursal { id: string; nombre: string }

interface TicketRow {
  id: string
  fecha_ticket: string | null
  comercio: string | null
  producto: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
  categoria_gasto: string | null
  categorias_gasto: { nombre: string } | null
}

const DONUT_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#a3e635', '#f472b6']

function mesesRecientes(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth()
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    m--; if (m < 0) { m = 11; y-- }
  }
  return out
}

function nombreMesCorto(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' })
}

const MESES_SEL = mesesRecientes(12)
const MESES_TREND = mesesRecientes(6).reverse() // viejo -> nuevo
const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 })

type Modo = 'mes' | 'rango'

export default function DashboardPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [sucursalId, setSucursalId] = useState('')
  const [modo, setModo] = useState<Modo>('mes')
  const [mesSel, setMesSel] = useState(MESES_SEL[0])
  const [rangoIni, setRangoIni] = useState(rangoDeMes(MESES_SEL[0]).inicio)
  const [rangoFin, setRangoFin] = useState(rangoDeMes(MESES_SEL[0]).fin)

  const [arqueo, setArqueo] = useState<ResultadoArqueo | null>(null)
  const [detalle, setDetalle] = useState<TicketDetalle[]>([])
  const [trend, setTrend] = useState<{ mes: string; gasto: number; venta: number }[]>([])
  const [loading, setLoading] = useState(true)

  const { inicio, fin } = useMemo(() => {
    if (modo === 'mes') return rangoDeMes(mesSel)
    return { inicio: rangoIni, fin: rangoFin }
  }, [modo, mesSel, rangoIni, rangoFin])

  // Carga estatica
  useEffect(() => {
    (async () => {
      const [sucRes, objRes] = await Promise.all([
        supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
        supabase.from('objetivos_costo').select('categoria_id, pct_objetivo').is('sucursal_id', null).eq('activo', true),
      ])
      setSucursales(sucRes.data ?? [])
      setObjetivos((objRes.data as Objetivo[] | null) ?? [])
    })()
  }, [])

  const fetchArqueo = useCallback(async () => {
    setLoading(true)

    // Gastos: tickets confirmados en el rango
    let tq = supabase
      .from('registros_tickets')
      .select('id, fecha_ticket, comercio, producto, cantidad, unidad, monto, categoria_id, categoria_gasto, categorias_gasto:categoria_id(nombre)')
      .eq('estado', 'confirmado')
      .gte('fecha_ticket', inicio)
      .lte('fecha_ticket', fin)
    if (sucursalId) tq = tq.eq('sucursal_id', sucursalId)
    const { data: tickets } = await tq

    const rows = (tickets as unknown as TicketRow[]) ?? []

    // Agrupar gasto por categoria
    const grupos = new Map<string, GastoCategoria>()
    for (const t of rows) {
      const key = t.categoria_id ?? 'sin'
      const nombre = t.categorias_gasto?.nombre ?? t.categoria_gasto ?? 'Sin categoría'
      const prev = grupos.get(key) ?? { categoria_id: key, categoria_nombre: nombre, gasto: 0 }
      prev.gasto += Number(t.monto ?? 0)
      grupos.set(key, prev)
    }

    // Ventas: meses que toca el rango
    const mesIni = inicio.slice(0, 7) + '-01'
    const mesFin = fin.slice(0, 7) + '-01'
    let vq = supabase.from('ventas').select('sucursal_id, mes, monto').gte('mes', mesIni).lte('mes', mesFin)
    if (sucursalId) vq = vq.eq('sucursal_id', sucursalId)
    const { data: ventasData } = await vq
    const ventas: VentaMes[] = (ventasData ?? []).map(v => ({ mes: v.mes, monto: Number(v.monto) }))
    const { venta, estimado } = prorratearVentas(ventas, inicio, fin)

    setArqueo(calcularArqueo([...grupos.values()], venta, objetivos, estimado))
    setDetalle(rows.map(t => ({
      fecha_ticket: t.fecha_ticket,
      comercio: t.comercio,
      producto: t.producto,
      categoria: t.categorias_gasto?.nombre ?? t.categoria_gasto,
      cantidad: t.cantidad,
      unidad: t.unidad,
      monto: t.monto != null ? Number(t.monto) : null,
    })))
    setLoading(false)
  }, [inicio, fin, sucursalId, objetivos])

  useEffect(() => { fetchArqueo() }, [fetchArqueo])

  // Tendencia: 6 meses
  useEffect(() => {
    (async () => {
      const desde = MESES_TREND[0] + '-01'
      let tq = supabase.from('registros_tickets').select('fecha_ticket, monto').eq('estado', 'confirmado').gte('fecha_ticket', desde)
      let vq = supabase.from('ventas').select('mes, monto').gte('mes', desde)
      if (sucursalId) { tq = tq.eq('sucursal_id', sucursalId); vq = vq.eq('sucursal_id', sucursalId) }
      const [{ data: tk }, { data: vt }] = await Promise.all([tq, vq])
      const gastoPorMes = new Map<string, number>()
      for (const t of tk ?? []) {
        const m = (t.fecha_ticket ?? '').slice(0, 7)
        if (m) gastoPorMes.set(m, (gastoPorMes.get(m) ?? 0) + Number(t.monto ?? 0))
      }
      const ventaPorMes = new Map<string, number>()
      for (const v of vt ?? []) {
        const m = (v.mes ?? '').slice(0, 7)
        if (m) ventaPorMes.set(m, (ventaPorMes.get(m) ?? 0) + Number(v.monto))
      }
      setTrend(MESES_TREND.map(m => ({ mes: m, gasto: gastoPorMes.get(m) ?? 0, venta: ventaPorMes.get(m) ?? 0 })))
    })()
  }, [sucursalId])

  function onModoMes(ym: string) {
    setMesSel(ym)
    const r = rangoDeMes(ym)
    setRangoIni(r.inicio); setRangoFin(r.fin)
  }

  const periodoLabel = modo === 'mes'
    ? new Date(Date.UTC(+mesSel.split('-')[0], +mesSel.split('-')[1] - 1, 1)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${inicio} a ${fin}`

  const sucursalLabel = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? '') : 'Todas'

  // Donut: gradiente conico acumulado
  const donut = useMemo(() => {
    if (!arqueo || arqueo.gastoTotal <= 0) return { gradient: '#27272a', segs: [] as { nombre: string; pct: number; color: string }[] }
    let acc = 0
    const segs = arqueo.filas.map((f, i) => {
      const pct = (f.gasto / arqueo.gastoTotal) * 100
      const seg = { nombre: f.categoria_nombre, pct, color: DONUT_COLORS[i % DONUT_COLORS.length] }
      return seg
    })
    const stops = segs.map(s => { const from = acc; acc += s.pct; return `${s.color} ${from}% ${acc}%` }).join(', ')
    return { gradient: `conic-gradient(${stops})`, segs }
  }, [arqueo])

  const maxTrend = Math.max(1, ...trend.map(t => Math.max(t.gasto, t.venta)))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold text-zinc-100">Arqueo de costos</h2>
        <button
          onClick={async () => {
            if (!arqueo) return
            const { exportArqueoXlsx } = await import('@/lib/export-xlsx')
            exportArqueoXlsx(arqueo, detalle, { periodo: periodoLabel, sucursal: sucursalLabel })
          }}
          disabled={!arqueo}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          Exportar Excel
        </button>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-zinc-900 p-1">
          {(['mes', 'rango'] as Modo[]).map(m => (
            <button key={m} onClick={() => setModo(m)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${modo === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}>
              {m === 'mes' ? 'Por mes' : 'Rango'}
            </button>
          ))}
        </div>

        {modo === 'mes' ? (
          <select value={mesSel} onChange={e => onModoMes(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 capitalize">
            {MESES_SEL.map(m => (
              <option key={m} value={m}>
                {new Date(Date.UTC(+m.split('-')[0], +m.split('-')[1] - 1, 1)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input type="date" value={rangoIni} onChange={e => setRangoIni(e.target.value)}
              className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
            <span className="text-zinc-600">→</span>
            <input type="date" value={rangoFin} onChange={e => setRangoFin(e.target.value)}
              className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
          </div>
        )}

        <select value={sucursalId} onChange={e => setSucursalId(e.target.value)}
          className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100">
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {loading || !arqueo ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
        </div>
      ) : (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Venta" value={fmt(arqueo.ventaTotal)} hint={arqueo.estimado ? 'estimada' : undefined} />
            <Card label="Gasto" value={fmt(arqueo.gastoTotal)} />
            <Card label="Gasto % de venta"
              value={arqueo.pctGastoTotal != null ? arqueo.pctGastoTotal.toFixed(1) + '%' : '—'}
              color="text-blue-400" />
            <Card label="Tickets" value={String(detalle.length)} />
          </div>

          {(arqueo.ventaTotal <= 0) && (
            <div className="rounded-xl bg-amber-900/20 border border-amber-800/30 px-4 py-3 text-sm text-amber-400">
              No hay venta capturada para este periodo. Captúrala en <a href="/admin/ventas" className="underline">Ventas</a> para ver los %.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tabla de arqueo */}
            <div className="rounded-2xl bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="text-left font-medium px-4 py-3">Categoría</th>
                    <th className="text-right font-medium px-4 py-3">Gasto</th>
                    <th className="text-right font-medium px-4 py-3">% vta</th>
                    <th className="text-right font-medium px-4 py-3">Obj.</th>
                  </tr>
                </thead>
                <tbody>
                  {arqueo.filas.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">Sin gastos confirmados en el periodo</td></tr>
                  ) : arqueo.filas.map((f, i) => (
                    <tr key={f.categoria_id} className="border-b border-zinc-800/50 last:border-0">
                      <td className="px-4 py-2.5 text-zinc-200">
                        <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        {f.categoria_nombre}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-300">{fmt(f.gasto)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-300">{f.pct_venta != null ? f.pct_venta.toFixed(1) + '%' : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {f.pct_objetivo != null ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            f.estado === 'excede' ? 'bg-red-900/40 text-red-400' :
                            f.estado === 'ok' ? 'bg-emerald-900/40 text-emerald-400' : 'text-zinc-500'
                          }`}>{f.pct_objetivo}%</span>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Donut */}
            <div className="rounded-2xl bg-zinc-900 p-5 flex flex-col items-center justify-center gap-4">
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 self-start">Distribución del gasto</p>
              <div className="relative h-44 w-44 rounded-full" style={{ background: donut.gradient }}>
                <div className="absolute inset-[22%] rounded-full bg-zinc-900 flex items-center justify-center">
                  <span className="text-sm text-zinc-400">{fmt(arqueo.gastoTotal)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 w-full">
                {donut.segs.map(s => (
                  <div key={s.nombre} className="flex items-center gap-2 text-xs text-zinc-400 truncate">
                    <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="truncate">{s.nombre}</span>
                    <span className="ml-auto text-zinc-500">{s.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tendencia */}
          <div className="rounded-2xl bg-zinc-900 p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-4">Tendencia (6 meses) · gasto vs venta</p>
            <div className="flex items-end justify-between gap-2 h-40">
              {trend.map(t => {
                const pct = t.venta > 0 ? (t.gasto / t.venta) * 100 : null
                return (
                  <div key={t.mes} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full flex items-end justify-center gap-1 h-32">
                      <div className="w-3 rounded-t bg-zinc-600" style={{ height: `${(t.venta / maxTrend) * 100}%` }} title={`Venta ${fmt(t.venta)}`} />
                      <div className="w-3 rounded-t bg-blue-500" style={{ height: `${(t.gasto / maxTrend) * 100}%` }} title={`Gasto ${fmt(t.gasto)}`} />
                    </div>
                    <span className="text-[10px] text-zinc-500 capitalize">{nombreMesCorto(t.mes)}</span>
                    <span className="text-[10px] text-zinc-600">{pct != null ? pct.toFixed(0) + '%' : '—'}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-zinc-600" />Venta</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-blue-500" />Gasto</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}{hint && <span className="text-amber-500/70"> · {hint}</span>}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-zinc-100'}`}>{value}</p>
    </div>
  )
}
