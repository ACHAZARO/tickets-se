'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Categoria { id: string; nombre: string; orden: number; activa: boolean; sucursal_id: string | null }
interface Producto {
  id: string
  nombre: string
  sinonimos: string[]
  categoria_id: string | null
  unidad_default: string | null
  veces_matched: number
  activo: boolean
  sucursal_id: string | null
}

const UNIDADES = ['kg', 'g', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

export default function CatalogoPage() {
  const { sucursalId } = useSucursal()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevaCat, setNuevaCat] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  // alta de producto: categoriaId del form abierto -> datos
  const [addProd, setAddProd] = useState<null | { categoriaId: string; nombre: string; sinonimos: string; unidad: string }>(null)
  const [savingProd, setSavingProd] = useState(false)

  const fetchData = useCallback(async () => {
    let catQ = supabase.from('categorias_gasto').select('id, nombre, orden, activa, sucursal_id').order('orden')
    let prodQ = supabase.from('catalogo_productos').select('id, nombre, sinonimos, categoria_id, unidad_default, veces_matched, activo, sucursal_id').order('nombre')
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ.is('sucursal_id', null)
    prodQ = sucursalId ? prodQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : prodQ.is('sucursal_id', null)
    const [catRes, prodRes] = await Promise.all([catQ, prodQ])
    setCategorias((catRes.data as Categoria[] | null) ?? [])
    setProductos((prodRes.data as Producto[] | null) ?? [])
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  async function agregarCat() {
    if (!nuevaCat.trim()) return
    setSavingCat(true)
    const maxOrden = categorias.reduce((m, c) => Math.max(m, c.orden), 0)
    await supabase.from('categorias_gasto').insert({ nombre: nuevaCat.trim(), orden: maxOrden + 1, sucursal_id: sucursalId || null })
    setSavingCat(false); setNuevaCat(''); setLoading(true); fetchData()
  }

  async function renombrarCat(c: Categoria, nombre: string) {
    setCategorias(prev => prev.map(x => x.id === c.id ? { ...x, nombre } : x))
  }
  async function guardarNombreCat(c: Categoria) {
    if (c.nombre.trim()) await supabase.from('categorias_gasto').update({ nombre: c.nombre.trim() }).eq('id', c.id)
  }
  async function toggleCat(c: Categoria) {
    await supabase.from('categorias_gasto').update({ activa: !c.activa }).eq('id', c.id)
    setCategorias(prev => prev.map(x => x.id === c.id ? { ...x, activa: !x.activa } : x))
  }

  async function guardarProducto() {
    if (!addProd || !addProd.nombre.trim()) return
    setSavingProd(true)
    await supabase.from('catalogo_productos').insert({
      nombre: addProd.nombre.trim(),
      sinonimos: addProd.sinonimos ? addProd.sinonimos.split(',').map(s => s.trim()).filter(Boolean) : [],
      categoria_id: addProd.categoriaId,
      unidad_default: addProd.unidad || null,
      sucursal_id: sucursalId || null,
    })
    setSavingProd(false); setAddProd(null); setLoading(true); fetchData()
  }

  async function toggleProd(p: Producto) {
    await supabase.from('catalogo_productos').update({ activo: !p.activo }).eq('id', p.id)
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, activo: !x.activo } : x))
  }
  async function eliminarProd(p: Producto) {
    if (!confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return
    await supabase.from('catalogo_productos').delete().eq('id', p.id)
    setProductos(prev => prev.filter(x => x.id !== p.id))
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
  }

  const prodsPorCat = (catId: string) => productos.filter(p => p.categoria_id === catId)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Catálogo y categorías</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Cada categoría con sus productos (lo que la IA ha aprendido).{' '}
          {sucursalId ? 'Ves lo global + lo de esta sucursal; lo nuevo es de esta sucursal.' : 'Ves lo global; elige una sucursal arriba para algo específico.'}
        </p>
      </div>

      <div className="flex gap-2">
        <input value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') agregarCat() }}
          placeholder="Nueva categoría (ej. Mantenimiento)"
          className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />
        <button onClick={agregarCat} disabled={savingCat || !nuevaCat.trim()}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">+ Categoría</button>
      </div>

      <div className="space-y-4">
        {categorias.map(c => {
          const prods = prodsPorCat(c.id)
          return (
            <div key={c.id} className={`rounded-2xl bg-zinc-900 overflow-hidden ${!c.activa ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input value={c.nombre} onChange={e => renombrarCat(c, e.target.value)} onBlur={() => guardarNombreCat(c)}
                    className="text-sm font-medium text-zinc-100 bg-transparent outline-none focus:bg-zinc-800 rounded px-2 py-1 min-w-0" />
                  {c.sucursal_id === null
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">global</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400">sucursal</span>}
                  <span className="text-xs text-zinc-600">· {prods.length} prod.</span>
                </div>
                <button onClick={() => setAddProd({ categoriaId: c.id, nombre: '', sinonimos: '', unidad: '' })}
                  className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap">+ producto</button>
                <button onClick={() => toggleCat(c)}
                  className={`text-xs px-2 py-1 rounded-lg ${c.activa ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                  {c.activa ? 'Activa' : 'Inactiva'}
                </button>
              </div>

              {addProd?.categoriaId === c.id && (
                <div className="px-4 py-3 bg-zinc-800/40 space-y-2 border-b border-zinc-800">
                  <input value={addProd.nombre} onChange={e => setAddProd({ ...addProd, nombre: e.target.value })} placeholder="Nombre del producto (ej. Pasta)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                  <input value={addProd.sinonimos} onChange={e => setAddProd({ ...addProd, sinonimos: e.target.value })} placeholder="Sinónimos / marcas (ej. barilla, espagueti)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                  <div className="flex gap-2">
                    <select value={addProd.unidad} onChange={e => setAddProd({ ...addProd, unidad: e.target.value })}
                      className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                      <option value="">Unidad</option>
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button onClick={guardarProducto} disabled={savingProd || !addProd.nombre.trim()}
                      className="flex-1 rounded-lg bg-zinc-100 py-1.5 text-sm font-semibold text-zinc-900 disabled:opacity-50">Guardar</button>
                    <button onClick={() => setAddProd(null)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-400">Cancelar</button>
                  </div>
                </div>
              )}

              {prods.length === 0 ? (
                <p className="px-4 py-3 text-xs text-zinc-600">Sin productos. La IA aprende al revisar tickets o agrégalos aquí.</p>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {prods.map(p => (
                    <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${!p.activo ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-100 truncate">{p.nombre}</span>
                          {p.unidad_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{p.unidad_default}</span>}
                          {p.veces_matched > 0 && <span className="text-[10px] text-zinc-600">{p.veces_matched}×</span>}
                        </div>
                        {p.sinonimos.length > 0 && <p className="text-xs text-zinc-500 truncate">tambien: {p.sinonimos.join(', ')}</p>}
                      </div>
                      <button onClick={() => toggleProd(p)} className={`text-xs px-2 py-1 rounded-lg ${p.activo ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>{p.activo ? 'Activo' : 'Inactivo'}</button>
                      <button onClick={() => eliminarProd(p)} className="text-xs text-red-400 hover:text-red-300">eliminar</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
