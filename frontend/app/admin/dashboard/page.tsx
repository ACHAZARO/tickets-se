'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { rangoDeMes } from '@/lib/arqueo'
import type { TicketDetalle, ResumenCategoria } from '@/lib/export-xlsx'

interface ItemRow {
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
  categorias_gasto: { nombre: string } | null
  catalogo_productos: { nombre: string } | null
  registros_tickets: { id: string; fecha_ticket: string | null; comercio: string | null } | null
}
interface CatAgg { id: string; nombre: string; gasto: number; operativo: boolean }
interface ProductoAgg { nombre: string; reconocido: boolean; gasto: number; veces: number; cantidad: number; unidad: string | null; unidadMixta: boolean }

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#a3e635', '#f472b6', '#94a3b8']

function mesesRecientes(n: number): string[] {
  const out: string[] = []
  const now = new Date(); let y = now.getUTCFullYear(); let m = now.getUTCMonth()
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m + 1).padStart(2, '0')}`); m--; if (m < 0) { m = 11; y-- } }
  return out
}
const nombreMesCorto = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' })
}
const nombreMesLargo = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const MESES_SEL = mesesRecientes(12)
const MESES_TREND = mesesRecientes(6).reverse()
const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fmt2 = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

// Arco de dona (SVG) de a0 a a1 radianes, radio externo R, interno r.
function arc(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const p = (rad: number, ang: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]
  const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1)
  const [xi1, yi1] = p(r, a1), [xi0, yi0] = p(r, a0)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${r} ${r} 0 ${large} 0 ${xi0} ${yi0} Z`
}

type Modo = 'mes' | 'rango'

