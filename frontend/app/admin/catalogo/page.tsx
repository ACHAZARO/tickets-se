'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { buildEquivalenceUpdate } from '@/lib/ticket-workflow.mjs'
import { useToast, useConfirm } from '../ui'

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
  const { sucursalId } = useSucursal()
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
    await supabase.from('catalogo_productos').update({
      nombre: nombreNuevo,
      categoria_id: editProd.categoria_id,
      unidad_default: editProd.unidad || null,
      sinonimos,
      contiene_cantidad: equivalencia.contiene_cantidad,
      contiene_unidad: equivalencia.contiene_unidad,
      contiene_sub_cantidad: equivalencia.contiene_sub_cantidad,
      contiene_sub_unidad: equivalencia.contiene_sub_unidad,
    }).eq('id', editProd.id)
    setProductos(prev => prev.map(x => x.id === editProd.id
      ? { ...x, nombre: nombreNuevo, categoria_id: editProd.categoria_id, unidad_default: editProd.unidad || null, sinonimos, contiene_cantidad: equivalencia.contiene_cantidad, contiene_unidad: equivalencia.contiene_unidad, contiene_sub_cantidad: equivalencia.contiene_sub_cantidad, contiene_sub_unidad: equivalencia.contiene_sub_unidad }
      : x))
    setEditProd(null)
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
  }

  const prodsPorCat = (catId: string) => productos.filter(p => p.categoria_id === catId)

  return (
    <div className="space-y-6">
      <datalist id="unidades-catalogo">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>
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
                <button onClick={() => toggleOperativo(c)}
                  title={c.cuenta_operativo ? 'Cuenta en el gasto de operación' : 'NO cuenta en operación (ej. equipo)'}
                  className={`text-xs px-2 py-1 rounded-lg whitespace-nowrap ${c.cuenta_operativo ? 'bg-blue-900/40 text-blue-300' : 'bg-zinc-800 text-zinc-500'}`}>
                  {c.cuenta_operativo ? 'Operativo' : 'No operativo'}
                </button>
                <button onClick={() => toggleCat(c)}
                  className={`text-xs px-2 py-1 rounded-lg ${c.activa ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                  {c.activa ? 'Activa' : 'Inactiva'}
                </button>
                <button onClick={() => pedirBorrarCat(c)} title="Borrar categoría"
                  className="text-xs text-red-400 hover:text-red-300 px-1">borrar</button>
              </div>

              {addProd?.categoriaId === c.id && (
                <div className="px-4 py-3 bg-zinc-800/40 space-y-2 border-b border-zinc-800">
                  <input value={addProd.nombre} onChange={e => setAddProd({ ...addProd, nombre: e.target.value })} placeholder="Nombre del producto (ej. Pasta)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                  <input value={addProd.sinonimos} onChange={e => setAddProd({ ...addProd, sinonimos: e.target.value })} placeholder="Sinónimos / marcas (ej. barilla, espagueti)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                  <div className="flex gap-2">
                    <input list="unidades-catalogo" value={addProd.unidad} onChange={e => setAddProd({ ...addProd, unidad: e.target.value })}
                      placeholder="Unidad (cono, caja, pz...)"
                      className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
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
                    <div key={p.id} className={`px-4 py-2.5 ${!p.activo ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-100 truncate">{p.nombre}</span>
                            {p.unidad_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{p.unidad_default}</span>}
                            {p.veces_matched > 0 && <span className="text-[10px] text-zinc-600">{p.veces_matched}×</span>}
                          </div>
                          {p.sinonimos.length > 0 && <p className="text-xs text-zinc-500 truncate">tambien: {p.sinonimos.join(', ')}</p>}
                        {p.contiene_cantidad && p.contiene_unidad && <p className="text-[11px] text-zinc-600">1 {p.unidad_default ?? 'u'} = {p.contiene_cantidad} {p.contiene_unidad}{p.contiene_sub_cantidad && p.contiene_sub_unidad ? ` = ${(Number(p.contiene_cantidad) * Number(p.contiene_sub_cantidad)).toLocaleString('es-MX')} ${p.contiene_sub_unidad}` : ''}</p>}
                        </div>
                        <button onClick={() => setEditProd(editProd?.id === p.id ? null : { id: p.id, nombre: p.nombre, nombreOriginal: p.nombre, categoria_id: p.categoria_id ?? c.id, unidad: p.unidad_default ?? '', sinonimos: p.sinonimos.join(', '), ...splitEquivalenceFields(p) })}
                          className="text-xs text-blue-400 hover:text-blue-300">{editProd?.id === p.id ? 'cerrar' : 'editar'}</button>
                        <button onClick={() => toggleProd(p)} className={`text-xs px-2 py-1 rounded-lg ${p.activo ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>{p.activo ? 'Activo' : 'Inactivo'}</button>
                        <button onClick={() => eliminarProd(p)} className="text-xs text-red-400 hover:text-red-300">eliminar</button>
                      </div>

                      {editProd?.id === p.id && (
                        <div className="mt-2 space-y-2 bg-zinc-800/40 rounded-lg p-3">
                          <label className="block text-[11px] text-zinc-500">Nombre (el anterior se guarda como sinónimo)</label>
                          <input value={editProd.nombre} onChange={e => setEditProd({ ...editProd, nombre: e.target.value })} placeholder="Nombre del producto"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                          <label className="block text-[11px] text-zinc-500">Categoría (muévelo si está mal clasificado)</label>
                          <select value={editProd.categoria_id} onChange={e => setEditProd({ ...editProd, categoria_id: e.target.value })}
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                            {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                          </select>
                          <input value={editProd.sinonimos} onChange={e => setEditProd({ ...editProd, sinonimos: e.target.value })} placeholder="Sinónimos / marcas (ej. magna, premium, diesel)"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                          <label className="block text-[11px] text-zinc-500">Equivalencia (opcional): 1 {editProd.unidad || p.unidad_default || 'unidad'} trae…</label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input type="number" inputMode="decimal" value={editProd.contiene_cantidad} onChange={e => setEditProd({ ...editProd, contiene_cantidad: e.target.value })}
                              placeholder="cantidad (30)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                            <input list="unidades-catalogo" value={editProd.contiene_unidad} onChange={e => setEditProd({ ...editProd, contiene_unidad: e.target.value })}
                              placeholder="unidad (pz)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                            <input value={editProd.contiene_base_item} onChange={e => setEditProd({ ...editProd, contiene_base_item: e.target.value })}
                              placeholder="de qué (huevo)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                          </div>
                          {editProd.contiene_cantidad.trim() !== '' && editProd.contiene_unidad.trim() !== '' && (
                            <>
                              <label className="block text-[11px] text-zinc-500">Opcional si cada {editProd.contiene_unidad || 'pieza'} trae volumen o peso…</label>
                              <div className="flex gap-2">
                                <input type="number" inputMode="decimal" value={editProd.contiene_sub_cantidad} onChange={e => setEditProd({ ...editProd, contiene_sub_cantidad: e.target.value })}
                                  placeholder="cantidad c/u (355)" className="w-1/2 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                                <input list="unidades-catalogo" value={editProd.contiene_sub_unidad} onChange={e => setEditProd({ ...editProd, contiene_sub_unidad: e.target.value })}
                                  placeholder="unidad final (ml)" className="w-1/2 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                              </div>
                            </>
                          )}
                          {editProd.contiene_cantidad.trim() !== '' && editProd.contiene_unidad.trim() !== '' && (
                            <p className="text-[11px] text-emerald-500/80">
                              1 {editProd.unidad || p.unidad_default || 'u'} = {editProd.contiene_cantidad} {editProd.contiene_unidad}
                              {editProd.contiene_sub_cantidad.trim() !== '' && editProd.contiene_sub_unidad.trim() !== '' &&
                                ` = ${(Number(editProd.contiene_cantidad) * Number(editProd.contiene_sub_cantidad)).toLocaleString('es-MX')} ${editProd.contiene_sub_unidad}`}
                              {editProd.contiene_sub_cantidad.trim() === '' && editProd.contiene_sub_unidad.trim() === '' && editProd.contiene_base_item.trim() !== '' &&
                                ` = ${Number(editProd.contiene_cantidad).toLocaleString('es-MX')} ${editProd.contiene_base_item}`}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <input list="unidades-catalogo" value={editProd.unidad} onChange={e => setEditProd({ ...editProd, unidad: e.target.value })}
                              placeholder="Unidad (cono, caja, pz...)"
                              className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                            <button onClick={guardarEdicion} className="flex-1 rounded-lg bg-zinc-100 py-1.5 text-sm font-semibold text-zinc-900">Guardar</button>
                            <button onClick={() => setEditProd(null)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-400">Cancelar</button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !borrando && setDelCat(null)}>
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-100">Borrar &ldquo;{delCat.cat.nombre}&rdquo;</h3>
            {(delCat.nProd > 0 || delCat.nItems > 0) ? (
              <>
                <p className="text-sm text-zinc-400">
                  Esta categoría tiene {delCat.nProd > 0 && <b>{delCat.nProd} producto(s)</b>}{delCat.nProd > 0 && delCat.nItems > 0 && ' y '}{delCat.nItems > 0 && <b>{delCat.nItems} renglón(es)</b>}. Para no perder gastos, muévelos a otra categoría antes de borrar.
                </p>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Mover todo a:</label>
                  <select value={delCat.destino} onChange={e => setDelCat({ ...delCat, destino: e.target.value })}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-2 text-sm text-zinc-100">
                    <option value="">Elige categoría destino…</option>
                    {categorias.filter(k => k.id !== delCat.cat.id).map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-400">Esta categoría está vacía. Se puede borrar directamente.</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={confirmarBorrarCat} disabled={borrando || ((delCat.nProd > 0 || delCat.nItems > 0) && !delCat.destino)}
                className="flex-1 rounded-xl bg-red-600/90 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
                {borrando ? 'Borrando…' : 'Borrar categoría'}
              </button>
              <button onClick={() => setDelCat(null)} disabled={borrando}
                className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-300">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
