'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { buildEquivalenceUpdate } from '@/lib/ticket-workflow.mjs'
import { useToast, useConfirm, Interruptor, Consejo } from '../ui'
import { unificarProductos, ejemplosDe } from '../unificar'
import { GaleriaTickets } from '../galeria-tickets'
import { ElegirArticulo, type OpcionArticulo } from '../elegir-articulo'

interface Categoria { id: string; nombre: string; orden: number; activa: boolean; sucursal_id: string | null; cuenta_operativo: boolean }
interface Producto {
  id: string
  nombre: string
  sinonimos: string[]
  categoria_id: string | null
  unidad_default: string | null
  veces_matched: number
  activo: boolean
  sucursal_id: string | null
  contiene_cantidad: number | null
  contiene_unidad: string | null
  contiene_sub_cantidad: number | null
  contiene_sub_unidad: string | null
}

function splitEquivalenceFields(p: Pick<Producto, 'contiene_cantidad' | 'contiene_unidad' | 'contiene_sub_cantidad' | 'contiene_sub_unidad'>) {
  const subIsNamedBaseItem = Number(p.contiene_sub_cantidad) === 1 && !!p.contiene_sub_unidad && p.contiene_sub_unidad.toLowerCase() !== String(p.contiene_unidad ?? '').toLowerCase()
  return {
    contiene_cantidad: p.contiene_cantidad?.toString() ?? '',
    contiene_unidad: p.contiene_unidad ?? '',
    contiene_base_item: subIsNamedBaseItem ? p.contiene_sub_unidad ?? '' : '',
    contiene_sub_cantidad: subIsNamedBaseItem ? '' : p.contiene_sub_cantidad?.toString() ?? '',
    contiene_sub_unidad: subIsNamedBaseItem ? '' : p.contiene_sub_unidad ?? '',
  }
}

const UNIDADES = ['pz', 'kg', 'g', 'ml', 'lt', 'caja', 'bulto', 'paquete', 'cono', 'charola', 'costal', 'reja', 'rollo', 'galon', 'six', 'docena', 'atado', 'manojo', 'otro']