export default function DashboardPage() {
  const { sucursalId, sucursales } = useSucursal()
  const [modo, setModo] = useState<Modo>('mes')
  const [mesSel, setMesSel] = useState(MESES_SEL[0])
  const [rangoIni, setRangoIni] = useState(rangoDeMes(MESES_SEL[0]).inicio)
  const [rangoFin, setRangoFin] = useState(rangoDeMes(MESES_SEL[0]).fin)

  const [cats, setCats] = useState<CatAgg[]>([])
  const [nTickets, setNTickets] = useState(0)
  const [detalle, setDetalle] = useState<TicketDetalle[]>([])
  const [productosTop, setProductosTop] = useState<ProductoAgg[]>([])
  const [trend, setTrend] = useState<{ mes: string; gasto: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<number | null>(null)

  const { inicio, fin } = useMemo(() => modo === 'mes' ? rangoDeMes(mesSel) : { inicio: rangoIni, fin: rangoFin },
    [modo, mesSel, rangoIni, rangoFin])

  const fetchData = useCallback(async () => {
    setLoading(true)
    // mapa de categorias -> operativo
    let catQ = supabase.from('categorias_gasto').select('id, cuenta_operativo, sucursal_id')
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ.is('sucursal_id', null)
    const { data: catData } = await catQ
    const opMap = new Map<string, boolean>()
    for (const c of catData ?? []) opMap.set(c.id as string, (c.cuenta_operativo as boolean) ?? true)

    // items confirmados en el rango
    let tq = supabase.from('ticket_items')
      .select('descripcion, cantidad, unidad, monto, categoria_id, categorias_gasto:categoria_id(nombre), catalogo_productos:producto_catalogo_id(nombre), registros_tickets!inner(id, fecha_ticket, comercio, estado, sucursal_id)')
      .eq('registros_tickets.estado', 'confirmado')
      .gte('registros_tickets.fecha_ticket', inicio).lte('registros_tickets.fecha_ticket', fin)
    if (sucursalId) tq = tq.eq('registros_tickets.sucursal_id', sucursalId)
    const { data } = await tq
    const rows = (data as unknown as ItemRow[]) ?? []

    // por categoria
    const cmap = new Map<string, CatAgg>()
    const tickets = new Set<string>()
    for (const t of rows) {
      const id = t.categoria_id ?? 'sin'
      const operativo = t.categoria_id ? (opMap.get(t.categoria_id) ?? true) : true
      const nombre = t.categorias_gasto?.nombre ?? 'Sin categoría'
      const prev = cmap.get(id) ?? { id, nombre, gasto: 0, operativo }
      prev.gasto += Number(t.monto ?? 0)
      cmap.set(id, prev)
      if (t.registros_tickets?.id) tickets.add(t.registros_tickets.id)
    }
    setCats([...cmap.values()].sort((a, b) => b.gasto - a.gasto))
    setNTickets(tickets.size)

    // por producto (sinonimos -> producto canonico)
    const pmap = new Map<string, ProductoAgg>()
    for (const t of rows) {
      const reconocido = !!t.catalogo_productos?.nombre
      const nombre = (t.catalogo_productos?.nombre ?? t.descripcion ?? 'Sin nombre').trim()
      const key = nombre.toLowerCase()
      const prev = pmap.get(key) ?? { nombre, reconocido, gasto: 0, veces: 0, cantidad: 0, unidad: null as string | null, unidadMixta: false }
      prev.gasto += Number(t.monto ?? 0); prev.veces += 1; if (reconocido) prev.reconocido = true
      prev.cantidad += Number(t.cantidad ?? 0)
      const u = t.unidad?.trim() || null
      if (u) { if (prev.unidad && prev.unidad !== u) prev.unidadMixta = true; else if (!prev.unidad) prev.unidad = u }
      pmap.set(key, prev)
    }
    setProductosTop([...pmap.values()].sort((a, b) => b.gasto - a.gasto))

    setDetalle(rows.map(t => ({
      fecha_ticket: t.registros_tickets?.fecha_ticket ?? null,
      comercio: t.registros_tickets?.comercio ?? null,
      producto: t.descripcion, categoria: t.categorias_gasto?.nombre ?? null,
      cantidad: t.cantidad, unidad: t.unidad, monto: t.monto != null ? Number(t.monto) : null,
    })))
    setLoading(false)
  }, [inicio, fin, sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  // tendencia: gasto operativo por mes (6 meses)
  useEffect(() => {
    (async () => {
      const desde = MESES_TREND[0] + '-01'
      let catQ = supabase.from('categorias_gasto').select('id, cuenta_operativo, sucursal_id')
      catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ.is('sucursal_id', null)
      let tq = supabase.from('ticket_items')
        .select('monto, categoria_id, registros_tickets!inner(fecha_ticket, estado, sucursal_id)')
        .eq('registros_tickets.estado', 'confirmado').gte('registros_tickets.fecha_ticket', desde)
      if (sucursalId) tq = tq.eq('registros_tickets.sucursal_id', sucursalId)
      const [{ data: catData }, { data: items }] = await Promise.all([catQ, tq])
      const opMap = new Map<string, boolean>()
      for (const c of catData ?? []) opMap.set(c.id as string, (c.cuenta_operativo as boolean) ?? true)
      const porMes = new Map<string, number>()
      for (const it of (items as unknown as ItemRow[]) ?? []) {
        const op = it.categoria_id ? (opMap.get(it.categoria_id) ?? true) : true
        if (!op) continue
        const m = (it.registros_tickets?.fecha_ticket ?? '').slice(0, 7)
        if (m) porMes.set(m, (porMes.get(m) ?? 0) + Number(it.monto ?? 0))
      }
      setTrend(MESES_TREND.map(m => ({ mes: m, gasto: porMes.get(m) ?? 0 })))
    })()
  }, [sucursalId])

  function onModoMes(ym: string) { setMesSel(ym); const r = rangoDeMes(ym); setRangoIni(r.inicio); setRangoFin(r.fin) }

  const operativas = cats.filter(c => c.operativo)
  const noOperativas = cats.filter(c => !c.operativo)
  const gastoOperativo = operativas.reduce((s, c) => s + c.gasto, 0)
  const gastoNoOperativo = noOperativas.reduce((s, c) => s + c.gasto, 0)

  const periodoLabel = modo === 'mes' ? nombreMesLargo(mesSel) : `${inicio} a ${fin}`
  const sucursalLabel = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? '') : 'Todas'
  const maxTrend = Math.max(1, ...trend.map(t => t.gasto))

  // segmentos de dona (categorias operativas)
  const segs = useMemo(() => {
    if (gastoOperativo <= 0) return [] as { nombre: string; gasto: number; pct: number; color: string; d: string }[]
    let acc = -Math.PI / 2
    return operativas.map((c, i) => {
      const pct = c.gasto / gastoOperativo
      const a0 = acc, a1 = acc + pct * 2 * Math.PI; acc = a1
      return { nombre: c.nombre, gasto: c.gasto, pct: pct * 100, color: COLORS[i % COLORS.length], d: arc(50, 50, 46, 30, a0, a1 - 0.0001) }
    })
  }, [operativas, gastoOperativo])

  async function exportar() {
    const { exportGastoXlsx } = await import('@/lib/export-xlsx')
    const categorias: ResumenCategoria[] = cats.map(c => ({
      nombre: c.nombre, gasto: c.gasto, operativo: c.operativo,
      pct: gastoOperativo > 0 && c.operativo ? (c.gasto / gastoOperativo) * 100 : 0,
    }))
    exportGastoXlsx({ periodo: periodoLabel, sucursal: sucursalLabel, gastoOperativo, gastoNoOperativo, categorias, detalle })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold text-zinc-100">Gasto · {sucursalLabel}</h2>
        <button onClick={exportar} disabled={cats.length === 0}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">
          Exportar Excel
        </button>
      </div>

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
            {MESES_SEL.map(m => <option key={m} value={m}>{nombreMesLargo(m)}</option>)}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input type="date" value={rangoIni} onChange={e => setRangoIni(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
            <span className="text-zinc-600">→</span>
            <input type="date" value={rangoFin} onChange={e => setRangoFin(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card label="Gasto operativo" value={fmt(gastoOperativo)} color="text-blue-400" />
            <Card label="Tickets" value={String(nTickets)} />
            {gastoNoOperativo > 0 && <Card label="Gasto no operativo" value={fmt(gastoNoOperativo)} color="text-zinc-400" hint="no entra a la distribución" />}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tabla por categoria */}
            <div className="rounded-2xl bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="text-left font-medium px-4 py-3">Categoría</th>
                    <th className="text-right font-medium px-4 py-3">Gasto</th>
                    <th className="text-right font-medium px-4 py-3">% gasto</th>
                  </tr>
                </thead>
                <tbody>
                  {operativas.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-zinc-500">Sin gastos confirmados en el periodo</td></tr>
                  ) : operativas.map((c, i) => (
                    <tr key={c.id} className={`border-b border-zinc-800/50 last:border-0 ${hover === i ? 'bg-zinc-800/40' : ''}`}
                      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                      <td className="px-4 py-2.5 text-zinc-200">
                        <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: COLORS[i % COLORS.length] }} />
                        {c.nombre}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-300">{fmt2(c.gasto)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">{gastoOperativo > 0 ? ((c.gasto / gastoOperativo) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>
                  ))}
                  {noOperativas.map(c => (
                    <tr key={c.id} className="border-t border-zinc-800/50 opacity-60">
                      <td className="px-4 py-2.5 text-zinc-400">{c.nombre} <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">no operativo</span></td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">{fmt2(c.gasto)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Dona interactiva */}
            <div className="rounded-2xl bg-zinc-900 p-5 flex flex-col items-center justify-center gap-4">
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 self-start">Distribución del gasto</p>
              <div className="relative h-48 w-48">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-0">
                  {segs.length === 0 && <circle cx="50" cy="50" r="38" fill="none" stroke="#27272a" strokeWidth="16" />}
                  {segs.map((s, i) => (
                    <path key={i} d={s.d} fill={s.color} stroke="#18181b" strokeWidth="0.5"
                      opacity={hover === null || hover === i ? 1 : 0.35}
                      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                      style={{ cursor: 'pointer', transition: 'opacity .15s' }} />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  {hover !== null && segs[hover] ? (
                    <>
                      <span className="text-xs text-zinc-400">{segs[hover].nombre}</span>
                      <span className="text-base font-semibold text-zinc-100">{fmt2(segs[hover].gasto)}</span>
                      <span className="text-xs text-zinc-500">{segs[hover].pct.toFixed(0)}%</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-zinc-100">{fmt(gastoOperativo)}</span>
                      <span className="text-[10px] text-zinc-500">operativo</span>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 w-full">
                {segs.map((s, i) => (
                  <div key={s.nombre} className={`flex items-center gap-2 text-xs truncate ${hover === i ? 'text-zinc-200' : 'text-zinc-400'}`}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="truncate">{s.nombre}</span>
                    <span className="ml-auto text-zinc-500">{s.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tendencia (solo gasto operativo) */}
          <div className="rounded-2xl bg-zinc-900 p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-4">Tendencia del gasto operativo (6 meses)</p>
            <div className="flex items-end justify-between gap-2 h-40">
              {trend.map(t => (
                <div key={t.mes} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{t.gasto > 0 ? fmt(t.gasto) : ''}</span>
                  <div className="w-full flex items-end justify-center h-28">
                    <div className="w-5 rounded-t bg-blue-500" style={{ height: `${(t.gasto / maxTrend) * 100}%` }} title={fmt(t.gasto)} />
                  </div>
                  <span className="text-[10px] text-zinc-500 capitalize">{nombreMesCorto(t.mes)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Productos mas comprados */}
          <div className="rounded-2xl bg-zinc-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Productos más comprados</p>
              <span className="text-xs text-zinc-600">marcas/sinónimos sumados a su producto</span>
            </div>
            {productosTop.length === 0 ? (
              <p className="px-4 py-6 text-center text-zinc-500 text-sm">Sin productos en el periodo</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-zinc-500"><th className="text-left font-medium px-4 py-2">Producto</th><th className="text-right font-medium px-4 py-2">Cantidad</th><th className="text-right font-medium px-4 py-2">Veces</th><th className="text-right font-medium px-4 py-2">Gasto</th></tr></thead>
                <tbody>
                  {productosTop.slice(0, 40).map(p => (
                    <tr key={p.nombre} className="border-t border-zinc-800/50">
                      <td className="px-4 py-2 text-zinc-200">{p.nombre}
                        {p.reconocido
                          ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400">catálogo</span>
                          : <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">sin catálogo</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {p.cantidad > 0 ? `${p.cantidad.toLocaleString('es-MX', { maximumFractionDigits: 2 })}${p.unidadMixta ? '' : p.unidad ? ' ' + p.unidad : ''}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">{p.veces}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">{fmt2(p.gasto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}{hint && <span className="text-zinc-600"> · {hint}</span>}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-zinc-100'}`}>{value}</p>
    </div>
  )
}
