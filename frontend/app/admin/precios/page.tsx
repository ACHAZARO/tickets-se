'use client'

import { useEffect, useState, useCallback } from 'react'
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

export default function PreciosPage() {
  const { sucursalId, sucursales } = useSucursal()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [prods, setProds] = useState<ProdPrecio[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [soloCambios, setSoloCambios] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('precio_historial')
      .select('precio_unitario, fecha, created_at, sucursal_id, catalogo_productos:producto_catalogo_id(nombre, unidad_default)')
      .order('created_at', { ascending: true }).limit(5000)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    const { data } = await q

    const map = new Map<string, ProdPrecio>()
    for (const row of (data as unknown as Array<{ precio_unitario: number; fecha: string | null; created_at: string; catalogo_productos: { nombre: string; unidad_default: string | null } | null }>) ?? []) {
      const nombre = row.catalogo_productos?.nombre
      if (!nombre) continue
      const key = nombre.toLowerCase()
      if (!map.has(key)) map.set(key, { nombre, unidad: row.catalogo_productos?.unidad_default ?? null, puntos: [], ultimo: 0, anterior: null, variacion: null })
      map.get(key)!.puntos.push({ precio: Number(row.precio_unitario), fecha: row.fecha, created_at: row.created_at })
    }
    const list: ProdPrecio[] = []
    for (const p of map.values()) {
      const n = p.puntos.length
      p.ultimo = p.puntos[n - 1].precio
      p.anterior = n >= 2 ? p.puntos[n - 2].precio : null
      p.variacion = p.anterior && p.anterior > 0 ? ((p.ultimo - p.anterior) / p.anterior) * 100 : null
      list.push(p)
    }
    // ordena: primero los de mayor variación absoluta
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
        <p className="text-zinc-500 text-center py-12">{prods.length === 0 ? 'Aún no hay precios registrados. Se llenan cuando un renglón ligado a un producto trae cantidad y monto.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
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
                return (
                  <tr key={p.nombre} className="border-t border-zinc-800/50">
                    <td className="px-4 py-2.5 text-zinc-200">{p.nombre}{p.unidad ? <span className="text-zinc-600"> /{p.unidad}</span> : ''}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-200">{fmt(p.ultimo)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{p.anterior != null ? fmt(p.anterior) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right ${p.variacion == null ? 'text-zinc-600' : fuerte ? (sube ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold') : sube ? 'text-amber-400' : 'text-zinc-400'}`}>
                      {p.variacion == null ? '—' : `${sube ? '▲' : '▼'} ${Math.abs(p.variacion).toFixed(0)}%`}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{p.puntos.length}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
