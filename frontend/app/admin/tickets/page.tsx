'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Sucursal { id: string; nombre: string }
interface Item { descripcion: string; cantidad: number | null; unidad: string | null; monto: number | null; categorias_gasto: { nombre: string } | null }
interface Ticket {
  id: string
  comercio: string | null
  fecha_ticket: string | null
  monto: number | null
  estado: string
  created_at: string
  storage_path_original: string | null
  storage_path_archivo: string | null
  sucursales: { nombre: string } | null
  empleados: { nombre: string } | null
}

const ESTADO_COLOR: Record<string, string> = {
  confirmado: 'bg-emerald-900/40 text-emerald-400',
  pendiente: 'bg-amber-900/40 text-amber-400',
  rechazado: 'bg-red-900/40 text-red-400',
  archivado: 'bg-zinc-800 text-zinc-400',
}

function primerDiaMesISO(): string {
  const n = new Date()
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`
}
function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}
const fmt = (n: number | null) => n != null ? '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '—'

function pathBucket(t: Ticket): { bucket: string; path: string } | null {
  if (t.storage_path_archivo) return { bucket: 'archivo', path: t.storage_path_archivo }
  if (t.storage_path_original) return { bucket: 'por-revisar', path: t.storage_path_original }
  return null
}

export default function TicketsPage() {
  const { sucursalId } = useSucursal()
  const [desde, setDesde] = useState(primerDiaMesISO())
  const [hasta, setHasta] = useState(hoyISO())
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<{ ticket: Ticket; items: Item[]; url: string | null } | null>(null)
  const [descargando, setDescargando] = useState(false)

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('registros_tickets')
      .select('id, comercio, fecha_ticket, monto, estado, created_at, storage_path_original, storage_path_archivo, sucursales:sucursal_id(nombre), empleados:empleado_id(nombre)')
      .gte('fecha_ticket', desde).lte('fecha_ticket', hasta)
      .order('fecha_ticket', { ascending: false }).limit(500)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    const { data } = await q
    const rows = (data as unknown as Ticket[]) ?? []
    setTickets(rows)

    // Firmar URLs por bucket (thumbnails)
    const byBucket: Record<string, string[]> = { archivo: [], 'por-revisar': [] }
    for (const t of rows) { const pb = pathBucket(t); if (pb) byBucket[pb.bucket].push(pb.path) }
    const map: Record<string, string> = {}
    for (const bucket of ['archivo', 'por-revisar']) {
      if (byBucket[bucket].length === 0) continue
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(byBucket[bucket], 3600)
      for (const s of signed ?? []) if (s.signedUrl && s.path) map[`${bucket}/${s.path}`] = s.signedUrl
    }
    setUrls(map)
    setLoading(false)
  }, [desde, hasta, sucursalId])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  function urlDe(t: Ticket): string | null {
    const pb = pathBucket(t)
    return pb ? (urls[`${pb.bucket}/${pb.path}`] ?? null) : null
  }

  async function eliminarTicket(t: Ticket) {
    if (!confirm('¿Eliminar este ticket? Se borran el registro, sus renglones y la foto. No se puede deshacer.')) return
    const pb = pathBucket(t)
    if (pb) await supabase.storage.from(pb.bucket).remove([pb.path])
    const { error } = await supabase.from('registros_tickets').delete().eq('id', t.id)
    if (error) { alert('No se pudo eliminar: ' + error.message); return }
    setDetalle(null)
    setTickets(prev => prev.filter(x => x.id !== t.id))
  }

  async function abrirDetalle(t: Ticket) {
    const { data } = await supabase.from('ticket_items')
      .select('descripcion, cantidad, unidad, monto, categorias_gasto:categoria_id(nombre)')
      .eq('registro_ticket_id', t.id).order('created_at')
    setDetalle({ ticket: t, items: (data as unknown as Item[]) ?? [], url: urlDe(t) })
  }

  async function descargarPeriodo() {
    if (tickets.length === 0) return
    setDescargando(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const csv = ['Fecha,Comercio,Sucursal,Empleado,Total,Estado,Archivo']
      let i = 0
      for (const t of tickets) {
        i++
        const safe = (s: string | null) => (s ?? '').replace(/[^\w-]+/g, '_').slice(0, 30)
        const base = `${t.fecha_ticket ?? 'sinfecha'}_${safe(t.comercio)}_${t.id.slice(0, 6)}`
        const url = urlDe(t)
        let archivo = ''
        if (url) {
          try {
            const blob = await (await fetch(url)).blob()
            const ext = (pathBucket(t)?.path.split('.').pop() ?? 'jpg').slice(0, 4)
            archivo = `${base}.${ext}`
            zip.file(archivo, blob)
          } catch { /* imagen no disponible */ }
        }
        csv.push([t.fecha_ticket ?? '', t.comercio ?? '', t.sucursales?.nombre ?? '', t.empleados?.nombre ?? '', t.monto ?? '', t.estado, archivo].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      }
      zip.file('tickets.csv', csv.join('\n'))
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `tickets_${desde}_a_${hasta}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold text-zinc-100">Tickets</h2>
        <button onClick={descargarPeriodo} disabled={descargando || tickets.length === 0}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">
          {descargando ? 'Preparando ZIP...' : `Descargar periodo (${tickets.length})`}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : tickets.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No hay tickets en este periodo</p>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const url = urlDe(t)
            return (
              <button key={t.id} onClick={() => abrirDetalle(t)}
                className="w-full flex items-center gap-4 rounded-xl bg-zinc-900 p-3 hover:bg-zinc-800/80 transition-colors text-left">
                <div className="h-14 w-14 rounded-lg bg-zinc-800 flex-shrink-0 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-zinc-100 truncate">{t.comercio ?? 'Sin comercio'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_COLOR[t.estado] ?? 'bg-zinc-800 text-zinc-400'}`}>{t.estado}</span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {t.sucursales?.nombre ?? ''} · {t.empleados?.nombre ?? ''} · {t.fecha_ticket ?? ''}
                  </p>
                </div>
                <span className="text-sm text-zinc-300 whitespace-nowrap">{fmt(t.monto)}</span>
              </button>
            )
          })}
        </div>
      )}

      {detalle && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4" onClick={() => setDetalle(null)}>
          <div className="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">{detalle.ticket.comercio ?? 'Ticket'}</h3>
              <button onClick={() => setDetalle(null)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-zinc-500">
              {detalle.ticket.sucursales?.nombre} · subido por <span className="text-zinc-300">{detalle.ticket.empleados?.nombre ?? 'Desconocido'}</span> · {detalle.ticket.fecha_ticket}
            </p>
            {detalle.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detalle.url} alt="Ticket" className="w-full max-h-[50vh] object-contain rounded-xl bg-zinc-950" />
            )}
            <div className="rounded-xl bg-zinc-800/50 divide-y divide-zinc-800">
              {detalle.items.length === 0 ? (
                <p className="px-3 py-3 text-sm text-zinc-500">Sin renglones</p>
              ) : detalle.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-zinc-100 truncate">{it.descripcion}</p>
                    <p className="text-xs text-zinc-500">{it.cantidad ?? ''} {it.unidad ?? ''} · {it.categorias_gasto?.nombre ?? 'sin categoría'}</p>
                  </div>
                  <span className="text-zinc-300 whitespace-nowrap">{fmt(it.monto)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Total</span>
              <span className="text-zinc-100 font-semibold">{fmt(detalle.ticket.monto)}</span>
            </div>
            <button
              onClick={() => eliminarTicket(detalle.ticket)}
              className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-medium text-red-400 hover:bg-zinc-700"
            >
              Eliminar ticket
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
