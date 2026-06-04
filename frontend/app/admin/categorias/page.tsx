'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Categoria {
  id: string
  nombre: string
  orden: number
  activa: boolean
  sucursal_id: string | null
}

export default function CategoriasPage() {
  const { sucursalId } = useSucursal()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [nueva, setNueva] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    let q = supabase.from('categorias_gasto').select('id, nombre, orden, activa, sucursal_id').order('orden')
    // global (sucursal_id null) + las de la sucursal seleccionada
    q = sucursalId ? q.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : q.is('sucursal_id', null)
    const { data } = await q
    setCategorias((data as Categoria[] | null) ?? [])
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  async function agregar() {
    if (!nueva.trim()) return
    setSaving(true)
    const maxOrden = categorias.reduce((m, c) => Math.max(m, c.orden), 0)
    const { error } = await supabase.from('categorias_gasto')
      .insert({ nombre: nueva.trim(), orden: maxOrden + 1, sucursal_id: sucursalId || null })
    setSaving(false)
    if (!error) { setNueva(''); setLoading(true); fetchData() }
  }

  async function renombrar(c: Categoria, nombre: string) {
    setCategorias(prev => prev.map(x => x.id === c.id ? { ...x, nombre } : x))
  }

  async function guardarNombre(c: Categoria) {
    if (!c.nombre.trim()) return
    await supabase.from('categorias_gasto').update({ nombre: c.nombre.trim() }).eq('id', c.id)
  }

  async function toggleActiva(c: Categoria) {
    await supabase.from('categorias_gasto').update({ activa: !c.activa }).eq('id', c.id)
    setCategorias(prev => prev.map(x => x.id === c.id ? { ...x, activa: !x.activa } : x))
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Categorías de gasto</h2>
        <p className="text-sm text-zinc-500 mt-1">
          La IA clasifica cada renglón en estas categorías.{' '}
          {sucursalId
            ? 'Estás viendo las globales + las de esta sucursal. Lo que agregues será solo de esta sucursal.'
            : 'Estás viendo las globales (aplican a todas). Elige una sucursal arriba para agregar categorías propias.'}
        </p>
      </div>

      <div className="flex gap-2">
        <input value={nueva} onChange={e => setNueva(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') agregar() }}
          placeholder="Nueva categoría (ej. Mantenimiento)"
          className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />
        <button onClick={agregar} disabled={saving || !nueva.trim()}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">+ Agregar</button>
      </div>

      <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800/50">
        {categorias.map(c => (
          <div key={c.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${!c.activa ? 'opacity-50' : ''}`}>
            <input value={c.nombre} onChange={e => renombrar(c, e.target.value)} onBlur={() => guardarNombre(c)}
              className="flex-1 bg-transparent text-sm text-zinc-100 outline-none focus:bg-zinc-800 rounded px-2 py-1" />
            {c.sucursal_id === null
              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">global</span>
              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400">sucursal</span>}
            <button onClick={() => toggleActiva(c)}
              className={`text-xs font-medium px-2 py-1 rounded-lg ${c.activa ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {c.activa ? 'Activa' : 'Inactiva'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-600">El nombre se guarda al salir del campo. Desactivar una categoría la oculta de la IA y de los formularios.</p>
    </div>
  )
}
