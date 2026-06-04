'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Categoria { id: string; nombre: string }

interface Item {
  id: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
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
    sucursales: { nombre: string } | null
    empleados: { nombre: string } | null
  } | null
}

const UNIDADES = ['kg', 'g', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

export default function AlertaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [alerta, setAlerta] = useState<AlertaDetail | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sinonimos, setSinonimos] = useState<Record<string, string>>({})
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: a } = await supabase
      .from('alertas_tickets')
      .select(`id, tipo, resuelta, created_at,
        registros_tickets:registro_ticket_id (
          id, comercio, monto, fecha_ticket, folio_ticket, storage_path_original, storage_path_archivo,
          sucursales:sucursal_id ( nombre ), empleados:empleado_id ( nombre )
        )`)
      .eq('id', params.id)
      .single()

    const alertaData = a as unknown as AlertaDetail | null
    setAlerta(alertaData)

    const catP = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    let itemsP
    if (alertaData?.registros_tickets?.id) {
      itemsP = supabase
        .from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, categoria_id, necesita_revision, motivo_revision')
        .eq('registro_ticket_id', alertaData.registros_tickets.id)
        .order('created_at')
    }
    const [catRes, itemsRes] = await Promise.all([catP, itemsP])
    setCategorias(catRes.data ?? [])
    setItems((itemsRes?.data as Item[] | undefined) ?? [])

    // Foto: bucket privado -> URL firmada (archivo si ya se confirmo, si no por-revisar)
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

  function updateItemField(id: string, field: keyof Item, value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  async function guardarItem(it: Item) {
    setSaving(true)
    const necesita = !it.categoria_id || !it.unidad
    await supabase.from('ticket_items').update({
      categoria_id: it.categoria_id || null,
      unidad: it.unidad || null,
      necesita_revision: necesita,
      motivo_revision: necesita ? (!it.categoria_id ? 'sin_categoria' : 'sin_unidad') : null,
    }).eq('id', it.id)

    const syn = sinonimos[it.id]?.trim()
    if (syn && it.categoria_id) {
      await supabase.from('catalogo_productos').insert({
        nombre: it.descripcion,
        sinonimos: syn.split(',').map(s => s.trim()).filter(Boolean),
        categoria_id: it.categoria_id,
        unidad_default: it.unidad || null,
      })
    }
    setSaving(false)
    await load()
  }

  async function resolver() {
    if (!alerta) return
    setSaving(true)
    await supabase.from('alertas_tickets').update({ resuelta: true }).eq('id', alerta.id)
    router.push('/admin/alertas')
  }

  async function rechazar() {
    if (!alerta) return
    setSaving(true)
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
            <InfoRow label="Comercio" value={t?.comercio} />
            <InfoRow label="Fecha" value={t?.fecha_ticket} />
            <InfoRow label="Folio" value={t?.folio_ticket} />
            <InfoRow label="Total" value={t?.monto != null ? `$${t.monto}` : null} />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Renglones ({items.length}){pendientes > 0 && <span className="text-amber-400"> · {pendientes} por revisar</span>}
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-zinc-500">Este ticket no tiene renglones (puede ser un ticket viejo).</p>
          ) : items.map(it => (
            <div key={it.id} className={`rounded-2xl border p-3 space-y-3 ${it.necesita_revision ? 'border-amber-800/40 bg-amber-950/10' : 'border-zinc-800 bg-zinc-900'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-zinc-100">{it.descripcion}</p>
                <span className="text-sm text-zinc-400 whitespace-nowrap">{it.monto != null ? `$${it.monto}` : '—'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Categoría</label>
                  <select value={it.categoria_id ?? ''} onChange={e => updateItemField(it.id, 'categoria_id', e.target.value)}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                    <option value="">Sin categoría</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Unidad</label>
                  <select value={it.unidad ?? ''} onChange={e => updateItemField(it.id, 'unidad', e.target.value)}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                    <option value="">Sin unidad</option>
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Enseñar sinónimos (opcional)</label>
                <input value={sinonimos[it.id] ?? ''} onChange={e => setSinonimos(p => ({ ...p, [it.id]: e.target.value }))}
                  placeholder="ej. mckenin, papa blanca (lo guarda en el catálogo)"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
              </div>
              <button onClick={() => guardarItem(it)} disabled={saving}
                className="w-full rounded-lg bg-zinc-700 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-60">
                Guardar renglón
              </button>
            </div>
          ))}

          {!alerta.resuelta && (
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={resolver} disabled={saving}
                className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60">
                Marcar alerta como resuelta
              </button>
              <button onClick={rechazar} disabled={saving}
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
