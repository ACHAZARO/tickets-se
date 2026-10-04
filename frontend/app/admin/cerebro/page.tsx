'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, Consejo } from '../ui'
import { ElegirArticulo, type OpcionArticulo } from '../elegir-articulo'
import { GaleriaTickets } from '../galeria-tickets'
import type { EjemploTicket } from '../unificar'

// Cerebro: lo que la IA ya aprendio, de lo general a lo particular -> Categorias > Comercios > Articulos, y a la
// derecha lo que falta: renglones SIN CLASIFICAR (la IA los leyo pero no sabe que articulo son). Para clasificar uno se
// dice QUE ARTICULO ES (uno que ya existe o uno nuevo con nombre limpio) via la RPC clasificar_renglones (090/091).
// Los tickets RECHAZADOS no cuentan: no aparecen aqui (antes salia basura como "Ticket" o "Transaccion 2026...").

interface Categoria { id: string; nombre: string }
interface Producto { id: string; nombre: string; categoria_id: string | null; unidad_default: string | null }
interface Comercio { id: string; nombre: string; veces: number; categoria_id: string | null }
interface SinClasificar { texto: string; veces: number; comercios: Set<string> }
interface FormClasificar {
  nombre: string
  elegida: OpcionArticulo | null
  categoria_id: string
  unidad: string
  contieneCant: string
  contieneUnidad: string
}

const UNIDADES_COMPRA = ['pz', 'g', 'kg', 'ml', 'lt', 'caja', 'paquete', 'bolsa', 'bulto', 'rollo', 'galon']
const UNIDADES_CONTENIDO = ['g', 'kg', 'ml', 'lt', 'pz']
const formVacio = (): FormClasificar => ({ nombre: '', elegida: null, categoria_id: '', unidad: 'pz', contieneCant: '', contieneUnidad: 'g' })

type Sel = { tipo: 'comercio' | 'categoria'; id: string } | null

