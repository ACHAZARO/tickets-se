'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Categoria { id: string; nombre: string }
interface Huerfano {
  nombre: string          // descripcion representativa
  veces: number
  gasto: number
  comercios: string[]
  // borrador de liga
  categoria_id: string
  unidad: string
  sinonimos: string
}

const UNIDADES = ['kg', 'g', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

export default function HuerfanosPage() {
  const { sucursalId } = useSucursal()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [huerfanos, setHuerfanos] = useState<Huerfano[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ.is('sucursal_id', null)

    let itemsQ = supabase.from('ticket_items')
      .select('descripcion, monto, registros_tickets!inner(comercio, sucursal_id)')
      .is('categoria_id', null).limit(4000)
    if (sucursalId) itemsQ = itemsQ.eq('registros_tickets.sucursal_id', sucursalId)

    const [catRes, itemsRes] = await Promise.all([catQ, itemsQ])
    setCategorias(catRes.data ?? [])

    const agg = new Map<string, { nombre: string; veces: number; gasto: number; comercios: Set<string> }>()
    for (const row of (itemsRes.data as unknown as Array<{ descripcion: string; monto: number | null; registros_tickets: { comercio: string | null } | null }>) ?? []) {
      const desc = (row.descripcion ?? '').trim()
      if (!desc) continue
      const key = desc.toLowerCase()
      if (!agg.has(key)) agg.set(key, { nombre: desc, veces: 0, gasto: 0, comercios: new Set() })
      const g = agg.get(key)!
      g.veces++
      g.gasto += Number(row.monto) || 0
      const com = row.registros_tickets?.comercio?.trim()
      if (com) g.comercios.add(com)
    }
    const list: Huerfano[] = [...agg.values()]
      .sort((a, b) => b.veces - a.veces)
      .map(g => ({ nombre: g.nombre, veces: g.veces, gasto: g.gasto, comercios: [...g.comercios], categoria_id: '', unidad: '', sinonimos: '' }))
    setHuerfanos(list)
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  function setCampo(nombre: string, campo: 'categoria_id' | 'unidad' | 'sinonimos', valor: string) {
    setHuerfanos(prev => prev.map(h => h.nombre === nombre ? { ...h, [campo]: valor } : h))
  }

  async function ligar(h: Huerfano) {
    if (!h.categoria_id) return
    setGuardando(h.nombre)
    const sinonimos = h.sinonimos ? h.sinonimos.split(',').map(s => s.trim()).filter(Boolean) : []
    const { error } = await supabase.rpc('ligar_huerfano', {
      p_nombre: h.nombre,
      p_categoria_id: h.categoria_id,
      p_sucursal_id: sucursalId || null,
      p_unidad: h.unidad || null,
      p_sinonimos: sinonimos,
    })
    setGuardando(null)
    if (error) { alert('No se pudo ligar: ' + error.message); return }
    // sale de la lista (ya quedo clasificado, junto con sus renglones viejos)
    setHuerfanos(prev => prev.filter(x => x.nombre !== h.nombre))
  }

  const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Huérfanos</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Productos que la IA no supo clasificar. Asígnales categoría (y unidad/sinónimos) y se irán solos a su lugar —
          también los tickets viejos. La próxima vez la IA ya los reconoce.
        </p>
      </div>

      {huerfanos.length === 0 ? (
        <div className="rounded-2xl bg-emerald-900/15 border border-emerald-800/30 p-8 text-center">
          <p className="text-emerald-400 font-medium">¡Sin huérfanos!</p>
          <p className="text-sm text-zinc-500 mt-1">Todos los productos de esta sucursal están clasificados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {huerfanos.map(h => (
            <div key={h.nombre} className="rounded-2xl bg-zinc-900 border border-amber-800/30 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-100">{h.nombre}</p>
                  <p className="text-xs text-zinc-600">
                    {h.veces}× · {fmt(h.gasto)}{h.comercios.length > 0 && ` · ${h.comercios.slice(0, 3).join(', ')}${h.comercios.length > 3 ? '…' : ''}`}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={h.categoria_id} onChange={e => setCampo(h.nombre, 'categoria_id', e.target.value)}
                  className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                  <option value="">Elegir categoría…</option>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <select value={h.unidad} onChange={e => setCampo(h.nombre, 'unidad', e.target.value)}
                  className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                  <option value="">Unidad (opcional)</option>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <input value={h.sinonimos} onChange={e => setCampo(h.nombre, 'sinonimos', e.target.value)}
                  placeholder="Sinónimos / marcas (opcional, ej. mckenin, papa blanca)"
                  className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                <button onClick={() => ligar(h)} disabled={!h.categoria_id || guardando === h.nombre}
                  className="rounded-lg bg-zinc-100 px-4 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">
                  {guardando === h.nombre ? 'Ligando…' : 'Ligar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
