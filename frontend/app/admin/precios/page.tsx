'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Punto { precio: number; fecha: string | null; created_at: string }
interface ProdPrecio {
  nombre: string
  unidad: string | null
  puntos: Punto[]
  ultimo: number
  anterior: number | null
  variacion: number | null // % vs anterior
}

const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

function Sparkline({ puntos }: { puntos: Punto[] }) {
  if (puntos.length < 2) return <p className="text-xs text-zinc-600">Solo hay un registro; aún no hay historia para graficar.</p>
  const W = 320, H = 60, pad = 6
  const precios = puntos.map(p => p.precio)
  const min = Math.min(...precios), max = Math.max(...precios)
  const span = max - min || 1
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (puntos.length - 1)
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const d = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.precio).toFixed(1)}`).join(' ')
  const ult = puntos[puntos.length - 1]
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 flex-1" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
        {puntos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.precio)} r="1.8" fill="#60a5fa" />)}
      </svg>
      <div className="text-xs text-zinc-500 whitespace-nowrap">
        <div>min {fmt(min)}</div>
        <div>max {fmt(max)}</div>
        <div className="text-zinc-300">últ {fmt(ult.precio)}</div>
      </div>
    </div>
  )
}

export default function PreciosPage() {
  const { sucursalId, sucursales } = useSucursal()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [prods, setProds] = useState<ProdPrecio[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [soloCambios, setSoloCambios] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Fuente real: renglones CONFIRMADOS con cantidad y monto -> precio unitario.
    // (No dependemos de precio_historial, asi aparecen TODOS los productos comprados.)
    let q = supabase.from('ticket_items')
      .select('descripcion, cantidad, unidad, monto, catalogo_productos:producto_catalogo_id(nombre, unidad_default), registros_tickets!inner(fecha_ticket, created_at, estado, sucursal_id)')
      .eq('registros_tickets.estado', 'confirmado').limit(8000)
    if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
    const { data } = await q

    const map = new Map<string, ProdPrecio>()
    for (const row of (data as unknown as Array<{ descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null; catalogo_productos: { nombre: string; unidad_default: string | null } | null; registros_tickets: { fecha_ticket: string | null; created_at: string } | null }>) ?? []) {
      const monto = Number(row.monto); const cant = Number(row.cantidad)
      if (!Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
      const nombre = (row.catalogo_productos?.nombre ?? row.descripcion ?? '').trim()
      if (!nombre) continue
      const key = nombre.toLowerCase()
      const unidad = row.catalogo_productos?.unidad_default ?? row.unidad ?? null
      if (!map.has(key)) map.set(key, { nombre, unidad, puntos: [], ultimo: 0, anterior: null, variacion: null })
      map.get(key)!.puntos.push({ precio: monto / cant, fecha: row.registros_tickets?.fecha_ticket ?? null, created_at: row.registros_tickets?.created_at ?? '' })
    }
    const list: ProdPrecio[] = []
    for (const p of map.values()) {
      // ordena los puntos cronologicamente (por fecha del ticket, luego subida)
      p.puntos.sort((a, b) => (a.fecha ?? a.created_at).localeCompare(b.fecha ?? b.created_at) || a.created_at.localeCompare(b.created_at))
      const n = p.puntos.length
      p.ultimo = p.puntos[n - 1].precio
      p.anterior = n >= 2 ? p.puntos[n - 2].precio : null
      p.variacion = p.anterior && p.anterior > 0 ? ((p.ultimo - p.anterior) / p.anterior) * 100 : null
      list.push(p)
    }
    list.sort((a, b) => Math.abs(b.variacion ?? 0) - Math.abs(a.variacion ?? 0) || b.ultimo - a.ultimo)
    setProds(list)
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  const filtrados = prods.filter(p =>
    (!filtro || p.nombre.toLowerCase().includes(filtro.toLowerCase())) &&
    (!soloCambios || (p.variacion != null && Math.abs(p.variacion) >= 15))
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Precios</h2>
        <p className="text-sm text-zinc-500 mt-1">{nombreSucursal} · precio unitario por producto y su variación. Los cambios fuertes (&gt;40%) además generan alerta al procesar.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar producto…"
          className="flex-1 min-w-[180px] rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={soloCambios} onChange={e => setSoloCambios(e.target.checked)} className="accent-blue-500" />
          Solo cambios ≥15%
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : filtrados.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">{prods.length === 0 ? 'Aún no hay precios: aparecen cuando hay tickets confirmados con cantidad y monto por renglón.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px] md:min-w-0">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left font-medium px-4 py-3">Producto</th>
                <th className="text-right font-medium px-4 py-3">Último</th>
                <th className="text-right font-medium px-4 py-3">Anterior</th>
                <th className="text-right font-medium px-4 py-3">Variación</th>
                <th className="text-right font-medium px-4 py-3">Registros</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const sube = (p.variacion ?? 0) > 0
                const fuerte = p.variacion != null && Math.abs(p.variacion) >= 40
                const exp = abierto === p.nombre
                return (
                  <Fragment key={p.nombre}>
                    <tr onClick={() => setAbierto(exp ? null : p.nombre)}
                      className="border-t border-zinc-800/50 cursor-pointer hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 text-zinc-200">{exp ? '▾ ' : '▸ '}{p.nombre}{p.unidad ? <span className="text-zinc-600"> /{p.unidad}</span> : ''}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-200">{fmt(p.ultimo)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{p.anterior != null ? fmt(p.anterior) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right ${p.variacion == null ? 'text-zinc-600' : fuerte ? (sube ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold') : sube ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {p.variacion == null ? '—' : `${sube ? '▲' : '▼'} ${Math.abs(p.variacion).toFixed(0)}%`}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{p.puntos.length}</td>
                    </tr>
                    {exp && (
                      <tr className="bg-zinc-950/40">
                        <td colSpan={5} className="px-4 py-3">
                          <Sparkline puntos={p.puntos} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