export default function CatalogoPage() {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevaCat, setNuevaCat] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  // alta de producto: categoriaId del form abierto -> datos
  const [addProd, setAddProd] = useState<null | { categoriaId: string; nombre: string; sinonimos: string; unidad: string }>(null)
  const [savingProd, setSavingProd] = useState(false)
  // edicion de producto existente
  const [editProd, setEditProd] = useState<null | { id: string; nombre: string; nombreOriginal: string; categoria_id: string; unidad: string; sinonimos: string; contiene_cantidad: string; contiene_unidad: string; contiene_base_item: string; contiene_sub_cantidad: string; contiene_sub_unidad: string }>(null)
  // borrado de categoria (con reasignacion si tiene contenido)
  const [delCat, setDelCat] = useState<null | { cat: Categoria; nProd: number; nItems: number; destino: string }>(null)
  const [borrando, setBorrando] = useState(false)
  // unificar un producto con otro (mismo insumo, dos nombres)
  const [unifProd, setUnifProd] = useState<null | { id: string; destinoId: string }>(null)
  const [verTickets, setVerTickets] = useState<null | { id: string; nombre: string }>(null)
  const [addExiste, setAddExiste] = useState<OpcionArticulo | null>(null)   // alta: el nombre ya es un articulo
  const [editChoca, setEditChoca] = useState<OpcionArticulo | null>(null)   // edicion: el nombre nuevo es OTRO articulo
  const [unificando, setUnificando] = useState(false)

  const fetchData = useCallback(async () => {
    let catQ = supabase.from('categorias_gasto').select('id, nombre, orden, activa, sucursal_id, cuenta_operativo').order('orden')
    let prodQ = supabase.from('catalogo_productos').select('id, nombre, sinonimos, categoria_id, unidad_default, veces_matched, activo, sucursal_id, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, contiene_sub_unidad').order('nombre')
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ // "Todas": sin filtro (global + todas las sucursales)
    prodQ = sucursalId ? prodQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : prodQ
    const [catRes, prodRes] = await Promise.all([catQ, prodQ])
    setCategorias((catRes.data as Categoria[] | null) ?? [])
    setProductos((prodRes.data as Producto[] | null) ?? [])
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  // Enlace directo (p.ej. desde Precios): /admin/catalogo?editar=<id> abre ese articulo listo para editar.
  const [pendienteEditar, setPendienteEditar] = useState<string | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('editar')
    if (!id) return
    window.history.replaceState(null, '', window.location.pathname)
    setPendienteEditar(id)
  }, [])
  useEffect(() => {
    if (!pendienteEditar || loading) return
    const p = productos.find(x => x.id === pendienteEditar)
    setPendienteEditar(null)
    if (!p) { toast('Ese artículo no está en esta sucursal; prueba con "Todas las sucursales"', 'error'); return }
    abrirEdicion(p, p.categoria_id ?? '')
    setTimeout(() => document.getElementById(`prod-${p.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendienteEditar, loading, productos])

  function abrirEdicion(p: Producto, categoriaId: string) {
    setEditChoca(null)
    setEditProd({ id: p.id, nombre: p.nombre, nombreOriginal: p.nombre, categoria_id: p.categoria_id ?? categoriaId, unidad: p.unidad_default ?? '', sinonimos: p.sinonimos.join(', '), ...splitEquivalenceFields(p) })
  }

  async function agregarCat() {
    if (!nuevaCat.trim()) return
    // Lo que se crea es de UN negocio: nunca global (la app la usan varios negocios).
    if (!sucursalId) { toast('Elige una sucursal arriba para crear la categoría: cada negocio tiene las suyas.', 'error'); return }
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
  async function toggleOperativo(c: Categoria) {
    await supabase.from('categorias_gasto').update({ cuenta_operativo: !c.cuenta_operativo }).eq('id', c.id)
    setCategorias(prev => prev.map(x => x.id === c.id ? { ...x, cuenta_operativo: !x.cuenta_operativo } : x))
  }

  async function pedirBorrarCat(c: Categoria) {
    const nProd = productos.filter(p => p.categoria_id === c.id).length
    const { count } = await supabase.from('ticket_items').select('id', { count: 'exact', head: true }).eq('categoria_id', c.id)
    setDelCat({ cat: c, nProd, nItems: count ?? 0, destino: '' })
  }
  async function confirmarBorrarCat() {
    if (!delCat) return
    const { cat, nProd, nItems, destino } = delCat
    if ((nProd > 0 || nItems > 0) && !destino) return // hay que reasignar
    setBorrando(true)
    if (destino) {
      if (nProd > 0) await supabase.from('catalogo_productos').update({ categoria_id: destino }).eq('categoria_id', cat.id)
      if (nItems > 0) await supabase.from('ticket_items').update({ categoria_id: destino }).eq('categoria_id', cat.id)
    }
    await supabase.from('comercios').update({ categoria_id: null }).eq('categoria_id', cat.id)
    // objetivos_costo.categoria_id es FK NOT NULL: reasignar (o borrar si no hay destino)
    // para que el delete de la categoria no falle ni deje huerfanos.
    if (destino) await supabase.from('objetivos_costo').update({ categoria_id: destino }).eq('categoria_id', cat.id)
    else await supabase.from('objetivos_costo').delete().eq('categoria_id', cat.id)
    const { error } = await supabase.from('categorias_gasto').delete().eq('id', cat.id)
    setBorrando(false)
    if (error) { toast('No se pudo borrar: ' + error.message, 'error'); return }
    setDelCat(null); setLoading(true); fetchData()
  }

  async function guardarProducto() {
    if (!addProd || !addProd.nombre.trim()) return
    // Un producto siempre es de UNA sucursal: lo que aprende un negocio no debe aparecerle a otro.
    if (!sucursalId) { toast('Elige una sucursal arriba para crear el producto: cada negocio tiene su catálogo.', 'error'); return }
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
    if (!(await confirm(`¿Eliminar "${p.nombre}" del catálogo? Los renglones que lo usaban conservan su categoría pero se desligan del producto.`, { danger: true }))) return
    // Desliga los renglones (FK NO ACTION: si no, el borrado falla). Conservan categoria/descripcion.
    await supabase.from('ticket_items').update({ producto_catalogo_id: null }).eq('producto_catalogo_id', p.id)
    const { error } = await supabase.from('catalogo_productos').delete().eq('id', p.id)
    if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return }
    setProductos(prev => prev.filter(x => x.id !== p.id))
  }
  async function ejecutarUnificacion(p: Producto) {
    if (!unifProd || unifProd.id !== p.id || !unifProd.destinoId) return
    const destino = productos.find(x => x.id === unifProd.destinoId)
    if (!destino) return
    if (!(await confirm(`¿Unificar "${p.nombre}" dentro de "${destino.nombre}"? Sus compras pasan a "${destino.nombre}", que también reconocerá el nombre "${p.nombre}". Queda respaldo.`))) return
    setUnificando(true)
    const r = await unificarProductos(p.id, destino.id)
    setUnificando(false)
    if (!r.ok) { toast('No se pudo unificar: ' + r.error, 'error'); return }
    toast(`Unificado: ${r.renglones} renglones ahora en "${destino.nombre}"`)
    setUnifProd(null)
    fetchData()
  }
  async function guardarEdicion() {
    if (!editProd || !editProd.categoria_id) return
    const sinonimos = editProd.sinonimos ? editProd.sinonimos.split(',').map(s => s.trim()).filter(Boolean) : []
    const equivalencia = buildEquivalenceUpdate({
      baseQty: editProd.contiene_cantidad,
      baseUnit: editProd.contiene_unidad,
      baseItem: editProd.contiene_base_item,
      subQty: editProd.contiene_sub_cantidad,
      subUnit: editProd.contiene_sub_unidad,
    })
    const nombreNuevo = editProd.nombre.trim() || editProd.nombreOriginal
    // Si renombras, el nombre con el que se guardo queda como sinonimo (aprendizaje).
    if (nombreNuevo.toLowerCase() !== editProd.nombreOriginal.toLowerCase() && !sinonimos.some(s => s.toLowerCase() === editProd.nombreOriginal.toLowerCase())) {
      sinonimos.push(editProd.nombreOriginal)
    }
    const { error } = await supabase.from('catalogo_productos').update({
      nombre: nombreNuevo,
      categoria_id: editProd.categoria_id,
      unidad_default: editProd.unidad || null,
      sinonimos,
      contiene_cantidad: equivalencia.contiene_cantidad,
      contiene_unidad: equivalencia.contiene_unidad,
      contiene_sub_cantidad: equivalencia.contiene_sub_cantidad,
      contiene_sub_unidad: equivalencia.contiene_sub_unidad,
    }).eq('id', editProd.id)
    if (error) { toast('No se pudo guardar el producto: ' + error.message, 'error'); return }
    setProductos(prev => prev.map(x => x.id === editProd.id
      ? { ...x, nombre: nombreNuevo, categoria_id: editProd.categoria_id, unidad_default: editProd.unidad || null, sinonimos, contiene_cantidad: equivalencia.contiene_cantidad, contiene_unidad: equivalencia.contiene_unidad, contiene_sub_cantidad: equivalencia.contiene_sub_cantidad, contiene_sub_unidad: equivalencia.contiene_sub_unidad }
      : x))
    setEditProd(null)
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
  }

  const prodsPorCat = (catId: string) => productos.filter(p => p.categoria_id === catId)
  const opcionesArticulo: OpcionArticulo[] = productos.map(p => ({
    id: p.id, nombre: p.nombre, detalle: categorias.find(c => c.id === p.categoria_id)?.nombre,
  }))

  return (
    <div className="space-y-6">
      <datalist id="unidades-catalogo">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Artículos y categorías</h2>
        <p className="nota mt-1">
          {sucursalId ? 'Ves lo global + lo de esta sucursal; lo nuevo es de esta sucursal.' : 'Ves lo global; elige una sucursal arriba para algo específico.'}
        </p>
      </div>

      <div className="flex max-w-xl gap-2">
        <input value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') agregarCat() }}
          placeholder="Nueva categoría (ej. Mantenimiento)"
          className="campo flex-1 px-4 py-2.5" />
        <button onClick={agregarCat} disabled={savingCat || !nuevaCat.trim()}
          className="btn-secundario">+ Categoría</button>
      </div>

      <div className="space-y-4">
        {categorias.map(c => {
          const prods = prodsPorCat(c.id)
          return (
            <div key={c.id} className="tarjeta overflow-hidden">
              <div className="space-y-3 px-4 py-3.5 border-b border-zinc-800">
                {/* 1. Que es: nombre (se edita tocandolo), cuantos articulos y de que sucursal */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <label className="group relative flex min-w-0 basis-full items-center sm:basis-auto sm:flex-1" title="Toca para cambiar el nombre">
                    <input value={c.nombre} onChange={e => renombrarCat(c, e.target.value)} onBlur={() => guardarNombreCat(c)}
                      aria-label="Nombre de la categoría"
                      className={`w-full min-w-0 rounded-lg -ml-2 px-2 py-1 text-base font-semibold bg-transparent outline-none hover:bg-zinc-800/60 focus:bg-zinc-800 ${c.activa ? 'text-zinc-100' : 'text-zinc-500'}`} />
                    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      className="pointer-events-none absolute right-1 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-0">
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </label>
                  <p className="text-[13px] text-zinc-500 whitespace-nowrap">
                    {prods.length} {prods.length === 1 ? 'artículo' : 'artículos'} · {c.sucursal_id === null
                      ? <span title="Esta categoría existe en todas las sucursales">todas las sucursales</span>
                      : <span title="Esta categoría solo existe en esta sucursal">solo {sucursales.find(x => x.id === c.sucursal_id)?.nombre ?? 'una sucursal'}</span>}
                  </p>
                </div>

                {/* 2. Como se comporta: interruptores con su explicacion al pasar el cursor */}
                <div className="flex flex-wrap gap-x-2 gap-y-1 -ml-2">
                  <Interruptor encendido={c.activa} onCambiar={() => toggleCat(c)}
                    etiqueta="La IA la usa"
                    ayuda={c.activa
                      ? 'Encendida: la IA puede poner tickets nuevos en esta categoría. Toca para apagarla.'
                      : 'Apagada: la IA ya no pone tickets nuevos aquí (lo anterior se conserva). Toca para encenderla.'} />
                  <Interruptor encendido={c.cuenta_operativo} onCambiar={() => toggleOperativo(c)}
                    etiqueta="Cuenta como gasto operativo"
                    ayuda={c.cuenta_operativo
                      ? 'Encendido: suma a «Gasto operativo» en General › Gasto (tarjeta, reparto por categoría y tendencia). Apágalo para compras que no son de la operación diaria: equipo, inversiones, gastos personales.'
                      : 'Apagado: no suma al gasto operativo. Se ve aparte como «Gasto no operativo» en General › Gasto. Toca para que cuente.'} />
                </div>

                {/* 3. Que puedo hacer */}
                <div className="flex items-center gap-2">
                  <button onClick={() => { setAddExiste(null); setAddProd({ categoriaId: c.id, nombre: '', sinonimos: '', unidad: '' }) }}
                    className="btn-secundario btn-sm">+ Agregar artículo</button>
                  <button onClick={() => pedirBorrarCat(c)} title="Borrar la categoría (te pregunta a dónde mover sus artículos)"
                    className="btn-peligro btn-sm ml-auto">Borrar categoría</button>
                </div>
              </div>

              {addProd?.categoriaId === c.id && (
                <div className="px-4 py-3 bg-zinc-800/50 space-y-2 border-b border-zinc-800">
                  <ElegirArticulo key={`alta-${c.id}`} ariaLabel="Nombre del artículo" placeholder="Nombre del artículo (ej. Pasta)"
                    opciones={opcionesArticulo}
                    onCambio={(texto, elegida) => { setAddProd(a => a && { ...a, nombre: texto }); setAddExiste(elegida) }}
                    notaNuevo={t => <>«{t}» es nuevo: se creará en «{c.nombre}» al guardar.</>}
                    notaExistente={o => <>Ya existe{o.detalle ? ` en «${o.detalle}»` : ''}. No hace falta crearlo: ábrelo para editarlo.</>} />
                  <input value={addProd.sinonimos} onChange={e => setAddProd({ ...addProd, sinonimos: e.target.value })} placeholder="Sinónimos / marcas (ej. barilla, espagueti)"
                    className="campo w-full px-2 py-1.5" />
                  <Consejo>Si vas a llevar inventario, usa la misma unidad que tus recetas (ej. si la receta pide gramos, pon cuántos gramos trae).</Consejo>
                  <div className="flex flex-wrap gap-2">
                    <input list="unidades-catalogo" value={addProd.unidad} onChange={e => setAddProd({ ...addProd, unidad: e.target.value })}
                      placeholder="Unidad (cono, caja, pz...)"
                      className="campo basis-full px-2 py-1.5 sm:basis-auto sm:flex-1" />
                    {addExiste ? (
                      <button onClick={() => {
                        const ex = productos.find(x => x.id === addExiste.id)
                        setAddProd(null); setAddExiste(null)
                        if (ex) { abrirEdicion(ex, ex.categoria_id ?? ''); setTimeout(() => document.getElementById(`prod-${ex.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100) }
                      }} className="btn-primario btn-sm flex-1">Abrir «{addExiste.nombre}»</button>
                    ) : (
                      <button onClick={guardarProducto} disabled={savingProd || !addProd.nombre.trim()}
                        className="btn-primario btn-sm flex-1">Guardar</button>
                    )}
                    <button onClick={() => { setAddProd(null); setAddExiste(null) }} className="btn-quieto btn-sm">Atrás</button>
                  </div>
                </div>
              )}

              {prods.length === 0 ? (
                <p className="px-4 py-3 nota">Sin artículos. Agrégalos con «+ Agregar artículo».</p>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {prods.map(p => (
                    <div key={p.id} id={`prod-${p.id}`} className={`px-4 py-2.5 scroll-mt-40 ${!p.activo ? 'opacity-50' : ''}`}>
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-100 truncate">{p.nombre}</span>
                            {p.unidad_default && <span className="chip-neutro">{p.unidad_default}</span>}
                            {p.veces_matched > 0 && <span className="text-xs text-zinc-500" title={`La IA lo ha reconocido ${p.veces_matched} ${p.veces_matched === 1 ? 'vez' : 'veces'} en tickets`}>{p.veces_matched}×</span>}
                          </div>
                          {p.sinonimos.length > 0 && <p className="text-xs text-zinc-500 truncate">también: {p.sinonimos.join(', ')}</p>}
                        {p.contiene_cantidad && p.contiene_unidad && <p className="text-xs text-zinc-500">1 {p.unidad_default ?? 'u'} = {p.contiene_cantidad} {p.contiene_unidad}{p.contiene_sub_cantidad && p.contiene_sub_unidad ? ` = ${(Number(p.contiene_cantidad) * Number(p.contiene_sub_cantidad)).toLocaleString('es-MX')} ${p.contiene_sub_unidad}` : ''}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 -ml-2 sm:ml-0">
                        <button onClick={() => setVerTickets({ id: p.id, nombre: p.nombre })} className="btn-texto btn-sm">Ver tickets</button>
                        <button onClick={() => editProd?.id === p.id ? setEditProd(null) : abrirEdicion(p, c.id)}
                          className="btn-secundario btn-sm">{editProd?.id === p.id ? 'Cerrar' : 'Editar'}</button>
                        <button onClick={() => setUnifProd(unifProd?.id === p.id ? null : { id: p.id, destinoId: '' })}
                          title="Es el mismo insumo que otro producto: unificarlos"
                          className="btn-quieto btn-sm">{unifProd?.id === p.id ? 'Atrás' : 'Unificar'}</button>
                        <Interruptor compacto encendido={p.activo} onCambiar={() => toggleProd(p)} etiqueta="Activo"
                          ayuda={p.activo
                            ? 'Encendido: la IA reconoce este artículo en tickets nuevos. Toca para apagarlo.'
                            : 'Apagado: la IA ya no lo usa para reconocer tickets nuevos. Toca para encenderlo.'} />
                        <button onClick={() => eliminarProd(p)} className="btn-peligro btn-sm">Eliminar</button>
                        </div>
                      </div>

                      {unifProd?.id === p.id && (() => {
                        // Solo productos de la misma categoria y del mismo alcance (misma sucursal o global).
                        const candidatos = prods.filter(q => q.id !== p.id && (q.sucursal_id === p.sucursal_id || q.sucursal_id === null))
                        return (
                          <div className="mt-2 space-y-2 bg-zinc-800/50 rounded-lg p-3">
                            <label className="etiqueta block">Unificar &quot;{p.nombre}&quot; dentro de:</label>
                            <select value={unifProd.destinoId} onChange={e => setUnifProd({ ...unifProd, destinoId: e.target.value })}
                              className="campo w-full px-2 py-1.5">
                              <option value="">Elige el producto que se queda…</option>
                              {candidatos.map(q => <option key={q.id} value={q.id}>{q.nombre}{q.unidad_default ? ` (${q.unidad_default})` : ''}</option>)}
                            </select>
                            <p className="nota">&quot;{p.nombre}&quot; desaparece del catálogo: sus compras pasan al producto elegido, que también reconocerá este nombre. Queda respaldo.</p>
                            <div className="flex gap-2">
                              <button onClick={() => ejecutarUnificacion(p)} disabled={!unifProd.destinoId || unificando}
                                className="btn-primario btn-sm">{unificando ? 'Unificando…' : 'Unificar'}</button>
                              <button onClick={() => setUnifProd(null)} className="btn-quieto btn-sm">Atrás</button>
                            </div>
                          </div>
                        )
                      })()}

                      {editProd?.id === p.id && (
                        <div className="mt-2 space-y-2 bg-zinc-800/50 rounded-lg p-3">
                          <label className="etiqueta block">Nombre (el anterior queda como sinónimo)</label>
                          <ElegirArticulo key={`edit-${p.id}`} valorInicial={editProd.nombre} ariaLabel="Nombre del artículo" placeholder="Nombre del artículo"
                            opciones={opcionesArticulo.filter(o => o.id !== p.id)}
                            onCambio={(texto, elegida) => { setEditProd(e => e && { ...e, nombre: texto }); setEditChoca(elegida) }}
                            notaExistente={o => <span className="text-amber-400">Ya hay otro artículo «{o.nombre}». Si son lo mismo, usa «Unificar» en vez de cambiarle el nombre.</span>} />
                          <label className="etiqueta block">Categoría</label>
                          <select value={editProd.categoria_id} onChange={e => setEditProd({ ...editProd, categoria_id: e.target.value })}
                            className="campo w-full px-2 py-1.5">
                            {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                          </select>
                          <input value={editProd.sinonimos} onChange={e => setEditProd({ ...editProd, sinonimos: e.target.value })} placeholder="Sinónimos / marcas (ej. magna, premium, diesel)"
                            className="campo w-full px-2 py-1.5" />
                          <label className="etiqueta block">Equivalencia (opcional): 1 {editProd.unidad || p.unidad_default || 'unidad'} trae…</label>
                          <Consejo>Pon lo que trae en la unidad de tus recetas: si la receta pide gramos, «1 caja trae 12 pz de 250 g». Así el inventario y el costo de cada platillo cuadran.</Consejo>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input type="number" inputMode="decimal" value={editProd.contiene_cantidad} onChange={e => setEditProd({ ...editProd, contiene_cantidad: e.target.value })}
                              placeholder="cantidad (30)" className="campo px-2 py-1.5" />
                            <input list="unidades-catalogo" value={editProd.contiene_unidad} onChange={e => setEditProd({ ...editProd, contiene_unidad: e.target.value })}
                              placeholder="unidad (pz)" className="campo px-2 py-1.5" />
                            <input value={editProd.contiene_base_item} onChange={e => setEditProd({ ...editProd, contiene_base_item: e.target.value })}
                              placeholder="de qué (huevo)" className="campo px-2 py-1.5" />
                          </div>
                          {editProd.contiene_cantidad.trim() !== '' && editProd.contiene_unidad.trim() !== '' && (
                            <>
                              <label className="etiqueta block">Opcional si cada {editProd.contiene_unidad || 'pieza'} trae volumen o peso…</label>
                              <div className="flex gap-2">
                                <input type="number" inputMode="decimal" value={editProd.contiene_sub_cantidad} onChange={e => setEditProd({ ...editProd, contiene_sub_cantidad: e.target.value })}
                                  placeholder="cantidad c/u (355)" className="campo w-1/2 px-2 py-1.5" />
                                <input list="unidades-catalogo" value={editProd.contiene_sub_unidad} onChange={e => setEditProd({ ...editProd, contiene_sub_unidad: e.target.value })}
                                  placeholder="unidad final (ml)" className="campo w-1/2 px-2 py-1.5" />
                              </div>
                            </>
                          )}
                          {editProd.contiene_cantidad.trim() !== '' && editProd.contiene_unidad.trim() !== '' && (
                            <p className="text-[13px] text-emerald-400">
                              1 {editProd.unidad || p.unidad_default || 'u'} = {editProd.contiene_cantidad} {editProd.contiene_unidad}
                              {editProd.contiene_sub_cantidad.trim() !== '' && editProd.contiene_sub_unidad.trim() !== '' &&
                                ` = ${(Number(editProd.contiene_cantidad) * Number(editProd.contiene_sub_cantidad)).toLocaleString('es-MX')} ${editProd.contiene_sub_unidad}`}
                              {editProd.contiene_sub_cantidad.trim() === '' && editProd.contiene_sub_unidad.trim() === '' && editProd.contiene_base_item.trim() !== '' &&
                                ` = ${Number(editProd.contiene_cantidad).toLocaleString('es-MX')} ${editProd.contiene_base_item}`}
                            </p>
                          )}
                          <label className="etiqueta block">Se compra por (unidad)</label>
                          <input list="unidades-catalogo" value={editProd.unidad} onChange={e => setEditProd({ ...editProd, unidad: e.target.value })}
                            placeholder="Unidad (cono, caja, pz...)"
                            className="campo w-full px-2 py-1.5" />
                          <div className="flex gap-2 pt-1">
                            <button onClick={guardarEdicion} disabled={!!editChoca} title={editChoca ? 'Ese nombre ya es de otro artículo' : undefined}
                              className="btn-primario btn-sm flex-1">Guardar</button>
                            <button onClick={() => setEditProd(null)} className="btn-quieto btn-sm">Atrás</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {delCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm p-4" onClick={() => !borrando && setDelCat(null)}>
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-100">Borrar &ldquo;{delCat.cat.nombre}&rdquo;</h3>
            {(delCat.nProd > 0 || delCat.nItems > 0) ? (
              <>
                <p className="text-sm text-zinc-400">
                  Esta categoría tiene {delCat.nProd > 0 && <b>{delCat.nProd} producto(s)</b>}{delCat.nProd > 0 && delCat.nItems > 0 && ' y '}{delCat.nItems > 0 && <b>{delCat.nItems} renglón(es)</b>}. Para no perder gastos, muévelos a otra categoría antes de borrar.
                </p>
                <div>
                  <label className="etiqueta block mb-1">Mover todo a:</label>
                  <select value={delCat.destino} onChange={e => setDelCat({ ...delCat, destino: e.target.value })}
                    className="campo w-full px-2 py-2">
                    <option value="">Elige categoría destino…</option>
                    {categorias.filter(k => k.id !== delCat.cat.id).map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-400">Está vacía; se puede borrar directamente.</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={confirmarBorrarCat} disabled={borrando || ((delCat.nProd > 0 || delCat.nItems > 0) && !delCat.destino)}
                className="btn-peligro-lleno flex-1 py-2.5">
                {borrando ? 'Borrando…' : 'Borrar categoría'}
              </button>
              <button onClick={() => setDelCat(null)} disabled={borrando}
                className="btn-quieto py-2.5">Atrás</button>
            </div>
          </div>
        </div>
      )}
      {verTickets && <GaleriaTickets titulo={verTickets.nombre} cargar={() => ejemplosDe(verTickets.id, 200)} vacio="No hay fotos de tickets con este artículo" onCerrar={() => setVerTickets(null)} />}
    </div>
  )
}
