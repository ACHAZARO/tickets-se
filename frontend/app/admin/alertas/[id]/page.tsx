'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Categoria { id: string; nombre: string }
interface ProdCat { id: string; nombre: string; categoria_id: string | null; unidad_default: string | null }

interface Item {
  id: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
  producto_catalogo_id: string | null
  necesita_revision: boolean
  motivo_revision: string | null
}

interface AlertaDetail {
  id: string
  tipo: string
  resuelta: boolean
  created_at: string
  registros_tickets: {
    id: string
    comercio: string | null
    monto: number | null
    fecha_ticket: string | null
    folio_ticket: string | null
    storage_path_original: string | null
    storage_path_archivo: string | null
    sucursal_id: string | null
    sucursales: { nombre: string } | null
    empleados: { nombre: string } | null
  } | null
}

const UNIDADES = ['kg', 'g', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']
const fmt = (n: number | null) => n != null ? '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '—'

export default function AlertaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [alerta, setAlerta] = useState<AlertaDetail | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [catalogo, setCatalogo] = useState<ProdCat[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({})
  const [editando, setEditando] = useState<Set<string>>(new Set())
  const [sinonimos, setSinonimos] = useState<Record<string, string>>({})
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fecha, setFecha] = useState('')
  const [comercio, setComercio] = useState('')

  const load = useCallback(async () => {
    const { data: a } = await supabase
      .from('alertas_tickets')
      .select(`id, tipo, resuelta, created_at,
        registros_tickets:registro_ticket_id (
          id, comercio, monto, fecha_ticket, folio_ticket, storage_path_original, storage_path_archivo, sucursal_id,
          sucursales:sucursal_id ( nombre ), empleados:empleado_id ( nombre )
        )`)
      .eq('id', params.id)
      .single()

    const alertaData = a as unknown as AlertaDetail | null
    setAlerta(alertaData)
    setFecha(alertaData?.registros_tickets?.fecha_ticket ?? '')
    setComercio(alertaData?.registros_tickets?.comercio ?? '')

    const sucId = alertaData?.registros_tickets?.sucursal_id ?? null
    const catP = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    let prodP = supabase.from('catalogo_productos').select('id, nombre, categoria_id, unidad_default').eq('activo', true).order('nombre')
    prodP = sucId ? prodP.or(`sucursal_id.is.null,sucursal_id.eq.${sucId}`) : prodP.is('sucursal_id', null)
    let itemsP
    if (alertaData?.registros_tickets?.id) {
      itemsP = supabase
        .from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, categoria_id, producto_catalogo_id, necesita_revision, motivo_revision')
        .eq('registro_ticket_id', alertaData.registros_tickets.id)
        .order('created_at').order('id')
    }
    const [catRes, prodRes, itemsRes] = await Promise.all([catP, prodP, itemsP])
    setCategorias(catRes.data ?? [])
    setCatalogo((prodRes.data as ProdCat[] | null) ?? [])
    setItems((itemsRes?.data as Item[] | undefined) ?? [])

    const reg = alertaData?.registros_tickets
    const archivo = (reg as { storage_path_archivo?: string | null } | null | undefined)?.storage_path_archivo
    const bucket = archivo ? 'archivo' : 'por-revisar'
    const path = archivo ?? reg?.storage_path_original
    if (path) {
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
      setImageUrl(signed?.signedUrl ?? null)
    } else {
      setImageUrl(null)
    }
    setLoading(false)
  }, [params.id])

  useEffect(() => { load() }, [load])

  function setField(id: string, field: keyof Item, value: string | number | null) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }
  function setNum(id: string, field: 'monto' | 'cantidad', value: string) {
    const n = value.trim() === '' ? null : Number(value)
    setField(id, field, Number.isFinite(n as number) ? n : null)
  }
  // Vincula el renglon a un producto del catalogo: hereda categoria y unidad.
  function vincular(it: Item, prodId: string) {
    if (!prodId) { setField(it.id, 'producto_catalogo_id', null); return }
    const p = catalogo.find(x => x.id === prodId)
    setItems(prev => prev.map(x => x.id === it.id ? {
      ...x,
      producto_catalogo_id: prodId,
      categoria_id: p?.categoria_id ?? x.categoria_id,
      unidad: p?.unidad_default ?? x.unidad,
    } : x))
  }

  async function guardarItem(it: Item) {
    setSavingId(it.id)
    const necesita = !it.categoria_id || !it.unidad
    let productoId = it.producto_catalogo_id
    const sucId = alerta?.registros_tickets?.sucursal_id ?? null
    const synManual = (sinonimos[it.id]?.trim() ?? '')
    const synList = synManual ? synManual.split(',').map(s => s.trim()).filter(Boolean) : []

    if (productoId) {
      // Vinculado a un producto existente: lo que la IA leyo (descripcion) se guarda
      // como SINONIMO de ese producto -> "choco" pasa a significar "Pan danes de chocolate".
      const prod = catalogo.find(p => p.id === productoId)
      const extra = [...synList]
      if (prod && it.descripcion.trim() && it.descripcion.trim().toLowerCase() !== prod.nombre.toLowerCase()) {
        extra.push(it.descripcion.trim())
      }
      if (extra.length) {
        const { data: cur } = await supabase.from('catalogo_productos').select('sinonimos').eq('id', productoId).single()
        const merged = Array.from(new Set([...((cur?.sinonimos as string[]) ?? []), ...extra]))
        await supabase.from('catalogo_productos').update({ sinonimos: merged }).eq('id', productoId)
      }
    } else if (it.categoria_id && it.descripcion.trim()) {
      // No vinculado pero ya tiene categoria: lo agregamos al catalogo para aprenderlo.
      const { data: existente } = await supabase.from('catalogo_productos')
        .select('id').ilike('nombre', it.descripcion.trim())
        .or(`sucursal_id.is.null,sucursal_id.eq.${sucId ?? '00000000-0000-0000-0000-000000000000'}`)
        .limit(1).maybeSingle()
      if (existente) {
        productoId = existente.id
        if (synList.length) {
          const { data: cur } = await supabase.from('catalogo_productos').select('sinonimos').eq('id', productoId).single()
          const merged = Array.from(new Set([...((cur?.sinonimos as string[]) ?? []), ...synList]))
          await supabase.from('catalogo_productos').update({ sinonimos: merged }).eq('id', productoId)
        }
      } else {
        const { data: nuevo } = await supabase.from('catalogo_productos').insert({
          nombre: it.descripcion.trim(), sinonimos: synList,
          categoria_id: it.categoria_id, unidad_default: it.unidad || null, sucursal_id: sucId,
        }).select('id').single()
        productoId = nuevo?.id ?? null
      }
    }

    const motivo = necesita ? (!it.categoria_id ? 'sin_categoria' : 'sin_unidad') : null
    await supabase.from('ticket_items').update({
      descripcion: it.descripcion.trim() || it.descripcion,
      cantidad: it.cantidad,
      monto: it.monto,
      categoria_id: it.categoria_id || null,
      unidad: it.unidad || null,
      producto_catalogo_id: productoId,
      necesita_revision: necesita,
      motivo_revision: motivo,
    }).eq('id', it.id)

    setItems(prev => prev.map(x => x.id === it.id
      ? { ...x, producto_catalogo_id: productoId, necesita_revision: necesita, motivo_revision: motivo }
      : x))
    setSinonimos(prev => ({ ...prev, [it.id]: '' }))
    setEditando(prev => { const n = new Set(prev); n.delete(it.id); return n }) // colapsa el renglon ya listo
    setSavingId(null)
    setSavedFlash(prev => ({ ...prev, [it.id]: true }))
    setTimeout(() => setSavedFlash(prev => ({ ...prev, [it.id]: false })), 2500)
  }

  async function resolver() {
    if (!alerta?.registros_tickets) return
    setSavingId('__all__')
    const { error } = await supabase.functions.invoke('confirmar-admin', {
      body: { registro_id: alerta.registros_tickets.id },
    })
    if (error) { setSavingId(null); alert('No se pudo confirmar el ticket: ' + error.message); return }
    await supabase.from('alertas_tickets').update({ resuelta: true }).eq('id', alerta.id)
    router.push('/admin/alertas')
  }

  async function rechazar() {
    if (!alerta) return
    setSavingId('__all__')
    await supabase.from('alertas_tickets').update({ resuelta: true, correccion: { action: 'rejected' } }).eq('id', alerta.id)
    if (alerta.registros_tickets) {
      await supabase.from('registros_tickets').update({ estado: 'rechazado' }).eq('id', alerta.registros_tickets.id)
    }
    router.push('/admin/alertas')
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
  }
  if (!alerta) return <p className="text-zinc-500 text-center py-12">Alerta no encontrada</p>

  const t = alerta.registros_tickets
  const pendientes = items.filter(i => i.necesita_revision).length
  const sumaItems = items.reduce((s, i) => s + (Number(i.monto) || 0), 0)
  const nombreCat = (id: string | null) => categorias.find(c => c.id === id)?.nombre ?? 'sin categoría'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Detalle de alerta</h2>
          <p className="text-xs text-zinc-500">{alerta.tipo.replace(/_/g, ' ')} · {new Date(alerta.created_at).toLocaleString('es-MX')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-900 overflow-hidden">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Ticket" className="w-full max-h-[60vh] object-contain" />
            ) : <div className="flex items-center justify-center h-48 text-zinc-600">Sin imagen</div>}
          </div>
          <div className="rounded-2xl bg-zinc-900 p-4 space-y-1">
            <InfoRow label="Sucursal" value={t?.sucursales?.nombre} />
            <InfoRow label="Empleado" value={t?.empleados?.nombre} />
            <div className="flex justify-between items-center gap-3 py-0.5">
              <span className="text-sm text-zinc-500">Comercio</span>
              <input value={comercio} onChange={e => setComercio(e.target.value)}
                onBlur={() => t && supabase.from('registros_tickets').update({ comercio: comercio || null }).eq('id', t.id)}
                className="text-sm text-zinc-100 text-right bg-zinc-800 rounded px-2 py-1 max-w-[180px]" />
            </div>
            <div className="flex justify-between items-center gap-3 py-0.5">
              <span className="text-sm text-zinc-500">Fecha</span>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                onBlur={() => t && supabase.from('registros_tickets').update({ fecha_ticket: fecha || null }).eq('id', t.id)}
                className="text-sm text-zinc-100 text-right bg-zinc-800 rounded px-2 py-1" />
            </div>
            <InfoRow label="Folio" value={t?.folio_ticket} />
            <InfoRow label="Total ticket" value={fmt(t?.monto ?? null)} />
            <div className="flex justify-between gap-4 pt-1 border-t border-zinc-800 mt-1">
              <span className="text-sm text-zinc-500">Suma de renglones</span>
              <span className={`text-sm text-right ${t?.monto != null && Math.abs(sumaItems - Number(t.monto)) > 1 ? 'text-amber-400' : 'text-zinc-100'}`}>{fmt(sumaItems)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Renglones ({items.length}){pendientes > 0 && <span className="text-amber-400"> · {pendientes} por revisar</span>}
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-zinc-500">Este ticket no tiene renglones (puede ser un ticket viejo).</p>
          ) : items.map(it => {
            const abierto = it.necesita_revision || editando.has(it.id)
            if (!abierto) {
              // Renglon ya listo -> compacto, fuera del camino. "editar" lo reabre.
              return (
                <div key={it.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <span className="text-emerald-400 text-sm">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-100 truncate">{it.descripcion}</p>
                    <p className="text-xs text-zinc-500">{nombreCat(it.categoria_id)}{it.unidad ? ` · ${it.cantidad ?? ''} ${it.unidad}` : ''}</p>
                  </div>
                  <span className="text-sm text-zinc-300 whitespace-nowrap">{fmt(it.monto)}</span>
                  {savedFlash[it.id] && <span className="text-xs text-emerald-400">Guardado</span>}
                  <button onClick={() => setEditando(prev => new Set(prev).add(it.id))} className="text-xs text-blue-400 hover:text-blue-300">editar</button>
                </div>
              )
            }
            return (
              <div key={it.id} className={`rounded-2xl border p-3 space-y-3 ${it.necesita_revision ? 'border-amber-800/40 bg-amber-950/10' : 'border-zinc-800 bg-zinc-900'}`}>
                <input value={it.descripcion} onChange={e => setField(it.id, 'descripcion', e.target.value)}
                  className="w-full text-sm text-zinc-100 bg-zinc-800 rounded-lg px-2 py-1.5 border border-zinc-700" />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Cantidad</label>
                    <input type="number" inputMode="decimal" value={it.cantidad ?? ''} onChange={e => setNum(it.id, 'cantidad', e.target.value)}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Precio ($)</label>
                    <input type="number" inputMode="decimal" value={it.monto ?? ''} onChange={e => setNum(it.id, 'monto', e.target.value)}
                      placeholder="cuánto costó" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Categoría</label>
                    <select value={it.categoria_id ?? ''} onChange={e => setField(it.id, 'categoria_id', e.target.value)}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                      <option value="">Sin categoría</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Unidad</label>
                    <select value={it.unidad ?? ''} onChange={e => setField(it.id, 'unidad', e.target.value)}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                      <option value="">Sin unidad</option>
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1">¿En realidad es otro producto? Vincúlalo (lo leído se vuelve su sinónimo)</label>
                  <select value={it.producto_catalogo_id ?? ''} onChange={e => vincular(it, e.target.value)}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                    <option value="">— no vincular —</option>
                    {catalogo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Enseñar sinónimos (opcional)</label>
                  <input value={sinonimos[it.id] ?? ''} onChange={e => setSinonimos(p => ({ ...p, [it.id]: e.target.value }))}
                    placeholder="ej. mckenin, papa blanca (se guardan en el producto)"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => guardarItem(it)} disabled={savingId === it.id}
                    className="flex-1 rounded-lg bg-zinc-700 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-60">
                    {savingId === it.id ? 'Guardando…' : 'Guardar renglón'}
                  </button>
                  {savedFlash[it.id] && <span className="text-sm text-emerald-400 font-medium">✓ Guardado</span>}
                </div>
              </div>
            )
          })}

          {!alerta.resuelta && (
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={resolver} disabled={savingId !== null}
                className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60">
                Marcar alerta como resuelta
              </button>
              <button onClick={rechazar} disabled={savingId !== null}
                className="w-full rounded-xl bg-zinc-800 py-3 text-base font-medium text-red-400 disabled:opacity-60">
                Rechazar ticket
              </button>
            </div>
          )}
          {alerta.resuelta && (
            <div className="rounded-xl bg-emerald-900/20 border border-emerald-800/30 p-4 text-center">
              <p className="text-sm text-emerald-400 font-medium">Alerta resuelta</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-100 text-right">{value ?? <span className="text-zinc-600 italic">-</span>}</span>
    </div>
  )
}
