'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { EjemploTicket } from './unificar'

// Galeria "Ver tickets": fotos de tickets una por una. Sirve para un articulo (Configuracion > Articulos) o para
// un comercio (Configuracion > Comercios): quien la abre decide como cargar los tickets (`cargar`).
// Las fotos se borran a los 12 meses (pg_cron limpiar_imagenes_antiguas, migracion 012); los datos se quedan.
export const MESES_FOTOS = 12

const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })

export function GaleriaTickets({ titulo, cargar, vacio, onCerrar }: {
  titulo: string
  cargar: () => Promise<EjemploTicket[]>
  vacio: string
  onCerrar: () => void
}) {
  const [fotos, setFotos] = useState<EjemploTicket[] | null>(null)
  const [sinFoto, setSinFoto] = useState(0)
  const [i, setI] = useState(0)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    cargar().then(todos => {
      if (!vivo) return
      // Un ticket puede traer el producto en varios renglones: una foto por ticket.
      const vistos = new Set<string>()
      const conFoto = todos.filter(e => e.path && !vistos.has(e.path) && vistos.add(e.path))
      setFotos(conFoto)
      setSinFoto(todos.filter(e => !e.path).length)
    })
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo])

  const actual = fotos?.[i] ?? null
  useEffect(() => {
    setUrl(null)
    if (!actual?.bucket || !actual.path) return
    let vivo = true
    supabase.storage.from(actual.bucket).createSignedUrl(actual.path, 3600, { transform: { width: 1400, quality: 75, resize: 'contain' } })
      .then(({ data }) => { if (vivo) setUrl(data?.signedUrl ?? null) })
      .catch(() => {})
    return () => { vivo = false }
  }, [actual?.bucket, actual?.path])

  const total = fotos?.length ?? 0
  const ir = useCallback((d: number) => setI(n => Math.min(Math.max(n + d, 0), Math.max(total - 1, 0))), [total])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
      if (e.key === 'ArrowLeft') ir(-1)
      if (e.key === 'ArrowRight') ir(1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ir, onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm p-3 sm:p-6" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={`Tickets con ${titulo}`}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-zinc-100">{titulo}</p>
            <p className="nota">{fotos === null ? 'Buscando tickets…' : total === 0 ? 'Sin fotos' : `Ticket ${i + 1} de ${total}`}</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="btn-quieto btn-sm text-lg leading-none">×</button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-zinc-950/40 p-2">
          {fotos === null ? (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
          ) : total === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-zinc-400">{vacio} en los últimos {MESES_FOTOS} meses.</p>
          ) : url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" title="Ver foto completa" className="block h-[60dvh] w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Ticket ${i + 1} con ${titulo}`} className="h-full w-full object-contain" />
            </a>
          ) : (
            <div className="flex h-[60dvh] items-center"><span className="nota">Cargando foto…</span></div>
          )}
        </div>

        {actual && (
          <div className="space-y-3 border-t border-zinc-800 px-4 py-3">
            <p className="text-sm text-zinc-200 break-words">
              {actual.descripcion != null && <><span className="text-zinc-500">Dice: </span>&quot;{actual.descripcion}&quot;</>}
              <span className="text-zinc-500"> · {actual.comercio ?? 'sin comercio'} · {actual.fecha}</span>
              {actual.monto != null && <span className="text-zinc-500"> · {fmt(actual.monto)}</span>}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => ir(-1)} disabled={i === 0} className="btn-secundario flex-1">‹ Anterior</button>
              <button type="button" onClick={() => ir(1)} disabled={i >= total - 1} className="btn-secundario flex-1">Siguiente ›</button>
            </div>
          </div>
        )}

        <p className="border-t border-zinc-800 px-4 py-2.5 text-xs text-zinc-500">
          Las fotos se guardan {MESES_FOTOS} meses. Tickets más viejos ya no tienen foto, pero sus datos se conservan.
          {sinFoto > 0 && ` (${sinFoto} ${sinFoto === 1 ? 'ticket' : 'tickets'} de aquí ya sin foto.)`}
        </p>
      </div>
    </div>
  )
}
