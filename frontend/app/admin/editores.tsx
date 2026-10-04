'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PanelLateral, Consejo, useToast } from './ui'
import { ElegirArticulo, type OpcionArticulo } from './elegir-articulo'
import { FotoTicket, type EjemploTicket } from './unificar'

// Editores en panel lateral: se usan desde Precios (y donde haga falta) para corregir SIN cambiar de pantalla.

const UNIDADES_COMPRA = ['pz', 'g', 'kg', 'ml', 'lt', 'caja', 'paquete', 'bolsa', 'bulto', 'rollo', 'galon', 'servicio']
const UNIDADES_CONTENIDO = ['g', 'kg', 'ml', 'lt', 'pz']
const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------------------------------------------
// Editar ARTICULO (nombre, categoria, unidad de compra, lo que trae cada uno, otras formas de escribirlo)
// ---------------------------------------------------------------------------------------------------------------
interface Art {
  id: string; nombre: string; sinonimos: string[]; categoria_id: string | null; unidad_default: string | null
  contiene_cantidad: number | null; contiene_unidad: string | null; contiene_sub_cantidad: number | null; sucursal_id: string | null
}

export function EditorArticulo({ productoId, onCerrar, onGuardado }: { productoId: string; onCerrar: () => void; onGuardado: () => void }) {
  const toast = useToast()
  const [art, setArt] = useState<Art | null>(null)
  const [cats, setCats] = useState<{ id: string; nombre: string }[]>([])
  const [f, setF] = useState({ nombre: '', categoria_id: '', unidad: '', trae: '', traeUnidad: 'g', sinonimos: '' })
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('catalogo_productos')
        .select('id, nombre, sinonimos, categoria_id, unidad_default, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, sucursal_id')
        .eq('id', productoId).maybeSingle()
      const a = data as Art | null
      if (!a) { toast('No se encontró el artículo', 'error'); onCerrar(); return }
      let q = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
      q = a.sucursal_id ? q.or(`sucursal_id.is.null,sucursal_id.eq.${a.sucursal_id}`) : q.is('sucursal_id', null)
      const { data: c } = await q
      setCats((c as { id: string; nombre: string }[] | null) ?? [])
      setArt(a)
      setF({
        nombre: a.nombre, categoria_id: a.categoria_id ?? '', unidad: a.unidad_default ?? '',
        trae: a.contiene_cantidad != null ? String(a.contiene_cantidad) : '', traeUnidad: a.contiene_unidad ?? 'g',
        sinonimos: (a.sinonimos ?? []).join(', '),
      })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId])

  const dosNiveles = !!art?.contiene_sub_cantidad

  async function guardar() {
    if (!art) return
    const nombre = f.nombre.trim()
    if (!nombre) { toast('El artículo necesita nombre', 'error'); return }
    const trae = Number(f.trae)
    if (f.trae.trim() && (!Number.isFinite(trae) || trae <= 0)) { toast('Revisa cuánto trae cada uno', 'error'); return }
    const sinonimos = f.sinonimos.split(',').map(s => s.trim()).filter(Boolean)
    // Si le cambias el nombre, el anterior queda como otra forma de escribirlo (la IA lo sigue reconociendo).
    if (nombre.toLowerCase() !== art.nombre.toLowerCase() && !sinonimos.some(s => s.toLowerCase() === art.nombre.toLowerCase())) sinonimos.push(art.nombre)
    const cambios: Record<string, unknown> = {
      nombre, categoria_id: f.categoria_id || null, unidad_default: f.unidad.trim() || null, sinonimos,
    }
    if (!dosNiveles) {
      cambios.contiene_cantidad = f.trae.trim() ? trae : null
      cambios.contiene_unidad = f.trae.trim() ? f.traeUnidad : null
    }
    setGuardando(true)
    const { error } = await supabase.from('catalogo_productos').update(cambios).eq('id', art.id)
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast(`«${nombre}» actualizado`)
    onGuardado(); onCerrar()
  }

  return (
    <PanelLateral titulo="Editar artículo" subtitulo={art?.nombre} onCerrar={onCerrar}
      pie={<>
        <button onClick={guardar} disabled={!art || guardando} className="btn-primario flex-1">{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button onClick={onCerrar} className="btn-quieto">Atrás</button>
      </>}>
      {!art ? <div className="flex justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div> : (
        <>
          <label className="block space-y-1">
            <span className="etiqueta block">Nombre</span>
            <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className="campo w-full" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="etiqueta block">Categoría</span>
              <select value={f.categoria_id} onChange={e => setF({ ...f, categoria_id: e.target.value })} className="campo w-full">
                <option value="">Sin categoría</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="etiqueta block">Se compra por</span>
              <input list="editor-unidades" value={f.unidad} onChange={e => setF({ ...f, unidad: e.target.value })} placeholder="pz, caja, kg…" className="campo w-full" />
              <datalist id="editor-unidades">{UNIDADES_COMPRA.map(u => <option key={u} value={u} />)}</datalist>
            </label>
          </div>
          {dosNiveles ? (
            <p className="nota">Tiene una equivalencia de dos niveles (ej. caja → pz → ml). Para cambiarla <Link href={`/admin/catalogo?editar=${art.id}`} className="text-emerald-400 underline underline-offset-2">ábrelo en Artículos</Link>.</p>
          ) : (
            <div className="space-y-1">
              <span className="etiqueta block">Cada {f.unidad || 'uno'} trae (opcional)</span>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="decimal" min={0} value={f.trae} onChange={e => setF({ ...f, trae: e.target.value })} placeholder="ej. 12" className="campo w-28" />
                <select value={f.traeUnidad} onChange={e => setF({ ...f, traeUnidad: e.target.value })} aria-label="Unidad de lo que trae" className="campo">
                  {[...new Set([...UNIDADES_CONTENIDO, f.traeUnidad])].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <p className="nota">Ej. «1 caja trae 12 pz»: así la caja y la pieza se comparan al mismo precio.</p>
            </div>
          )}
          <Consejo>Usa la misma unidad que tus recetas: si la receta pide gramos, pon cuántos gramos trae.</Consejo>
          <label className="block space-y-1">
            <span className="etiqueta block">Otras formas de escribirlo</span>
            <textarea value={f.sinonimos} onChange={e => setF({ ...f, sinonimos: e.target.value })} rows={3} className="campo w-full" />
            <span className="nota block">Separadas por coma. Así lo escriben los tickets; la IA las usa para reconocerlo.</span>
          </label>
        </>
      )}
    </PanelLateral>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Corregir RENGLON de un ticket (articulo ligado, cantidad, unidad, importe) viendo la foto
// ---------------------------------------------------------------------------------------------------------------
interface Renglon {
  id: string; descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null
  producto_catalogo_id: string | null
  registros_tickets: { id: string; comercio: string | null; fecha_ticket: string | null; created_at: string; sucursal_id: string; storage_path_original: string | null; storage_path_archivo: string | null }
}

export function EditorRenglon({ itemId, onCerrar, onGuardado }: { itemId: string; onCerrar: () => void; onGuardado: () => void }) {
  const toast = useToast()
  const [r, setR] = useState<Renglon | null>(null)
  const [opciones, setOpciones] = useState<(OpcionArticulo & { categoria_id: string | null })[]>([])
  const [f, setF] = useState({ cantidad: '', unidad: '', monto: '', producto: null as OpcionArticulo | null, texto: '' })
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, producto_catalogo_id, registros_tickets!inner(id, comercio, fecha_ticket, created_at, sucursal_id, storage_path_original, storage_path_archivo)')
        .eq('id', itemId).maybeSingle()
      const x = data as unknown as Renglon | null
      if (!x) { toast('No se encontró el renglón', 'error'); onCerrar(); return }
      const { data: prods } = await supabase.from('catalogo_productos').select('id, nombre, categoria_id, categorias_gasto:categoria_id(nombre)')
        .eq('activo', true).or(`sucursal_id.is.null,sucursal_id.eq.${x.registros_tickets.sucursal_id}`).order('nombre')
      const ops = ((prods as unknown as { id: string; nombre: string; categoria_id: string | null; categorias_gasto: { nombre: string } | null }[] | null) ?? [])
        .map(p => ({ id: p.id, nombre: p.nombre, detalle: p.categorias_gasto?.nombre, categoria_id: p.categoria_id }))
      setOpciones(ops)
      setR(x)
      const actual = ops.find(o => o.id === x.producto_catalogo_id) ?? null
      setF({ cantidad: x.cantidad != null ? String(x.cantidad) : '', unidad: x.unidad ?? '', monto: x.monto != null ? String(x.monto) : '', producto: actual, texto: actual?.nombre ?? '' })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const cant = Number(f.cantidad), monto = Number(f.monto)
  const precio = Number.isFinite(cant) && cant > 0 && Number.isFinite(monto) && monto > 0 ? monto / cant : null

  async function guardar() {
    if (!r) return
    if (!Number.isFinite(cant) || cant <= 0) { toast('La cantidad debe ser mayor a 0', 'error'); return }
    if (!f.monto.trim() || !Number.isFinite(monto) || monto < 0) { toast('Escribe el importe del renglón', 'error'); return }
    if (f.texto.trim() && !f.producto) { toast('Elige un artículo de la lista (o déjalo como estaba)', 'error'); return }
    const cambios: Record<string, unknown> = { cantidad: cant, unidad: f.unidad.trim() || null, monto }
    // Solo si CAMBIO el articulo: si no, se respeta la categoria que tenga el renglon (pudo ponerse a mano).
    if (f.producto && f.producto.id !== r.producto_catalogo_id) {
      cambios.producto_catalogo_id = f.producto.id
      const cat = opciones.find(o => o.id === f.producto!.id)?.categoria_id
      if (cat) cambios.categoria_id = cat
    }
    setGuardando(true)
    const { error } = await supabase.from('ticket_items').update(cambios).eq('id', r.id)
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    // El historial de precios del ticket se recalcula (si no, las alertas nuevas comparan contra el error).
    await supabase.rpc('recalcular_precios_ticket', { p_registro: r.registros_tickets.id })
    toast('Renglón corregido')
    onGuardado(); onCerrar()
  }

  const t = r?.registros_tickets
  const foto: EjemploTicket | null = t ? {
    descripcion: r!.descripcion, cantidad: r!.cantidad, unidad: r!.unidad, monto: r!.monto, comercio: t.comercio,
    fecha: t.fecha_ticket ?? t.created_at.slice(0, 10),
    bucket: t.storage_path_archivo ? 'archivo' : t.storage_path_original ? 'por-revisar' : null,
    path: t.storage_path_archivo ?? t.storage_path_original,
  } : null

  return (
    <PanelLateral titulo="Corregir renglón" subtitulo={t ? `${t.comercio ?? 'Sin comercio'} · ${t.fecha_ticket ?? t.created_at.slice(0, 10)}` : undefined} onCerrar={onCerrar}
      pie={<>
        <button onClick={guardar} disabled={!r || guardando} className="btn-primario flex-1">{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button onClick={onCerrar} className="btn-quieto">Atrás</button>
      </>}>
      {!r ? <div className="flex justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div> : (
        <>
          <div className="max-w-[16rem]"><FotoTicket nombre="Foto del ticket" ej={foto} /></div>
          <p className="text-sm text-zinc-300">En el ticket dice: <b className="text-zinc-100">«{r.descripcion ?? '—'}»</b></p>
          <div className="space-y-1">
            <span className="etiqueta block">Artículo</span>
            <ElegirArticulo key={r.id} valorInicial={f.texto} ariaLabel="Artículo del renglón" placeholder="Busca el artículo"
              opciones={opciones} onCambio={(texto, elegida) => setF(x => ({ ...x, texto, producto: elegida }))}
              notaNuevo={() => <>Ese artículo no existe: elige uno de la lista.</>} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block space-y-1">
              <span className="etiqueta block">Cantidad</span>
              <input type="number" inputMode="decimal" min={0} value={f.cantidad} onChange={e => setF({ ...f, cantidad: e.target.value })} className="campo w-full" />
            </label>
            <label className="block space-y-1">
              <span className="etiqueta block">Unidad</span>
              <input list="renglon-unidades" value={f.unidad} onChange={e => setF({ ...f, unidad: e.target.value })} className="campo w-full" />
              <datalist id="renglon-unidades">{UNIDADES_COMPRA.map(u => <option key={u} value={u} />)}</datalist>
            </label>
            <label className="block space-y-1">
              <span className="etiqueta block">Importe</span>
              <input type="number" inputMode="decimal" min={0} value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} className="campo w-full" />
            </label>
          </div>
          <p className="text-sm text-zinc-300">Precio por {f.unidad || 'unidad'}: <b className="text-zinc-100">{precio != null ? fmt(precio) : '—'}</b></p>
          <p className="nota">Cambiar el importe del renglón no cambia el total del ticket. <Link href={`/admin/tickets?abrir=${t!.id}`} className="text-emerald-400 underline underline-offset-2">Abrir el ticket completo</Link></p>
        </>
      )}
    </PanelLateral>
  )
}
