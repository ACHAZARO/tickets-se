'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Alerta {
  id: string
  tipo: string
  resuelta: boolean
  created_at: string
  registros_tickets: {
    comercio: string | null
    monto: number | null
    fecha_ticket: string | null
    producto: string | null
    storage_path_original: string | null
    sucursales: { nombre: string } | null
  } | null
}

const TIPO_CONFIG: Record<string, { label: string; color: string }> = {
  posible_duplicado: { label: 'Duplicado', color: 'bg-amber-900/40 text-amber-400' },
  duplicado: { label: 'Duplicado', color: 'bg-amber-900/40 text-amber-400' },
  ilegible: { label: 'Ilegible', color: 'bg-red-900/40 text-red-400' },
  producto_no_reconocido: { label: 'Producto nuevo', color: 'bg-blue-900/40 text-blue-400' },
  sin_unidad: { label: 'Sin unidad', color: 'bg-purple-900/40 text-purple-400' },
  monto_anomalo: { label: 'Monto alto', color: 'bg-orange-900/40 text-orange-400' },
  precio_anomalo: { label: 'Cambio de precio', color: 'bg-orange-900/40 text-orange-400' },
}

type FilterType = 'all' | 'pending' | 'resolved'

export default function AlertasPage() {
  const { sucursalId } = useSucursal()
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('pending')

  const fetchAlertas = useCallback(async () => {
    let query = supabase
      .from('alertas_tickets')
      .select(`
        id, tipo, resuelta, created_at,
        registros_tickets:registro_ticket_id!inner (
          comercio, monto, fecha_ticket, producto, storage_path_original, sucursal_id,
          sucursales:sucursal_id ( nombre )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (filter === 'pending') query = query.eq('resuelta', false)
    if (filter === 'resolved') query = query.eq('resuelta', true)
    if (sucursalId) query = query.eq('registros_tickets.sucursal_id', sucursalId)

    const { data } = await query
    setAlertas((data as unknown as Alerta[]) ?? [])
    setLoading(false)
  }, [filter, sucursalId])

  useEffect(() => {
    setLoading(true)
    fetchAlertas()
  }, [fetchAlertas])

  const counts = alertas.reduce((acc, a) => {
    if (!a.resuelta) {
      acc.total++
      acc[a.tipo] = (acc[a.tipo] || 0) + 1
    }
    return acc
  }, { total: 0 } as Record<string, number>)

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-zinc-100">Alertas</h2>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CounterCard label="Pendientes" count={counts.total} color="text-zinc-100" />
        <CounterCard label="Duplicados" count={(counts.duplicado || 0) + (counts.posible_duplicado || 0)} color="text-amber-400" />
        <CounterCard label="Productos nuevos" count={counts.producto_no_reconocido || 0} color="text-blue-400" />
        <CounterCard label="Ilegibles" count={counts.ilegible || 0} color="text-red-400" />
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['pending', 'all', 'resolved'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f === 'pending' ? 'Pendientes' : f === 'all' ? 'Todas' : 'Resueltas'}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
        </div>
      ) : alertas.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No hay alertas {filter === 'pending' ? 'pendientes' : ''}</p>
      ) : (
        <div className="space-y-2">
          {alertas.map(a => {
            const ticket = a.registros_tickets
            const config = TIPO_CONFIG[a.tipo] ?? { label: a.tipo, color: 'bg-zinc-800 text-zinc-400' }
            return (
              <Link
                key={a.id}
                href={`/admin/alertas/${a.id}`}
                className="flex items-center gap-4 rounded-xl bg-zinc-900 p-4 hover:bg-zinc-800/80 transition-colors"
              >
                {/* Thumbnail */}
                <div className="h-14 w-14 rounded-lg bg-zinc-800 flex-shrink-0 overflow-hidden">
                  {ticket?.storage_path_original && (
                    <img
                      src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/por-revisar/${ticket.storage_path_original}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.color}`}>
                      {config.label}
                    </span>
                    {a.resuelta && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400">
                        Resuelta
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-100 truncate">
                    {ticket?.comercio ?? ticket?.producto ?? 'Sin datos'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {ticket?.sucursales?.nombre ?? ''} · {ticket?.monto ? `$${ticket.monto}` : ''} · {new Date(a.created_at).toLocaleDateString('es-MX')}
                  </p>
                </div>

                <svg className="h-5 w-5 text-zinc-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CounterCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-xl bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
    </div>
  )
}
