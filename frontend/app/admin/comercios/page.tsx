'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Categoria { id: string; nombre: string }
interface Comercio { id: string; nombre: string; categoria_id: string | null; veces: number; sucursal_id: string | null }

export default function ComerciosPage() {
  const { sucursalId } = useSucursal()
  const [comercios, setComercios] = useState<Comercio[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    let comQ = supabase.from('comercios').select('id, nombre, categoria_id, veces, sucursal_id').order('veces', { ascending: false })
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    comQ = sucursalId ? comQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : comQ.is('sucursal_id', null)
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ.is('sucursal_id', null)
    const [comRes, catRes] = await Promise.all([comQ, catQ])
    setComercios((comRes.data as Comercio[] | null) ?? [])
    setCategorias(catRes.data ?? [])
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  async function setCategoria(c: Comercio, categoriaId: string) {
    setComercios(prev => prev.map(x => x.id === c.id ? { ...x, categoria_id: categoriaId || null } : x))
    await supabase.from('comercios').update({ categoria_id: categoriaId || null }).eq('id', c.id)
  }
  async function eliminar(c: Comercio) {
    if (!confirm(`¿Olvidar el comercio "${c.nombre}"?`)) return
    await supabase.from('comercios').delete().eq('id', c.id)
    setComercios(prev => prev.filter(x => x.id !== c.id))
  }

  const filtrados = comercios.filter(c => !search || c.nombre.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Comercios</h2>
        <p className="text-sm text-zinc-500 mt-1">La IA aprende sola qué categoría suele tener cada comercio (ej. gasolinera → gasolina). Corrige aquí si se equivoca y lo usará como pista la próxima.</p>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar comercio..."
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />

      {filtrados.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">{comercios.length === 0 ? 'Aún no hay comercios aprendidos. Se llenan al procesar tickets.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800/50">
          {filtrados.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100 truncate">{c.nombre}</p>
                <p className="text-xs text-zinc-600">{c.veces} ticket(s){c.sucursal_id === null ? ' · global' : ''}</p>
              </div>
              <select value={c.categoria_id ?? ''} onChange={e => setCategoria(c, e.target.value)}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 max-w-[160px]">
                <option value="">Sin categoría fija</option>
                {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
              </select>
              <button onClick={() => eliminar(c)} className="text-xs text-red-400 hover:text-red-300">olvidar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
