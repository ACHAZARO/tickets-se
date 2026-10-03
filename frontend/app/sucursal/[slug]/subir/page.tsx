'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface PageProps {
  params: { slug: string }
}

type UploadState = 'idle' | 'preview' | 'processing' | 'done' | 'error'

// Como se pago el ticket. Se guarda tal cual (registros_tickets.forma_pago); la IA que lee la foto no la ve.
type FormaPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'mixto'
const FORMAS_PAGO: { valor: FormaPago; texto: string }[] = [
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'tarjeta', texto: 'Tarjeta' },
  { valor: 'transferencia', texto: 'Transferencia directa' },
  { valor: 'mixto', texto: 'Mixto' },
]

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

// Reduce la foto antes de subir sin destruir texto chico del ticket. Mantener
// mas resolucion que antes es clave para OCR; el timeout evita que se cuelgue.
async function comprimirImagen(file: File, maxLado = 2400, calidad = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', calidad))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

export default function SubirPage({ params }: PageProps) {
  const { slug } = params
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<UploadState>('idle')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [enviadas, setEnviadas] = useState(0)
  const [duplicadas, setDuplicadas] = useState(0)
  const [fallidas, setFallidas] = useState(0)
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState<string>('')
  // Nota opcional para quien revisa (solo humanos): el servidor la guarda aparte y NUNCA se la pasa a la IA.
  const [nota, setNota] = useState('')
  const notaRef = useRef<HTMLTextAreaElement>(null)
  // Forma de pago (obligatoria): se elige en cada envio, sin recordar la anterior, para que sea una decision consciente.
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null)
  const notaObligatoria = formaPago === 'mixto'
  const puedeEnviar = formaPago !== null && (!notaObligatoria || nota.trim().length > 0)
  const [empleadoId, setEmpleadoId] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

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
      // Sin token de sesion valido -> de vuelta al PIN (no se confia en una sesion incompleta)
      if (!parsed.sessionToken || !parsed.empleadoId) {
        sessionStorage.removeItem(`auth_${slug}`)
        router.replace(`/sucursal/${slug}`)
        return
      }
      setEmpleadoId(parsed.empleadoId)
      setSessionToken(parsed.sessionToken)
    } catch {
      router.replace(`/sucursal/${slug}`)
    }
  }, [slug, router])

  // El cuadro de la nota crece con el texto (hasta ~5 renglones) para que no se vea cortado.
  useEffect(() => {
    const t = notaRef.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight + 2, 140)}px`
  }, [nota, state])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setImageFiles(files)
    setImageFile(files[0])
    setErrorMsg('')

    const reader = new FileReader()
    // onload SOLO en exito. onloadend tambien dispara al fallar/abortar con
    // result=null, lo que dejaba la pantalla en blanco sin botones.
    reader.onload = () => {
      if (!reader.result) {
        setErrorMsg('No se pudo leer la foto. Intenta de nuevo o elige otra.')
        setState('error')
        return
      }
      setImagePreview(reader.result as string)
      setState('preview')
    }
    reader.onerror = () => {
      setImageFile(null)
      setImageFiles([])
      setErrorMsg('No se pudo leer la foto. Intenta de nuevo o elige otra.')
      setState('error')
    }
    reader.readAsDataURL(files[0])
  }, [])

  const handleProcess = useCallback(async () => {
    if (!imageFile || !puedeEnviar || !formaPago) return
    setState('processing')
    setErrorMsg('')

    const archivos = imageFiles.length ? imageFiles : (imageFile ? [imageFile] : [])
    if (archivos.length === 0) return
    // Con varias fotos, la misma nota va en cada una.
    const notaEnvio = nota.trim()
    const pagoEnvio: FormaPago = formaPago

    // Envia UNA foto con reintentos. Devuelve el resultado para contarlo.
    async function enviarUna(file: File): Promise<'ok' | 'dup' | 'fail' | 'expired'> {
      // La compresion no puede colgar el envio: si tarda >8s, usa la original.
      const imagen = await Promise.race<Blob>([
        comprimirImagen(file),
        new Promise<Blob>(resolve => setTimeout(() => resolve(file), 8000)),
      ])
      // Hasta 3 intentos por foto (la red movil falla intermitente).
      for (let intento = 1; intento <= 3; intento++) {
        const formData = new FormData()
        formData.append('imagen', imagen, 'ticket.jpg')
        if (notaEnvio) formData.append('nota', notaEnvio)
        formData.append('forma_pago', pagoEnvio)
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 60000)
        try {
          const res = await fetch(`${EDGE_FUNCTIONS_URL}/procesar-ticket`, {
            method: 'POST',
            headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
            body: formData,
            signal: ctrl.signal,
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.recibido) return 'ok'
          if (data.duplicado) return 'dup'
          // Sesion expirada/invalida: hay que re-ingresar el PIN.
          if (res.status === 401) return 'expired'
          // error del servidor: no tiene caso reintentar el mismo contenido
          return 'fail'
        } catch {
          // fallo de red/timeout: reintenta tras una pausa corta
          if (intento < 3) await new Promise(r => setTimeout(r, 1500 * intento))
        } finally {
          clearTimeout(t)
        }
      }
      return 'fail'
    }

    let ok = 0
    let duplicados = 0
    let fallidos = 0
    let expirada = false
    // Cada foto es independiente y secuencial: si una falla, NO se cancelan las demas.
    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ actual: i + 1, total: archivos.length })
      const r = await enviarUna(archivos[i])
      if (r === 'ok') ok++
      else if (r === 'dup') duplicados++
      else if (r === 'expired') { expirada = true; break }
      else fallidos++
    }
    if (expirada) {
      setProgreso({ actual: 0, total: 0 })
      setErrorMsg('Tu sesión expiró. Vuelve a ingresar tu PIN.')
      setState('error')
      sessionStorage.removeItem(`auth_${slug}`)
      setTimeout(() => router.replace(`/sucursal/${slug}`), 2200)
      return
    }
    setProgreso({ actual: 0, total: 0 })
    // El procesamiento con IA corre en segundo plano; el gerente solo confirma envio.
    setEnviadas(ok)
    setDuplicadas(duplicados)
    setFallidas(fallidos)
    if (ok === 0) {
      setErrorMsg(
        duplicados > 0 && fallidos === 0
          ? 'Ese ticket ya fue enviado antes.'
          : 'No se pudo enviar. Revisa tu internet e inténtalo de nuevo.'
      )
      setState('error')
    } else {
      setState('done')
    }
  }, [imageFile, imageFiles, nota, formaPago, puedeEnviar, sessionToken, slug, router])

  const handleDiscard = useCallback(() => {
    setImageFile(null)
    setImageFiles([])
    setEnviadas(0)
    setDuplicadas(0)
    setFallidas(0)
    setProgreso({ actual: 0, total: 0 })
    setImagePreview(null)
    setNota('')
    setFormaPago(null)
    setErrorMsg('')
    setState('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleNewTicket = useCallback(() => {
    handleDiscard()
    // Restore session for another ticket
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
        <h2 className="text-xl font-semibold text-zinc-100">¡Enviado! Muchas gracias</h2>
        <p className="mt-2 text-sm text-zinc-400">
          {enviadas > 1 ? `${enviadas} tickets se están` : 'El ticket se está'} procesando automáticamente. No necesitas hacer nada más.
        </p>
        {(duplicadas > 0 || fallidas > 0) && (
          <p className="mt-2 text-xs text-amber-400">
            {duplicadas > 0 && `${duplicadas} ya estaba(n) subido(s). `}
            {fallidas > 0 && `${fallidas} no se pudo(eron) enviar; vuelve a intentarlas.`}
          </p>
        )}
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
        multiple
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
          <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900" style={{ aspectRatio: '3/4', maxHeight: '36vh' }}>
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
                <p className="text-sm font-medium text-zinc-300">
                  {progreso.total > 1 ? `Enviando ${progreso.actual} de ${progreso.total}...` : 'Enviando...'}
                </p>
              </div>
            )}
          </div>

          {state === 'preview' && (
            <div className="flex flex-col gap-3">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-zinc-300">¿Cómo se pagó?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {FORMAS_PAGO.map(op => {
                    const activo = formaPago === op.valor
                    return (
                      <button
                        key={op.valor}
                        type="button"
                        aria-pressed={activo}
                        onClick={() => setFormaPago(op.valor)}
                        className={`min-h-[48px] rounded-2xl border px-3 py-2.5 text-sm font-medium transition-colors active:scale-[0.98] ${
                          activo
                            ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                        }`}
                      >
                        {op.texto}
                      </button>
                    )
                  })}
                </div>
                {imageFiles.length > 1 && formaPago && (
                  <p className="mt-1 text-xs text-zinc-500">Se aplica a las {imageFiles.length} fotos.</p>
                )}
              </fieldset>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <label htmlFor="nota" className="text-sm font-medium text-zinc-300">
                    Nota{' '}
                    <span className={notaObligatoria ? 'font-normal text-amber-400' : 'font-normal text-zinc-500'}>
                      {notaObligatoria ? '(obligatoria con pago mixto)' : '(opcional)'}
                    </span>
                  </label>
                  {nota.length > 0 && <span className="text-xs text-zinc-600">{nota.length}/500</span>}
                </div>
                <textarea
                  ref={notaRef}
                  id="nota"
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder={notaObligatoria
                    ? 'Qué parte se pagó con qué. Ej. envío $60 en efectivo, bolsas con transferencia'
                    : 'Solo si hace falta explicar algo'}
                  className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  La lee la persona que revisa, no la IA.{imageFiles.length > 1 ? ` Se guarda en las ${imageFiles.length} fotos.` : ''}
                </p>
              </div>
              <button
                onClick={handleProcess}
                disabled={!puedeEnviar}
                className="w-full rounded-2xl bg-zinc-100 py-4 text-base font-semibold text-zinc-900 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:active:scale-100"
              >
                {!formaPago
                  ? 'Elige cómo se pagó'
                  : notaObligatoria && !nota.trim()
                    ? 'Escribe la nota del pago mixto'
                    : imageFiles.length > 1 ? `Enviar ${imageFiles.length} fotos` : 'Enviar ticket'}
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
