'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from '../ui'

interface Categoria { id: string; nombre: string }
interface Comercio { id: string; nombre: string; categoria_id: string | null; veces: number; sucursal_id: string | null }
interface ProdAgg { descripcion: string; categoria: string; veces: number }
interface Resumen { categorias: string[]; productos: ProdAgg[] }

export default function ComerciosPage() {
  const { sucursalId } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [comercios, setComercios] = useState<Comercio[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  // resumen por comercio (en minusculas) -> categorias observadas + productos
  const [resumen, setResumen] = useState<Record<string, Resumen>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    let comQ = supabase.from('comercios').select('id, nombre, categoria_id, veces, sucursal_id').order('veces', { ascending: false })
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    comQ = sucursalId ? comQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : comQ // "Todas": sin filtro
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ

    // Productos/categorias que la IA ha identificado por comercio (de los renglones).
    let itemsQ = supabase.from('ticket_items')
      .select('descripcion, categorias_gasto:categoria_id(nombre), registros_tickets!inner(comercio, sucursal_id)')
      .not('categoria_id', 'is', null).limit(3000)
    if (sucursalId) itemsQ = itemsQ.eq('registros_tickets.sucursal_id', sucursalId)

    const [comRes, catRes, itemsRes] = await Promise.all([comQ, catQ, itemsQ])
    setComercios((comRes.data as Comercio[] | null) ?? [])
    setCategorias(catRes.data ?? [])

    const agg: Record<string, { cats: Map<string, number>; prods: Map<string, ProdAgg> }> = {}
    for (const row of (itemsRes.data as unknown as Array<{ descripcion: string; categorias_gasto: { nombre: string } | null; registros_tickets: { comercio: string | null } | null }>) ?? []) {
      const com = (row.registros_tickets?.comercio ?? '').trim()
      const cat = row.categorias_gasto?.nombre
      if (!com || !cat) continue
      const key = com.toLowerCase()
      if (!agg[key]) agg[key] = { cats: new Map(), prods: new Map() }
      agg[key].cats.set(cat, (agg[key].cats.get(cat) ?? 0) + 1)
      const desc = (row.descripcion ?? '').trim()
      const pkey = desc.toLowerCase()
      const ex = agg[key].prods.get(pkey)
      if (ex) ex.veces++
      else agg[key].prods.set(pkey, { descripcion: desc, categoria: cat, veces: 1 })
    }
    const res: Record<string, Resumen> = {}
    for (const [k, v] of Object.entries(agg)) {
      res[k] = {
        categorias: [...v.cats.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
        productos: [...v.prods.values()].sort((a, b) => b.veces - a.veces),
      }
    }
    setResumen(res)
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  async function setCategoria(c: Comercio, categoriaId: string) {
    const { error } = await supabase.from('comercios').update({ categoria_id: categoriaId || null }).eq('id', c.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    setComercios(prev => prev.map(x => x.id === c.id ? { ...x, categoria_id: categoriaId || null } : x))
  }
  async function eliminar(c: Comercio) {
    if (!(await confirm(`¿Olvidar el comercio "${c.nombre}"?`, { danger: true }))) return
    const { error } = await supabase.from('comercios').delete().eq('id', c.id)
    if (error) { toast('No se pudo olvidar: ' + error.message, 'error'); return }
    setComercios(prev => prev.filter(x => x.id !== c.id))
  }

  const filtrados = comercios.filter(c => !search || c.nombre.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Comercios</h2>
        <p className="text-sm text-zinc-500 mt-1">La IA aprende qué productos compras en cada comercio. Un comercio puede tener varias categorías (ej. Costco). Sólo si SIEMPRE es lo mismo (ej. gasolinera) conviene <span className="text-zinc-300">forzar una categoría</span>.</p>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar comercio..."
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />

      {filtrados.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">{comercios.length === 0 ? 'Aún no hay comercios aprendidos. Se llenan al procesar tickets.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="space-y-2">
          {filtrados.map(c => {
            const r = resumen[c.nombre.toLowerCase()]
            const cats = r?.categorias ?? []
            const expandido = abierto === c.id
            return (
              <div key={c.id} className="rounded-2xl bg-zinc-900 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setAbierto(expandido ? null : c.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-zinc-100 truncate">{c.nombre}</p>
                      {c.sucursal_id === null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">global</span>}
                    </div>
                    <p className="text-xs text-zinc-600">
                      {c.veces} ticket(s){r ? ` · ${r.productos.length} producto(s)` : ''}
                      {cats.length > 0 && <> · {cats.length === 1 ? cats[0] : `${cats.length} categorías`}</>}
                    </p>
                  </button>
                  <select value={c.categoria_id ?? ''} onChange={e => setCategoria(c, e.target.value)} title="Forzar categoría (opcional)"
                    className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 max-w-[150px]">
                    <option value="">No forzar</option>
                    {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                  </select>
                  <button onClick={() => setAbierto(expandido ? null : c.id)} className="text-xs text-zinc-500 hover:text-zinc-300 w-4">{expandido ? '▾' : '▸'}</button>
                </div>

                {expandido && (
                  <div className="px-4 pb-3 space-y-3 border-t border-zinc-800 pt-3">
                    {cats.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {cats.map(cat => <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{cat}</span>)}
                      </div>
                    )}
                    {r && r.productos.length > 0 ? (
                      <div className="rounded-xl bg-zinc-800/40 divide-y divide-zinc-800/60">
                        {r.productos.slice(0, 50).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <span className="text-zinc-200 truncate">{p.descripcion}</span>
                            <span className="text-xs text-zinc-500 whitespace-nowrap">{p.categoria}{p.veces > 1 ? ` · ${p.veces}×` : ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600">Aún no hay productos clasificados de este comercio.</p>
                    )}
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/tickets?comercio=${encodeURIComponent(c.nombre)}`}
                        className="text-xs text-blue-400 hover:text-blue-300">Ver tickets de este comercio →</Link>
                      <button onClick={() => eliminar(c)} className="text-xs text-red-400 hover:text-red-300 ml-auto">olvidar comercio</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
