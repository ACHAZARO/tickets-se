'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface PageProps {
  params: { slug: string }
}

interface TicketItem {
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  necesita_revision?: boolean
}

interface TicketData {
  fecha: string | null
  comercio: string | null
  folio_ticket: string | null
  monto_total: number | null
  confianza: string | null
  items: TicketItem[]
}

type UploadState = 'idle' | 'preview' | 'processing' | 'review' | 'confirming' | 'done' | 'error'

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

export default function SubirPage({ params }: PageProps) {
  const { slug } = params
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<UploadState>('idle')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [ticketData, setTicketData] = useState<TicketData | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [empleadoId, setEmpleadoId] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [registroId, setRegistroId] = useState<string | null>(null)

  // Guard: verify session exists
  useEffect(() => {
    const session = sessionStorage.getItem(`auth_${slug}`)
    if (!session) {
      router.replace(`/sucursal/${slug}`)
      return
    }
    try {
      const parsed = JSON.parse(session)
      // Session expires after 30 minutes
      if (Date.now() - parsed.timestamp > 30 * 60 * 1000) {
        sessionStorage.removeItem(`auth_${slug}`)
        router.replace(`/sucursal/${slug}`)
        return
      }
      setEmpleadoId(parsed.empleadoId)
      setSessionToken(parsed.sessionToken ?? null)
    } catch {
      router.replace(`/sucursal/${slug}`)
    }
  }, [slug, router])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    setTicketData(null)
    setErrorMsg('')

    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
      setState('preview')
    }
    reader.readAsDataURL(file)
  }, [])

  const handleProcess = useCallback(async () => {
    if (!imageFile) return
    setState('processing')
    setErrorMsg('')

    try {
      const formData = new FormData()
      formData.append('imagen', imageFile)

      const res = await fetch(`${EDGE_FUNCTIONS_URL}/procesar-ticket`, {
        method: 'POST',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
        body: formData,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Error al procesar el ticket')
      }
      if (data.duplicado) {
        throw new Error('Este ticket ya fue registrado antes.')
      }

      setRegistroId(data.registro_id ?? null)
      setTicketData(data.ticket ?? null)
      setState('review')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Error desconocido')
      setState('error')
    }
  }, [imageFile, sessionToken])

  const handleConfirm = useCallback(async () => {
    if (!registroId) return
    setState('confirming')

    try {
      const res = await fetch(`${EDGE_FUNCTIONS_URL}/confirmar-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ registro_id: registroId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al confirmar el ticket')
      }

      setState('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al confirmar')
      setState('error')
    }
  }, [registroId, sessionToken])

  const handleDiscard = useCallback(() => {
    setImageFile(null)
    setImagePreview(null)
    setTicketData(null)
    setErrorMsg('')
    setState('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleNewTicket = useCallback(() => {
    handleDiscard()
    // Restore session for another ticket
    setRegistroId(null)
    const session = sessionStorage.getItem(`auth_${slug}`)
    if (!session && empleadoId) {
      sessionStorage.setItem(
        `auth_${slug}`,
        JSON.stringify({ empleadoId, sessionToken, timestamp: Date.now() })
      )
    }
  }, [handleDiscard, slug, empleadoId, sessionToken])

  // Done screen
  if (state === 'done') {
    return (
      <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center px-6 text-center safe-top safe-bottom">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-900/40 mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-zinc-100">Ticket registrado</h2>
        <p className="mt-2 text-sm text-zinc-400">Los datos han sido guardados en Google Sheets.</p>
        <button
          onClick={handleNewTicket}
          className="mt-8 w-full max-w-xs rounded-2xl bg-zinc-800 py-4 text-base font-medium text-zinc-100 active:scale-95 transition-transform"
        >
          Subir otro ticket
        </button>
        <button
          onClick={() => router.push(`/sucursal/${slug}`)}
          className="mt-3 w-full max-w-xs rounded-2xl py-4 text-base font-medium text-zinc-500 active:scale-95 transition-transform"
        >
          Salir
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen min-h-[100dvh] flex-col px-4 pb-8 pt-10 safe-top safe-bottom">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.push(`/sucursal/${slug}`)}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 active:scale-95 transition-transform"
          aria-label="Volver"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Subir ticket</h1>
          <p className="text-xs text-zinc-500">Sucursal: {slug}</p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* IDLE: no image selected */}
      {state === 'idle' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-zinc-700 bg-zinc-900/50 px-6 py-16 text-center transition-colors hover:border-zinc-500 active:scale-[0.98]"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                />
              </svg>
            </div>
            <div>
              <p className="text-base font-medium text-zinc-200">Tomar foto / Subir imagen</p>
              <p className="mt-1 text-sm text-zinc-500">Apunta la cámara al ticket de gastos</p>
            </div>
          </button>
        </div>
      )}

      {/* PREVIEW: image selected, not yet processed */}
      {(state === 'preview' || state === 'processing') && imagePreview && (
        <div className="flex flex-1 flex-col gap-4">
          {/* Image preview */}
          <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900" style={{ aspectRatio: '3/4', maxHeight: '55vh' }}>
            <Image
              src={imagePreview}
              alt="Vista previa del ticket"
              fill
              className="object-contain"
              unoptimized
            />
            {state === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/70 backdrop-blur-sm">
                <svg
                  className="h-10 w-10 animate-spin text-zinc-300"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <p className="text-sm font-medium text-zinc-300">Procesando con IA...</p>
              </div>
            )}
          </div>

          {state === 'preview' && (
            <div className="flex flex-col gap-3">
              <button
                onClick={handleProcess}
                className="w-full rounded-2xl bg-zinc-100 py-4 text-base font-semibold text-zinc-900 transition-transform active:scale-[0.98]"
              >
                Procesar ticket
              </button>
              <button
                onClick={handleDiscard}
                className="w-full rounded-2xl bg-zinc-800 py-4 text-base font-medium text-zinc-300 transition-transform active:scale-[0.98]"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {/* REVIEW: show extracted data */}
      {(state === 'review' || state === 'confirming') && ticketData && (
        <div className="flex flex-1 flex-col gap-4">
          {/* Thumbnail */}
          {imagePreview && (
            <div className="relative h-28 w-full overflow-hidden rounded-xl bg-zinc-900">
              <Image
                src={imagePreview}
                alt="Ticket"
                fill
                className="object-cover opacity-70"
                unoptimized
              />
            </div>
          )}

          {/* Extracted data */}
          <div className="rounded-2xl bg-zinc-900 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Datos extraídos por IA
            </p>
            <dl className="space-y-3">
              <DataRow label="Comercio" value={ticketData.comercio} />
              <DataRow label="Fecha" value={ticketData.fecha} />
              <DataRow label="Folio" value={ticketData.folio_ticket} />
              <DataRow
                label="Total"
                value={
                  ticketData.monto_total != null
                    ? `$ ${ticketData.monto_total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                    : null
                }
              />
            </dl>
          </div>

          {/* Items */}
          <div className="rounded-2xl bg-zinc-900 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Productos ({ticketData.items?.length ?? 0})
            </p>
            {(!ticketData.items || ticketData.items.length === 0) ? (
              <p className="text-sm text-zinc-500">No se detectaron productos.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {ticketData.items.map((it, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100 truncate">{it.descripcion ?? 'Producto'}</p>
                      <p className="text-xs text-zinc-500">
                        {it.cantidad ?? ''} {it.unidad ?? ''}
                        {it.necesita_revision && <span className="ml-1 text-amber-400">· por revisar</span>}
                      </p>
                    </div>
                    <span className="text-sm text-zinc-300 whitespace-nowrap">
                      {it.monto != null ? `$ ${Number(it.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {ticketData.confianza === 'baja' && (
              <p className="mt-3 text-xs text-amber-400">La IA tuvo baja confianza; el admin revisará este ticket.</p>
            )}
          </div>

          <div className="flex flex-col gap-3 mt-auto">
            <button
              onClick={handleConfirm}
              disabled={state === 'confirming'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-100 py-4 text-base font-semibold text-zinc-900 transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {state === 'confirming' ? (
                <>
                  <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Guardando...
                </>
              ) : (
                'Confirmar y guardar'
              )}
            </button>
            <button
              onClick={handleDiscard}
              disabled={state === 'confirming'}
              className="w-full rounded-2xl bg-zinc-800 py-4 text-base font-medium text-zinc-300 transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* ERROR state */}
      {state === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-900/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-base font-medium text-zinc-100">Ocurrió un error</p>
            <p className="mt-1 text-sm text-zinc-400">{errorMsg}</p>
          </div>
          <button
            onClick={handleDiscard}
            className="mt-4 w-full max-w-xs rounded-2xl bg-zinc-800 py-4 text-base font-medium text-zinc-100 active:scale-95 transition-transform"
          >
            Intentar de nuevo
          </button>
        </div>
      )}
    </main>
  )
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="min-w-[90px] text-sm text-zinc-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-zinc-100">
        {value ?? <span className="text-zinc-600 italic">No detectado</span>}
      </dd>
    </div>
  )
}
