'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from '../ui'

interface Categoria { id: string; nombre: string }
interface Producto { id: string; nombre: string; categoria_id: string | null; unidad_default: string | null }
interface Comercio { id: string; nombre: string; veces: number; categoria_id: string | null }
interface Huerfano { nombre: string; veces: number; comercios: Set<string>; categoria_id: string; unidad: string; sinonimos: string; contieneCant: string; contieneUnidad: string }

const CONTENEDORES = ['caja', 'bulto', 'paquete', 'rollo', 'galon']

const UNIDADES = ['kg', 'g', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

type Sel = { tipo: 'comercio' | 'categoria'; id: string } | null

export default function CerebroPage() {
  const { sucursalId } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [comercios, setComercios] = useState<Comercio[]>([])
  const [huerfanos, setHuerfanos] = useState<Huerfano[]>([])
  // comercio(lower) -> { categorias observadas, ids de productos del catalogo }
  const [comCat, setComCat] = useState<Record<string, { cats: Set<string>; prods: Set<string> }>>({})
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Sel>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [bCom, setBCom] = useState('')
  const [bCat, setBCat] = useState('')
  const [bProd, setBProd] = useState('')
  // ligado masivo: categoría destino para aplicar a varios huérfanos marcados
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [catMasiva, setCatMasiva] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    let prodQ = supabase.from('catalogo_productos').select('id, nombre, categoria_id, unidad_default').eq('activo', true).order('nombre')
    let comQ = supabase.from('comercios').select('id, nombre, veces, categoria_id').order('veces', { ascending: false })
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ // "Todas": sin filtro
    prodQ = sucursalId ? prodQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : prodQ
    comQ = sucursalId ? comQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : comQ

    let itemsQ = supabase.from('ticket_items')
      .select('descripcion, categoria_id, producto_catalogo_id, categorias_gasto:categoria_id(nombre), registros_tickets!inner(comercio, sucursal_id)')
      .limit(4000)
    if (sucursalId) itemsQ = itemsQ.eq('registros_tickets.sucursal_id', sucursalId)

    const [catRes, prodRes, comRes, itemsRes] = await Promise.all([catQ, prodQ, comQ, itemsQ])
    const catList = (catRes.data as Categoria[] | null) ?? []
    setCategorias(catList)
    setProductos((prodRes.data as Producto[] | null) ?? [])
    setComercios((comRes.data as Comercio[] | null) ?? [])
    const catNombreToId = new Map(catList.map(c => [c.nombre, c.id]))

    const cc: Record<string, { cats: Set<string>; prods: Set<string> }> = {}
    const huerf = new Map<string, Huerfano>()
    for (const row of (itemsRes.data as unknown as Array<{ descripcion: string; categoria_id: string | null; producto_catalogo_id: string | null; categorias_gasto: { nombre: string } | null; registros_tickets: { comercio: string | null } | null }>) ?? []) {
      const com = (row.registros_tickets?.comercio ?? '').trim()
      const comKey = com.toLowerCase()
      if (com) {
        if (!cc[comKey]) cc[comKey] = { cats: new Set(), prods: new Set() }
        const catId = row.categoria_id ?? (row.categorias_gasto?.nombre ? catNombreToId.get(row.categorias_gasto.nombre) : undefined)
        if (catId) cc[comKey].cats.add(catId)
        if (row.producto_catalogo_id) cc[comKey].prods.add(row.producto_catalogo_id)
      }
      // huérfanos = renglones sin categoria
      if (!row.categoria_id) {
        const desc = (row.descripcion ?? '').trim()
        if (desc) {
          const k = desc.toLowerCase()
          if (!huerf.has(k)) huerf.set(k, { nombre: desc, veces: 0, comercios: new Set(), categoria_id: '', unidad: '', sinonimos: '', contieneCant: '', contieneUnidad: '' })
          const h = huerf.get(k)!; h.veces++; if (com) h.comercios.add(com)
        }
      }
    }
    setComCat(cc)
    setHuerfanos([...huerf.values()].sort((a, b) => b.veces - a.veces))
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleSel(tipo: 'comercio' | 'categoria', id: string) {
    setSel(prev => prev && prev.tipo === tipo && prev.id === id ? null : { tipo, id })
  }

  async function moverProducto(p: Producto, categoriaId: string) {
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, categoria_id: categoriaId || null } : x))
    await supabase.from('catalogo_productos').update({ categoria_id: categoriaId || null }).eq('id', p.id)
  }
  async function forzarCategoriaComercio(c: Comercio, categoriaId: string) {
    setComercios(prev => prev.map(x => x.id === c.id ? { ...x, categoria_id: categoriaId || null } : x))
    await supabase.from('comercios').update({ categoria_id: categoriaId || null }).eq('id', c.id)
  }

  function setHuerfanoCampo(nombre: string, campo: 'categoria_id' | 'unidad' | 'sinonimos' | 'contieneCant' | 'contieneUnidad', valor: string) {
    setHuerfanos(prev => prev.map(h => h.nombre === nombre ? { ...h, [campo]: valor } : h))
  }
  async function ligarHuerfano(h: Huerfano) {
    if (!h.categoria_id) return
    setGuardando(h.nombre)
    const sinonimos = h.sinonimos ? h.sinonimos.split(',').map(s => s.trim()).filter(Boolean) : []
    const { data: prodId, error } = await supabase.rpc('ligar_huerfano', {
      p_nombre: h.nombre, p_categoria_id: h.categoria_id,
      p_sucursal_id: sucursalId || null, p_unidad: h.unidad || null, p_sinonimos: sinonimos,
    })
    // Si dio equivalencia (ej. 1 caja = 24 pz), la guarda en el producto recien ligado.
    const cc = Number(h.contieneCant)
    if (!error && prodId && h.contieneUnidad.trim() && Number.isFinite(cc) && cc > 0) {
      await supabase.from('catalogo_productos').update({ contiene_cantidad: cc, contiene_unidad: h.contieneUnidad.trim() }).eq('id', prodId)
    }
    setGuardando(null)
    if (error) { toast('No se pudo ligar: ' + error.message, 'error'); return }
    setHuerfanos(prev => prev.filter(x => x.nombre !== h.nombre))
    fetchData() // refresca para que aparezca como producto del catalogo
  }

  async function ligarMarcados() {
    if (!catMasiva || marcados.size === 0) return
    setGuardando('__masivo__')
    const objetivo = huerfanos.filter(h => marcados.has(h.nombre))
    for (const h of objetivo) {
      const sinonimos = h.sinonimos ? h.sinonimos.split(',').map(s => s.trim()).filter(Boolean) : []
      await supabase.rpc('ligar_huerfano', {
        p_nombre: h.nombre, p_categoria_id: catMasiva,
        p_sucursal_id: sucursalId || null, p_unidad: h.unidad || null, p_sinonimos: sinonimos,
      })
    }
    setGuardando(null)
    setHuerfanos(prev => prev.filter(x => !marcados.has(x.nombre)))
    setMarcados(new Set()); setCatMasiva('')
    fetchData()
  }
  function toggleMarcado(nombre: string) {
    setMarcados(prev => { const n = new Set(prev); if (n.has(nombre)) n.delete(nombre); else n.add(nombre); return n })
  }

  // --- Derivados de selección ---
  const catNombre = (id: string | null) => categorias.find(c => c.id === id)?.nombre ?? 'sin categoría'
  const comercioActivoKey = sel?.tipo === 'comercio' ? (comercios.find(c => c.id === sel.id)?.nombre ?? '').toLowerCase() : null

  // categorías resaltadas (las que surte el comercio seleccionado)
  const catsResaltadas = useMemo(() => {
    if (sel?.tipo !== 'comercio' || !comercioActivoKey) return null
    return comCat[comercioActivoKey]?.cats ?? new Set<string>()
  }, [sel, comercioActivoKey, comCat])

  // comercios resaltados (los que surten la categoría seleccionada)
  const comerciosResaltados = useMemo(() => {
    if (sel?.tipo !== 'categoria') return null
    const s = new Set<string>()
    for (const [k, v] of Object.entries(comCat)) if (v.cats.has(sel.id)) s.add(k)
    return s
  }, [sel, comCat])

  // productos filtrados por selección
  const productosFiltrados = useMemo(() => {
    if (sel?.tipo === 'categoria') return productos.filter(p => p.categoria_id === sel.id)
    if (sel?.tipo === 'comercio' && comercioActivoKey) {
      const ids = comCat[comercioActivoKey]?.prods ?? new Set<string>()
      return productos.filter(p => ids.has(p.id))
    }
    return productos
  }, [sel, productos, comercioActivoKey, comCat])

  const huerfanosFiltrados = useMemo(() => {
    if (sel?.tipo === 'comercio' && comercioActivoKey) {
      const comNombre = comercios.find(c => c.id === sel.id)?.nombre ?? ''
      return huerfanos.filter(h => h.comercios.has(comNombre))
    }
    return huerfanos
  }, [sel, huerfanos, comercioActivoKey, comercios])

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Cerebro</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Comercios, categorías y productos ligados. Toca un comercio o una categoría para ver qué se conecta.
          Los <span className="text-amber-400">huérfanos</span> (arriba en Productos) los ligas y se acomodan solos.
          {sel && <button onClick={() => setSel(null)} className="ml-2 text-blue-400 hover:text-blue-300">limpiar selección</button>}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* COMERCIOS */}
        <div className="rounded-2xl bg-zinc-900 overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-800 text-xs font-medium uppercase tracking-widest text-zinc-500">Comercios ({comercios.length})</div>
          <div className="p-2 border-b border-zinc-800/50">
            <input value={bCom} onChange={e => setBCom(e.target.value)} placeholder="Buscar comercio…"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600" />
          </div>
          <div className="divide-y divide-zinc-800/50 max-h-[60vh] overflow-y-auto">
            {comercios.length === 0 && <p className="px-4 py-4 text-xs text-zinc-600">Aún no hay comercios.</p>}
            {comercios.filter(c => !bCom || c.nombre.toLowerCase().includes(bCom.toLowerCase())).map(c => {
              const activo = sel?.tipo === 'comercio' && sel.id === c.id
              const resaltado = comerciosResaltados?.has(c.nombre.toLowerCase())
              const apagado = comerciosResaltados && !resaltado
              return (
                <div key={c.id} className={`transition-colors ${activo ? 'bg-blue-900/30' : resaltado ? 'bg-emerald-900/15' : ''} ${apagado ? 'opacity-40' : ''}`}>
                  <button onClick={() => toggleSel('comercio', c.id)}
                    className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-800/30">
                    <span className="text-sm text-zinc-100 truncate">{c.nombre}{c.categoria_id ? <span className="ml-1 text-[10px] text-blue-400">●</span> : ''}</span>
                    <span className="text-[10px] text-zinc-600 flex-shrink-0">{c.veces}×</span>
                  </button>
                  {activo && (
                    <div className="px-4 pb-2.5 -mt-1">
                      <label className="block text-[10px] text-zinc-500 mb-1">Forzar categoría (cuando siempre es lo mismo, ej. gasolinera)</label>
                      <select value={c.categoria_id ?? ''} onChange={e => forzarCategoriaComercio(c, e.target.value)}
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100">
                        <option value="">No forzar (vende de varias)</option>
                        {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* CATEGORIAS */}
        <div className="rounded-2xl bg-zinc-900 overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-800 text-xs font-medium uppercase tracking-widest text-zinc-500">Categorías ({categorias.length})</div>
          <div className="p-2 border-b border-zinc-800/50">
            <input value={bCat} onChange={e => setBCat(e.target.value)} placeholder="Buscar categoría…"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600" />
          </div>
          <div className="divide-y divide-zinc-800/50 max-h-[60vh] overflow-y-auto">
            {categorias.filter(c => !bCat || c.nombre.toLowerCase().includes(bCat.toLowerCase())).map(c => {
              const activo = sel?.tipo === 'categoria' && sel.id === c.id
              const resaltado = catsResaltadas?.has(c.id)
              const apagado = catsResaltadas && !resaltado
              const nProd = productos.filter(p => p.categoria_id === c.id).length
              return (
                <button key={c.id} onClick={() => toggleSel('categoria', c.id)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors
                    ${activo ? 'bg-blue-900/30' : resaltado ? 'bg-emerald-900/15' : 'hover:bg-zinc-800/50'} ${apagado ? 'opacity-40' : ''}`}>
                  <span className="text-sm text-zinc-100 truncate">{c.nombre}</span>
                  <span className="text-[10px] text-zinc-600 flex-shrink-0">{nProd} prod.</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* PRODUCTOS */}
        <div className="rounded-2xl bg-zinc-900 overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-800 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Productos {sel ? '(filtrados)' : `(${productos.length})`}
          </div>
          <div className="p-2 border-b border-zinc-800/50">
            <input value={bProd} onChange={e => setBProd(e.target.value)} placeholder="Buscar producto…"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600" />
          </div>
          {marcados.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/20 border-b border-amber-800/30">
              <span className="text-xs text-amber-300">{marcados.size} marcados →</span>
              <select value={catMasiva} onChange={e => setCatMasiva(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100">
                <option value="">Categoría para todos…</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button onClick={ligarMarcados} disabled={!catMasiva || guardando === '__masivo__'}
                className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 disabled:opacity-50">
                {guardando === '__masivo__' ? '…' : 'Ligar'}
              </button>
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Huérfanos */}
            {huerfanosFiltrados.filter(h => !bProd || h.nombre.toLowerCase().includes(bProd.toLowerCase())).length > 0 && (
              <div className="border-b border-amber-800/30">
                <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-amber-400">Huérfanos — marca varios y asigna en lote, o liga uno por uno</p>
                {huerfanosFiltrados.filter(h => !bProd || h.nombre.toLowerCase().includes(bProd.toLowerCase())).slice(0, 80).map(h => (
                  <div key={h.nombre} className="px-4 py-2.5 space-y-2 border-t border-zinc-800/40">
                    <label className="flex items-center gap-2 text-sm text-zinc-100">
                      <input type="checkbox" checked={marcados.has(h.nombre)} onChange={() => toggleMarcado(h.nombre)} className="accent-amber-500" />
                      {h.nombre} <span className="text-[10px] text-zinc-600">{h.veces}×</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <select value={h.categoria_id} onChange={e => setHuerfanoCampo(h.nombre, 'categoria_id', e.target.value)}
                        className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100">
                        <option value="">Categoría…</option>
                        {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      <select value={h.unidad} onChange={e => setHuerfanoCampo(h.nombre, 'unidad', e.target.value)}
                        className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100">
                        <option value="">Unidad</option>
                        {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <button onClick={() => ligarHuerfano(h)} disabled={!h.categoria_id || guardando === h.nombre}
                        className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">
                        {guardando === h.nombre ? '…' : 'Ligar'}
                      </button>
                    </div>
                    {CONTENEDORES.includes(h.unidad) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-zinc-500">1 {h.unidad} =</span>
                        <input type="number" inputMode="decimal" value={h.contieneCant} onChange={e => setHuerfanoCampo(h.nombre, 'contieneCant', e.target.value)}
                          placeholder="cuántas" className="w-20 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600" />
                        <input value={h.contieneUnidad} onChange={e => setHuerfanoCampo(h.nombre, 'contieneUnidad', e.target.value)}
                          placeholder="de qué (ej. huevos)" className="flex-1 min-w-[100px] rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Productos del catálogo */}
            {productosFiltrados.filter(p => !bProd || p.nombre.toLowerCase().includes(bProd.toLowerCase())).length === 0 && huerfanosFiltrados.length === 0 ? (
              <p className="px-4 py-4 text-xs text-zinc-600">Sin productos {sel ? 'para esta selección' : ''}.</p>
            ) : productosFiltrados.filter(p => !bProd || p.nombre.toLowerCase().includes(bProd.toLowerCase())).map(p => (
              <div key={p.id} className="px-4 py-2.5 border-t border-zinc-800/40 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-100 truncate">{p.nombre}</p>
                  <p className="text-[11px] text-zinc-600">{catNombre(p.categoria_id)}{p.unidad_default ? ` · ${p.unidad_default}` : ''}</p>
                </div>
                <select value={p.categoria_id ?? ''} onChange={e => moverProducto(p, e.target.value)} title="Mover de categoría"
                  className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100 max-w-[120px]">
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