export default function CerebroPage() {
  const { sucursalId } = useSucursal()
  const toast = useToast()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [comercios, setComercios] = useState<Comercio[]>([])
  const [pendientes, setPendientes] = useState<SinClasificar[]>([])
  // comercio(lower) -> { categorias observadas, ids de articulos }
  const [comCat, setComCat] = useState<Record<string, { cats: Set<string>; prods: Set<string> }>>({})
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Sel>(null)
  const [bCom, setBCom] = useState('')
  const [bCat, setBCat] = useState('')
  const [bProd, setBProd] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)     // texto sin clasificar que se esta clasificando
  const [form, setForm] = useState<FormClasificar>(formVacio)
  const [guardando, setGuardando] = useState(false)
  const [galeria, setGaleria] = useState<string | null>(null)     // texto cuyos tickets se ven

  const fetchData = useCallback(async () => {
    setLoading(true)
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    let prodQ = supabase.from('catalogo_productos').select('id, nombre, categoria_id, unidad_default').eq('activo', true).order('nombre')
    let comQ = supabase.from('comercios').select('id, nombre, veces, categoria_id').order('veces', { ascending: false })
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ
    prodQ = sucursalId ? prodQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : prodQ
    comQ = sucursalId ? comQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : comQ

    const itemsQ = traerTodo(() => {
      let q = supabase.from('ticket_items')
        .select('id, descripcion, categoria_id, producto_catalogo_id, registros_tickets!inner(comercio, sucursal_id, estado)')
        .neq('registros_tickets.estado', 'rechazado')
      if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
      return q
    })

    const [catRes, prodRes, comRes, itemsRes] = await Promise.all([catQ, prodQ, comQ, itemsQ])
    setCategorias((catRes.data as Categoria[] | null) ?? [])
    setProductos((prodRes.data as Producto[] | null) ?? [])
    // El mismo comercio puede venir dos veces (global y de sucursal): se muestra una vez.
    const vistos = new Set<string>()
    setComercios(((comRes.data as Comercio[] | null) ?? []).filter(c => { const k = c.nombre.trim().toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true }))

    const cc: Record<string, { cats: Set<string>; prods: Set<string> }> = {}
    const pend = new Map<string, SinClasificar>()
    for (const row of (itemsRes.data as unknown as Array<{ descripcion: string; categoria_id: string | null; producto_catalogo_id: string | null; registros_tickets: { comercio: string | null } | null }>) ?? []) {
      const com = (row.registros_tickets?.comercio ?? '').trim()
      if (com) {
        const k = com.toLowerCase()
        cc[k] ??= { cats: new Set(), prods: new Set() }
        if (row.categoria_id) cc[k].cats.add(row.categoria_id)
        if (row.producto_catalogo_id) cc[k].prods.add(row.producto_catalogo_id)
      }
      if (!row.categoria_id) {
        const texto = (row.descripcion ?? '').trim()
        if (texto) {
          const k = texto.toLowerCase()
          const p = pend.get(k) ?? { texto, veces: 0, comercios: new Set<string>() }
          p.veces++; if (com) p.comercios.add(com)
          pend.set(k, p)
        }
      }
    }
    setComCat(cc)
    setPendientes([...pend.values()].sort((a, b) => b.veces - a.veces))
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleSel(tipo: 'comercio' | 'categoria', id: string) {
    setSel(prev => prev && prev.tipo === tipo && prev.id === id ? null : { tipo, id })
  }
  async function moverProducto(p: Producto, categoriaId: string) {
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, categoria_id: categoriaId || null } : x))
    const { error } = await supabase.from('catalogo_productos').update({ categoria_id: categoriaId || null }).eq('id', p.id)
    if (error) toast('No se pudo mover: ' + error.message, 'error')
  }
  async function forzarCategoriaComercio(c: Comercio, categoriaId: string) {
    setComercios(prev => prev.map(x => x.id === c.id ? { ...x, categoria_id: categoriaId || null } : x))
    const { error } = await supabase.from('comercios').update({ categoria_id: categoriaId || null }).ilike('nombre', c.nombre.replace(/[\\%_]/g, m => '\\' + m))
    if (error) toast('No se pudo guardar: ' + error.message, 'error')
  }

  function abrir(p: SinClasificar) {
    if (abierto === p.texto) { setAbierto(null); return }
    setAbierto(p.texto)
    setForm(formVacio())
  }

  async function clasificar(p: SinClasificar) {
    const nuevo = !form.elegida
    if (!form.nombre.trim()) { toast('Escribe qué artículo es', 'error'); return }
    if (nuevo && !form.categoria_id) { toast('Elige la categoría del artículo nuevo', 'error'); return }
    const cant = Number(form.contieneCant)
    if (nuevo && form.contieneCant.trim() && (!Number.isFinite(cant) || cant <= 0)) { toast('Revisa cuánto trae cada uno', 'error'); return }
    setGuardando(true)
    const { data, error } = await supabase.rpc('clasificar_renglones', {
      p_descripcion: p.texto, p_sucursal_id: sucursalId || null,
      p_producto_id: form.elegida?.id ?? null,
      p_nombre: nuevo ? form.nombre.trim() : null,
      p_categoria_id: nuevo ? form.categoria_id : null,
      p_unidad: nuevo ? form.unidad : null,
      p_contiene_cantidad: nuevo && form.contieneCant.trim() ? cant : null,
      p_contiene_unidad: nuevo && form.contieneCant.trim() ? form.contieneUnidad : null,
    })
    setGuardando(false)
    if (error) { toast('No se pudo clasificar: ' + error.message, 'error'); return }
    const n = Number((data as { renglones?: number } | null)?.renglones ?? 0)
    toast(`Listo: ${n} ${n === 1 ? 'renglón quedó' : 'renglones quedaron'} como «${form.nombre.trim()}»`)
    setAbierto(null)
    fetchData()
  }

  // Tickets donde aparece un texto sin clasificar (para ver que era).
  const cargarTicketsDeTexto = (texto: string) => async (): Promise<EjemploTicket[]> => {
    const { data } = await traerTodo(() => {
      let q = supabase.from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, registros_tickets!inner(comercio, fecha_ticket, created_at, estado, sucursal_id, storage_path_original, storage_path_archivo)')
        .ilike('descripcion', texto.replace(/[\\%_]/g, m => '\\' + m)).is('categoria_id', null).neq('registros_tickets.estado', 'rechazado')
      if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
      return q
    }, { maximo: 200 })
    type F = { descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null; registros_tickets: { comercio: string | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null } }
    return (data as unknown as F[]).map(r => ({
      descripcion: r.descripcion, cantidad: r.cantidad, unidad: r.unidad, monto: r.monto, comercio: r.registros_tickets.comercio,
      fecha: r.registros_tickets.fecha_ticket ?? r.registros_tickets.created_at.slice(0, 10),
      bucket: r.registros_tickets.storage_path_archivo ? 'archivo' : r.registros_tickets.storage_path_original ? 'por-revisar' : null,
      path: r.registros_tickets.storage_path_archivo ?? r.registros_tickets.storage_path_original,
    })).sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
  }

  // --- Derivados de la seleccion ---
  const catNombre = (id: string | null) => categorias.find(c => c.id === id)?.nombre ?? 'sin categoría'
  const comercioActivoKey = sel?.tipo === 'comercio' ? (comercios.find(c => c.id === sel.id)?.nombre ?? '').toLowerCase() : null
  const catsResaltadas = useMemo(() => {
    if (sel?.tipo !== 'comercio' || !comercioActivoKey) return null
    return comCat[comercioActivoKey]?.cats ?? new Set<string>()
  }, [sel, comercioActivoKey, comCat])
  const comerciosResaltados = useMemo(() => {
    if (sel?.tipo !== 'categoria') return null
    const s = new Set<string>()
    for (const [k, v] of Object.entries(comCat)) if (v.cats.has(sel.id)) s.add(k)
    return s
  }, [sel, comCat])
  const articulosFiltrados = useMemo(() => {
    let l = productos
    if (sel?.tipo === 'categoria') l = l.filter(p => p.categoria_id === sel.id)
    else if (sel?.tipo === 'comercio' && comercioActivoKey) {
      const ids = comCat[comercioActivoKey]?.prods ?? new Set<string>()
      l = l.filter(p => ids.has(p.id))
    }
    return bProd ? l.filter(p => p.nombre.toLowerCase().includes(bProd.toLowerCase())) : l
  }, [sel, productos, comercioActivoKey, comCat, bProd])
  const pendientesFiltrados = useMemo(() => {
    if (sel?.tipo === 'comercio') {
      const nombre = comercios.find(c => c.id === sel.id)?.nombre ?? ''
      return pendientes.filter(p => [...p.comercios].some(c => c.toLowerCase() === nombre.toLowerCase()))
    }
    return pendientes
  }, [sel, pendientes, comercios])
  const opcionesArticulo: OpcionArticulo[] = useMemo(
    () => productos.map(p => ({ id: p.id, nombre: p.nombre, detalle: catNombre(p.categoria_id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productos, categorias])

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>

  // Columna con encabezado fijo, buscador y lista con su propio scroll (en pantallas grandes caben las 4 a la vez).
  const columna = (titulo: React.ReactNode, buscador: React.ReactNode, cuerpo: React.ReactNode, tono = '') => (
    <section className={`tarjeta flex min-h-0 flex-col overflow-hidden ${tono}`}>
      <h3 className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">{titulo}</h3>
      {buscador && <div className="border-b border-zinc-800/60 p-2">{buscador}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto xl:max-h-[calc(100dvh-17rem)] max-h-[60vh]">{cuerpo}</div>
    </section>
  )
  const filaClase = (activo: boolean, resaltado?: boolean, apagado?: boolean | null) =>
    `w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${activo ? 'bg-emerald-900' : resaltado ? 'bg-emerald-900/40' : 'hover:bg-zinc-800/40'} ${apagado ? 'opacity-40' : ''}`

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Cerebro</h2>
          {sel && <button onClick={() => setSel(null)} className="btn-quieto btn-sm">Ver todo</button>}
        </div>
        <p className="nota max-w-2xl">Lo que la IA ya aprendió, de lo general a lo particular. Toca una categoría o un comercio para ver solo lo suyo.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* 1. CATEGORIAS */}
        {columna(
          <>Categorías <span className="font-normal text-zinc-500">{categorias.length}</span></>,
          <input value={bCat} onChange={e => setBCat(e.target.value)} placeholder="Buscar categoría…" aria-label="Buscar categoría" className="campo w-full py-1.5" />,
          <div className="divide-y divide-zinc-800/60">
            {categorias.filter(c => !bCat || c.nombre.toLowerCase().includes(bCat.toLowerCase())).map(c => {
              const activo = sel?.tipo === 'categoria' && sel.id === c.id
              const resaltado = catsResaltadas?.has(c.id)
              const n = productos.filter(p => p.categoria_id === c.id).length
              return (
                <button key={c.id} onClick={() => toggleSel('categoria', c.id)} aria-pressed={activo} className={filaClase(activo, resaltado, catsResaltadas && !resaltado)}>
                  <span className="truncate text-sm text-zinc-100">{c.nombre}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{n} {n === 1 ? 'artículo' : 'artículos'}</span>
                </button>
              )
            })}
          </div>,
        )}

        {/* 2. COMERCIOS */}
        {columna(
          <>Comercios <span className="font-normal text-zinc-500">{comercios.length}</span></>,
          <input value={bCom} onChange={e => setBCom(e.target.value)} placeholder="Buscar comercio…" aria-label="Buscar comercio" className="campo w-full py-1.5" />,
          comercios.length === 0 ? <p className="px-4 py-4 nota">Aún no hay comercios.</p> : (
            <div className="divide-y divide-zinc-800/60">
              {comercios.filter(c => !bCom || c.nombre.toLowerCase().includes(bCom.toLowerCase())).map(c => {
                const activo = sel?.tipo === 'comercio' && sel.id === c.id
                const resaltado = comerciosResaltados?.has(c.nombre.toLowerCase())
                return (
                  <div key={c.id}>
                    <button onClick={() => toggleSel('comercio', c.id)} aria-pressed={activo} className={filaClase(activo, resaltado, comerciosResaltados && !resaltado)}>
                      <span className="truncate text-sm text-zinc-100">{c.nombre}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{c.veces}×</span>
                    </button>
                    {activo && (
                      <div className="bg-emerald-900/40 px-4 pb-3 pt-1">
                        <label className="etiqueta mb-1 block" htmlFor={`forzar-${c.id}`}>Mandar siempre a una categoría</label>
                        <select id={`forzar-${c.id}`} value={c.categoria_id ?? ''} onChange={e => forzarCategoriaComercio(c, e.target.value)} className="campo w-full py-1.5">
                          <option value="">No, la IA decide renglón por renglón</option>
                          {categorias.map(k => <option key={k.id} value={k.id}>Siempre: {k.nombre}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ),
        )}

        {/* 3. ARTICULOS */}
        {columna(
          <>Artículos <span className="font-normal text-zinc-500">{sel ? `${articulosFiltrados.length} de ${productos.length}` : productos.length}</span></>,
          <input value={bProd} onChange={e => setBProd(e.target.value)} placeholder="Buscar artículo…" aria-label="Buscar artículo" className="campo w-full py-1.5" />,
          articulosFiltrados.length === 0 ? <p className="px-4 py-4 nota">Sin artículos {sel ? 'para esta selección' : ''}.</p> : (
            <div className="divide-y divide-zinc-800/60">
              {articulosFiltrados.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-800/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-100" title={p.nombre}>{p.nombre}</p>
                    <p className="text-xs text-zinc-500">{catNombre(p.categoria_id)}{p.unidad_default ? ` · ${p.unidad_default}` : ''}</p>
                  </div>
                  <select value={p.categoria_id ?? ''} onChange={e => moverProducto(p, e.target.value)} title="Mover a otra categoría" aria-label={`Categoría de ${p.nombre}`}
                    className="campo max-w-[120px] px-2 py-1 text-[13px]">
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ),
        )}

        {/* 4. SIN CLASIFICAR */}
        {columna(
          <>Sin clasificar {pendientesFiltrados.length > 0 ? <span className="chip-revisar">{pendientesFiltrados.length}</span> : <span className="font-normal text-zinc-500">0</span>}</>,
          null,
          pendientesFiltrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-900">
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><path d="m5 12 5 5L20 7" /></svg>
              </span>
              <p className="text-sm font-medium text-zinc-100">Todo clasificado</p>
              <p className="nota">Cuando la IA lea algo que no reconoce, aparece aquí para que digas qué artículo es.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              <p className="px-4 py-3 nota">La IA leyó esto en un ticket pero no sabe qué artículo es. Dile cuál y lo reconocerá sola.</p>
              {pendientesFiltrados.map(p => {
                const esAbierto = abierto === p.texto
                return (
                  <div key={p.texto} className={esAbierto ? 'bg-amber-900/30' : ''}>
                    <div className="flex items-start gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 break-words">«{p.texto}»</p>
                        <p className="text-xs text-zinc-500">{p.veces} {p.veces === 1 ? 'vez' : 'veces'}{p.comercios.size ? ` · ${[...p.comercios].slice(0, 2).join(', ')}${p.comercios.size > 2 ? '…' : ''}` : ''}</p>
                      </div>
                      {!esAbierto && <button onClick={() => abrir(p)} className="btn-secundario btn-sm shrink-0">Clasificar</button>}
                    </div>

                    {esAbierto && (
                      <div className="space-y-3 px-4 pb-4">
                        <button type="button" onClick={() => setGaleria(p.texto)} className="btn-texto btn-sm -ml-2">Ver tickets donde aparece</button>
                        <div className="space-y-1">
                          <span className="etiqueta block">¿Qué artículo es?</span>
                          <ElegirArticulo key={`cl-${p.texto}`} ariaLabel="Qué artículo es" placeholder="ej. Mantequilla barra"
                            opciones={opcionesArticulo}
                            onCambio={(texto, elegida) => setForm(f => ({ ...f, nombre: texto, elegida }))}
                            notaNuevo={t => <>«{t}» es nuevo: se creará con este nombre.</>}
                            notaExistente={o => <>Se liga a «{o.nombre}»{o.detalle ? ` (${o.detalle})` : ''}. Lo que dice el ticket queda como otra forma de escribirlo.</>} />
                        </div>

                        {!form.elegida && form.nombre.trim() && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <label className="space-y-1">
                                <span className="etiqueta block">Categoría</span>
                                <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))} className="campo w-full py-1.5">
                                  <option value="">Elige…</option>
                                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                </select>
                              </label>
                              <label className="space-y-1">
                                <span className="etiqueta block">Se compra por</span>
                                <select value={form.unidad} onChange={e => setForm(f => ({ ...f, unidad: e.target.value }))} className="campo w-full py-1.5">
                                  {UNIDADES_COMPRA.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </label>
                            </div>
                            <div className="space-y-1">
                              <span className="etiqueta block">Cada {form.unidad} trae (opcional)</span>
                              <div className="flex items-center gap-2">
                                <input type="number" inputMode="decimal" min={0} value={form.contieneCant} placeholder="ej. 90" aria-label={`Cuánto trae cada ${form.unidad}`}
                                  onChange={e => setForm(f => ({ ...f, contieneCant: e.target.value }))} className="campo w-28 py-1.5" />
                                <select value={form.contieneUnidad} onChange={e => setForm(f => ({ ...f, contieneUnidad: e.target.value }))} aria-label="Unidad de lo que trae" className="campo py-1.5">
                                  {UNIDADES_CONTENIDO.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </div>
                            </div>
                            <Consejo>Pon lo que trae en la unidad de tus recetas: si la receta pide gramos, «1 barra trae 90 g».</Consejo>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => clasificar(p)} disabled={guardando || !form.nombre.trim() || (!form.elegida && !form.categoria_id)} className="btn-primario btn-sm">
                            {guardando ? 'Guardando…' : 'Clasificar'}
                          </button>
                          <button onClick={() => setAbierto(null)} className="btn-quieto btn-sm">Atrás</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ),
          '[&>h3]:bg-amber-900/40',
        )}
      </div>

      {galeria && (
        <GaleriaTickets titulo={`«${galeria}»`} cargar={cargarTicketsDeTexto(galeria)} vacio="No hay fotos de tickets con este texto" onCerrar={() => setGaleria(null)} />
      )}
    </div>
  )
}
