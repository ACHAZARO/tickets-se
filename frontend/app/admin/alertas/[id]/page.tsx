'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface AlertaDetail {
  id: string
  tipo: string
  resuelta: boolean
  duplicado_de_id: string | null
  created_at: string
  registros_tickets: {
    id: string
    comercio: string | null
    monto: number | null
    fecha_ticket: string | null
    folio_ticket: string | null
    producto: string | null
    cantidad: number | null
    unidad: string | null
    categoria_gasto: string | null
    storage_path_original: string | null
    sucursales: { nombre: string } | null
    empleados: { nombre: string } | null
  } | null
}

interface Categoria {
  id: string
  nombre: string
}

const UNIDADES = ['kg', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

export default function AlertaDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [alerta, setAlerta] = useState<AlertaDetail | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Editable fields
  const [producto, setProducto] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [unidad, setUnidad] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [monto, setMonto] = useState('')
  const [precioRef, setPrecioRef] = useState('')
  const [sinonimos, setSinonimos] = useState('')

  useEffect(() => {
    async function load() {
      const [alertaRes, catRes] = await Promise.all([
        supabase
          .from('alertas_tickets')
          .select(`
            id, tipo, resuelta, duplicado_de_id, created_at,
            registros_tickets:registro_ticket_id (
              id, comercio, monto, fecha_ticket, folio_ticket, producto,
              cantidad, unidad, categoria_gasto, storage_path_original,
              sucursales:sucursal_id ( nombre ),
              empleados:empleado_id ( nombre )
            )
          `)
          .eq('id', params.id)
          .single(),
        supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden'),
      ])

      if (alertaRes.data) {
        const a = alertaRes.data as unknown as AlertaDetail
        setAlerta(a)
        const t = a.registros_tickets
        if (t) {
          setProducto(t.producto ?? '')
          setUnidad(t.unidad ?? '')
          setCantidad(t.cantidad?.toString() ?? '')
          setMonto(t.monto?.toString() ?? '')
        }
      }
      setCategorias(catRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [params.id])

  async function handleApprove() {
    if (!alerta?.registros_tickets) return
    setSaving(true)

    const selectedCat = categorias.find(c => c.id === categoriaId)

    // Add to catalog if product is new
    if (alerta.tipo === 'producto_no_reconocido' && producto && categoriaId) {
      await supabase.from('catalogo_productos').insert({
        nombre: producto,
        sinonimos: sinonimos ? sinonimos.split(',').map(s => s.trim()).filter(Boolean) : [],
        categoria_id: categoriaId,
        unidad_default: unidad || null,
        precio_referencia: precioRef ? parseFloat(precioRef) : null,
      })
    }

    // Update the ticket record with corrections
    await supabase
      .from('registros_tickets')
      .update({
        producto: producto || undefined,
        categoria_gasto: selectedCat?.nombre || undefined,
        categoria_id: categoriaId || undefined,
        unidad: unidad || undefined,
        cantidad: cantidad ? parseFloat(cantidad) : undefined,
        monto: monto ? parseFloat(monto) : undefined,
      })
      .eq('id', alerta.registros_tickets.id)

    // Mark alert as resolved
    await supabase
      .from('alertas_tickets')
      .update({
        resuelta: true,
        correccion: { producto, categoria: selectedCat?.nombre, unidad, cantidad, monto, precioRef, sinonimos },
      })
      .eq('id', alerta.id)

    router.push('/admin/alertas')
  }

  async function handleReject() {
    if (!alerta) return
    setSaving(true)

    await supabase
      .from('alertas_tickets')
      .update({ resuelta: true, correccion: { action: 'rejected' } })
      .eq('id', alerta.id)

    if (alerta.registros_tickets) {
      await supabase
        .from('registros_tickets')
        .update({ estado: 'rechazado' })
        .eq('id', alerta.registros_tickets.id)
    }

    router.push('/admin/alertas')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
      </div>
    )
  }

  if (!alerta) {
    return <p className="text-zinc-500 text-center py-12">Alerta no encontrada</p>
  }

  const ticket = alerta.registros_tickets
  const imageUrl = ticket?.storage_path_original
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/por-revisar/${ticket.storage_path_original}`
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Detalle de alerta</h2>
          <p className="text-xs text-zinc-500">{alerta.tipo.replace(/_/g, ' ')} · {new Date(alerta.created_at).toLocaleString('es-MX')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ticket photo */}
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="Ticket" className="w-full max-h-[60vh] object-contain" />
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-600">Sin imagen</div>
          )}
        </div>

        {/* Editable data */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-900 p-4 space-y-1">
            <InfoRow label="Sucursal" value={ticket?.sucursales?.nombre} />
            <InfoRow label="Empleado" value={ticket?.empleados?.nombre} />
            <InfoRow label="Comercio" value={ticket?.comercio} />
            <InfoRow label="Fecha" value={ticket?.fecha_ticket} />
            <InfoRow label="Folio" value={ticket?.folio_ticket} />
          </div>

          <div className="rounded-2xl bg-zinc-900 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-2">Corregir datos</p>

            <Field label="Producto" value={producto} onChange={setProducto} />

            <div>
              <label className="text-xs text-zinc-500 block mb-1">Categoria</label>
              <select
                value={categoriaId}
                onChange={e => setCategoriaId(e.target.value)}
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Seleccionar...</option>
                {categorias.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Unidad</label>
                <select
                  value={unidad}
                  onChange={e => setUnidad(e.target.value)}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="">Seleccionar...</option>
                  {UNIDADES.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <Field label="Cantidad" value={cantidad} onChange={setCantidad} type="number" />
            </div>

            <Field label="Monto" value={monto} onChange={setMonto} type="number" />

            {alerta.tipo === 'producto_no_reconocido' && (
              <>
                <Field label="Precio referencia" value={precioRef} onChange={setPrecioRef} type="number" placeholder="Para detectar montos anomalos" />
                <Field label="Sinonimos" value={sinonimos} onChange={setSinonimos} placeholder="aceite, aceite cocina (separados por coma)" />
              </>
            )}
          </div>

          {!alerta.resuelta && (
            <div className="flex flex-col gap-3">
              <button
                onClick={handleApprove}
                disabled={saving}
                className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60"
              >
                {saving ? 'Guardando...' : alerta.tipo === 'producto_no_reconocido' ? 'Aprobar y agregar al catalogo' : 'Aprobar correccion'}
              </button>
              <button
                onClick={handleReject}
                disabled={saving}
                className="w-full rounded-xl bg-zinc-800 py-3 text-base font-medium text-red-400 disabled:opacity-60"
              >
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

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
      />
    </div>
  )
}
