'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useToast } from '../ui'
import { ElegirArticulo, type OpcionArticulo } from '../elegir-articulo'
import { GaleriaTickets } from '../galeria-tickets'
import type { EjemploTicket } from '../unificar'
import { ChipUso, usoDe } from '../uso-articulo'

// Cerebro: lo que la IA aprendio, en una sola columna y sin columnas que se pintan. Primero lo que necesita ayuda (renglones que no
// sabe que son), despues sus articulos por grupo o sus comercios. Cambiar algo aqui es ensenarle: de ahi en adelante lo hace bien.
// Lo usa la pantalla Cerebro y el paso "Esto aprendio la IA" del asistente de inicio (soloArticulos).

interface Categoria { id: string; nombre: string }
interface Producto { id: string; nombre: string; categoria_id: string | null; unidad_default: string | null; uso: string; sinonimos: string[] | null }
interface Comercio { id: string; nombre: string; veces: number; categoria_id: string | null }
interface SinClasificar { texto: string; veces: number; comercios: Set<string> }

const UNIDADES_COMPRA = ['pz', 'g', 'kg', 'ml', 'lt', 'caja', 'paquete', 'bolsa', 'bulto', 'rollo', 'galon']
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function VistaCerebro({ soloArticulos = false, sucursalFija }: { soloArticulos?: boolean; sucursalFija: string }) {
  const toast = useToast()
  const sucursalId = sucursalFija
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [comercios, setComercios] = useState<Comercio[]>([])
  const [pendientes, setPendientes] = useState<SinClasificar[]>([])
  const [comProds, setComProds] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'articulos' | 'comercios'>('articulos')
  const [buscar, setBuscar] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [enseñando, setEnseñando] = useState<string | null>(null)
  const [formNombre, setFormNombre] = useState('')
  const [formElegida, setFormElegida] = useState<OpcionArticulo | null>(null)
  const [formCat, setFormCat] = useState('')
  const [formUnidad, setFormUnidad] = useState('pz')
  const [guardando, setGuardando] = useState(false)
  const [galeria, setGaleria] = useState<string | null>(null)
  const [renombrando, setRenombrando] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    let prodQ = supabase.from('catalogo_productos').select('id, nombre, categoria_id, unidad_default, uso, sinonimos').eq('activo', true).order('nombre')
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
    const vistos = new Set<string>()
    setComercios(((comRes.data as Comercio[] | null) ?? []).filter(c => { const k = c.nombre.trim().toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true }))
    const cp: Record<string, Set<string>> = {}
    const pend = new Map<string, SinClasificar>()
    type Fila = { descripcion: string; categoria_id: string | null; producto_catalogo_id: string | null; registros_tickets: { comercio: string | null } | null }
    for (const row of (itemsRes.data as unknown as Fila[]) ?? []) {
      const com = (row.registros_tickets?.comercio ?? '').trim()
      if (com && row.producto_catalogo_id) (cp[com.toLowerCase()] ??= new Set()).add(row.producto_catalogo_id)
      if (!row.categoria_id) {
        const texto = (row.descripcion ?? '').trim()
        if (texto) {
          const k = texto.toLowerCase()
          const p = pend.get(k) ?? { texto, veces: 0, comercios: new Set<string>() }
          p.veces++
          if (com) p.comercios.add(com)
          pend.set(k, p)
        }
      }
    }
    setComProds(cp)
    setPendientes([...pend.values()].sort((a, b) => b.veces - a.veces))
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])
  // En el asistente el primer grupo con articulos ya va abierto: que se vea de una vez que aprendio.
  useEffect(() => {
    if (!soloArticulos) return
    const primero = categorias.find(c => productos.some(p => p.categoria_id === c.id))
    if (primero) setAbierta(a => a ?? primero.id)
  }, [soloArticulos, categorias, productos])

  async function moverProducto(p: Producto, categoriaId: string) {
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, categoria_id: categoriaId || null } : x))
    const { error } = await supabase.from('catalogo_productos').update({ categoria_id: categoriaId || null }).eq('id', p.id)
    if (error) toast('No se pudo mover: ' + error.message, 'error')
    else toast(`«${p.nombre}» ahora va en ${categorias.find(c => c.id === categoriaId)?.nombre ?? 'sin grupo'}`)
  }

  // El nombre viejo se queda como otra forma de escribirlo: asi la IA lo sigue reconociendo en los tickets.
  async function renombrar(p: Producto, nuevo: string) {
    const nombre = nuevo.trim()
    setRenombrando(null)
    if (!nombre || nombre === p.nombre) return
    const sinonimos = [...new Set([...(p.sinonimos ?? []), p.nombre])]
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, nombre, sinonimos } : x))
    const { error } = await supabase.from('catalogo_productos').update({ nombre, sinonimos }).eq('id', p.id)
    if (error) { toast('No se pudo renombrar: ' + error.message, 'error'); fetchData() }
  }

  async function forzarCategoriaComercio(c: Comercio, categoriaId: string) {
    setComercios(prev => prev.map(x => x.id === c.id ? { ...x, categoria_id: categoriaId || null } : x))
    const { error } = await supabase.from('comercios').update({ categoria_id: categoriaId || null }).ilike('nombre', c.nombre.replace(/[\\%_]/g, m => '\\' + m))
    if (error) toast('No se pudo guardar: ' + error.message, 'error')
  }

  function abrirEnseñar(p: SinClasificar) {
    setEnseñando(e => e === p.texto ? null : p.texto)
    setFormNombre(p.texto); setFormElegida(null); setFormCat(''); setFormUnidad('pz')
  }

  async function clasificar(p: SinClasificar) {
    const nuevo = !formElegida
    if (!formNombre.trim()) { toast('Escribe qué es', 'error'); return }
    if (nuevo && !formCat) { toast('Elige su grupo', 'error'); return }
    setGuardando(true)
    const { data, error } = await supabase.rpc('clasificar_renglones', {
      p_descripcion: p.texto, p_sucursal_id: sucursalId || null,
      p_producto_id: formElegida?.id ?? null,
      p_nombre: nuevo ? formNombre.trim() : null,
      p_categoria_id: nuevo ? formCat : null,
      p_unidad: nuevo ? formUnidad : null,
      p_contiene_cantidad: null, p_contiene_unidad: null,
    })
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    const n = Number((data as { renglones?: number } | null)?.renglones ?? 0)
    toast(`Listo: la IA ya lo reconoce${n > 1 ? ` (${n} renglones)` : ''}`)
    setEnseñando(null)
    fetchData()
  }

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

  const q = norm(buscar.trim())
  const prodFiltrados = useMemo(() => q ? productos.filter(p => norm(p.nombre).includes(q)) : productos, [productos, q])
  const comFiltrados = useMemo(() => q ? comercios.filter(c => norm(c.nombre).includes(q)) : comercios, [comercios, q])
  const opcionesArticulo: OpcionArticulo[] = useMemo(
    () => productos.map(p => ({ id: p.id, nombre: p.nombre, detalle: categorias.find(c => c.id === p.categoria_id)?.nombre ?? 'sin grupo', oculta: usoDe(p.uso) !== 'normal' })),
    [productos, categorias])
  const grupos = useMemo(() => {
    const filas = categorias.map(c => ({ id: c.id, nombre: c.nombre, productos: prodFiltrados.filter(p => p.categoria_id === c.id) }))
    const sinGrupo = prodFiltrados.filter(p => !p.categoria_id || !categorias.some(c => c.id === p.categoria_id))
    if (sinGrupo.length) filas.push({ id: 'sin', nombre: 'Sin grupo', productos: sinGrupo })
    // En el asistente solo lo que ya aprendio; un grupo vacio ahi no le dice nada a nadie.
    return filas.filter(g => g.productos.length > 0 || (!q && !soloArticulos))
  }, [categorias, prodFiltrados, q, soloArticulos])

  if (loading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>

  const fila = 'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50'
  const flecha = (abierto: boolean) => <span aria-hidden className={`shrink-0 text-zinc-500 transition-transform ${abierto ? 'rotate-90' : ''}`}>›</span>

  return (
    <div className="space-y-5">
      {pendientes.length > 0 && (
        <section aria-labelledby="ayuda" className="space-y-2 rounded-xl border border-amber-800/60 bg-amber-950/30 p-3">
          <div className="px-1">
            <h3 id="ayuda" className="text-base font-semibold text-amber-200">La IA no sabe qué son <span className="font-normal text-amber-300/70">· {pendientes.length}</span></h3>
            <p className="nota">Los leyó en un ticket. Dile qué son una vez y ya los reconoce sola.</p>
          </div>
          <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg bg-zinc-900">
            {pendientes.slice(0, enseñando ? pendientes.length : 8).map(p => {
              const abierto = enseñando === p.texto
              return (
                <li key={p.texto}>
                  <button type="button" onClick={() => abrirEnseñar(p)} aria-expanded={abierto} className={fila}>
                    <span className="min-w-0">
                      <span className="block break-words text-sm text-zinc-100">«{p.texto}»</span>
                      <span className="block text-xs text-zinc-500">{p.veces} {p.veces === 1 ? 'vez' : 'veces'}{p.comercios.size ? ` · ${[...p.comercios].slice(0, 2).join(', ')}` : ''}</span>
                    </span>
                    <span className="btn-secundario btn-sm shrink-0">{abierto ? 'Cerrar' : 'Decir qué es'}</span>
                  </button>
                  {abierto && (
                    <div className="space-y-3 px-4 pb-4">
                      <div className="space-y-1">
                        <span className="etiqueta block">¿Qué es?</span>
                        <ElegirArticulo key={`cl-${p.texto}`} ariaLabel="Qué es" placeholder="Escribe su nombre" valorInicial={p.texto} opciones={opcionesArticulo}
                          onCambio={(texto, elegida) => { setFormNombre(texto); setFormElegida(elegida) }}
                          notaNuevo={t => <>Se creará «{t}».</>}
                          notaExistente={o => <>Es «{o.nombre}»{o.detalle ? ` (${o.detalle})` : ''}. La IA lo reconocerá así.</>} />
                      </div>
                      {!formElegida && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <span className="etiqueta block">¿En qué grupo?</span>
                            <select value={formCat} onChange={e => setFormCat(e.target.value)} className="campo w-full py-2">
                              <option value="">Elige…</option>
                              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="etiqueta block">Se compra por</span>
                            <select value={formUnidad} onChange={e => setFormUnidad(e.target.value)} className="campo w-full py-2">
                              {UNIDADES_COMPRA.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </label>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => clasificar(p)} disabled={guardando || !formNombre.trim() || (!formElegida && !formCat)} className="btn-primario btn-sm">{guardando ? 'Guardando…' : 'Listo'}</button>
                        <button type="button" onClick={() => setGaleria(p.texto)} className="btn-texto btn-sm">Ver la foto</button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {!enseñando && pendientes.length > 8 && <p className="nota px-1">Y {pendientes.length - 8} más. Empieza por estos: son los que más salen.</p>}
        </section>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {!soloArticulos && (
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5" role="tablist">
              {([['articulos', `Artículos · ${productos.length}`], ['comercios', `Comercios · ${comercios.length}`]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={vista === k} onClick={() => { setVista(k); setAbierta(null) }}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${vista === k ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-100'}`}>{label}</button>
              ))}
            </div>
          )}
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder={vista === 'articulos' ? 'Buscar artículo…' : 'Buscar comercio…'} aria-label="Buscar"
            className="campo min-w-[160px] flex-1 py-1.5" />
        </div>

        {vista === 'articulos' ? (
          grupos.length === 0 ? <p className="py-8 text-center text-sm text-zinc-500">{q ? 'No hay artículos con ese nombre.' : 'Todavía no hay artículos.'}</p> : (
            <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
              {grupos.map(g => {
                const abierto = abierta === g.id || !!q
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => setAbierta(a => a === g.id ? null : g.id)} aria-expanded={abierto} className={fila}>
                      <span className="text-[15px] font-medium text-zinc-100">{g.nombre}</span>
                      <span className="flex items-center gap-2 text-xs text-zinc-500">{g.productos.length} {g.productos.length === 1 ? 'artículo' : 'artículos'} {flecha(abierto)}</span>
                    </button>
                    {abierto && (
                      <ul className="divide-y divide-zinc-800/60 bg-zinc-900/40">
                        {g.productos.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">Aún nada en este grupo.</li>}
                        {g.productos.map(p => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                            {renombrando === p.id ? (
                              <input autoFocus defaultValue={p.nombre} aria-label={`Nuevo nombre de ${p.nombre}`} className="campo min-w-0 flex-1 py-1"
                                onBlur={e => renombrar(p, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenombrando(null) }} />
                            ) : (
                              <button type="button" onClick={() => setRenombrando(p.id)} title="Toca para cambiarle el nombre" className="min-w-0 flex-1 text-left">
                                <span className="flex items-center gap-1.5 text-sm text-zinc-100"><span className="break-words">{p.nombre}</span><ChipUso uso={p.uso} /></span>
                              </button>
                            )}
                            <select value={p.categoria_id ?? ''} onChange={e => moverProducto(p, e.target.value)} aria-label={`Grupo de ${p.nombre}`} className="campo max-w-[150px] px-2 py-1 text-[13px]">
                              {!p.categoria_id && <option value="">Sin grupo</option>}
                              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          comFiltrados.length === 0 ? <p className="py-8 text-center text-sm text-zinc-500">{q ? 'No hay comercios con ese nombre.' : 'Todavía no hay comercios.'}</p> : (
            <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
              {comFiltrados.map(c => {
                const abierto = abierta === c.id
                const ids = comProds[c.nombre.toLowerCase()] ?? new Set<string>()
                const lista = productos.filter(p => ids.has(p.id))
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setAbierta(a => a === c.id ? null : c.id)} aria-expanded={abierto} className={fila}>
                      <span className="min-w-0 truncate text-[15px] font-medium text-zinc-100">{c.nombre}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">{c.veces} {c.veces === 1 ? 'compra' : 'compras'} {flecha(abierto)}</span>
                    </button>
                    {abierto && (
                      <div className="space-y-2 bg-zinc-900/40 px-4 py-3">
                        <p className="text-[13px] text-zinc-400">{lista.length ? `Le compras: ${lista.slice(0, 12).map(p => p.nombre).join(', ')}${lista.length > 12 ? ` y ${lista.length - 12} más` : ''}.` : 'Aún no hay artículos ligados.'}</p>
                        <label className="block space-y-1">
                          <span className="etiqueta block">Lo que la IA no reconozca de aquí, ¿a qué grupo va?</span>
                          <select value={c.categoria_id ?? ''} onChange={e => forzarCategoriaComercio(c, e.target.value)} className="campo w-full max-w-xs py-1.5">
                            <option value="">Que la IA decida</option>
                            {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                          </select>
                        </label>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        )}
        {vista === 'articulos' && <p className="nota">Toca un nombre para cambiarlo. Un artículo es uno solo aunque lo compres en varios comercios: así se comparan precios y se suma lo que entra.</p>}
      </div>

      {galeria && <GaleriaTickets titulo={`«${galeria}»`} cargar={cargarTicketsDeTexto(galeria)} vacio="No hay fotos de tickets con este texto" onCerrar={() => setGaleria(null)} />}
    </div>
  )
}
