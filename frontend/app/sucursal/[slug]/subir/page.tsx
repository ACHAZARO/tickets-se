'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface PageProps {
  params: { slug: string }
}

type UploadState = 'idle' | 'preview' | 'processing' | 'done' | 'error'

// Formas de pago del negocio (las crea el admin en Sucursales). Se guardan en ticket_pagos; la IA que lee la foto no las ve.
interface FormaPago { id: string; nombre: string }
// Monto escrito por el gerente ("1,250.50" o "1250,50") -> numero, o null si no es valido.
function leerMonto(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(limpio)
  return limpio && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}
const pesos = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

// Ticket ya subido que parece la misma compra (lo encuentra revisar-antes-de-subir).
interface PosibleDuplicado {
  motivo: 'misma_foto' | 'mismo_gasto'
  comercio: string | null; fecha: string | null; monto: number | null; folio: string | null; es_factura: boolean
}
const fechaCorta = (f: string | null) => {
  if (!f) return ''
  const d = new Date(f + 'T12:00:00')
  return isNaN(d.getTime()) ? f : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

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
  const [descartadas, setDescartadas] = useState(0)
  // Revision previa de cada foto (empieza al elegirla, mientras el gerente escoge la forma de pago).
  // Guarda la foto ya comprimida para no comprimir dos veces.
  const revisiones = useRef(new Map<File, { imagen: Promise<Blob>; dup: Promise<PosibleDuplicado | null> }>())
  const [revisando, setRevisando] = useState(false)
  const [pregunta, setPregunta] = useState<{ dup: PosibleDuplicado; n: number; total: number } | null>(null)
  const responder = useRef<((subir: boolean) => void) | null>(null)
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState<string>('')
  // Nota opcional para quien revisa (solo humanos): el servidor la guarda aparte y NUNCA se la pasa a la IA.
  const [nota, setNota] = useState('')
  const notaRef = useRef<HTMLTextAreaElement>(null)
  // Formas de pago (obligatorio elegir al menos una): se eligen en cada envio, sin recordar las anteriores.
  // Una sola = todo el ticket. Varias = monto por cada una (pago mixto), solo con una foto a la vez.
  const [formas, setFormas] = useState<FormaPago[] | null>(null)
  const [formasError, setFormasError] = useState(false)
  const [elegidas, setElegidas] = useState<string[]>([])
  const [montos, setMontos] = useState<Record<string, string>>({})
  const esMixto = elegidas.length > 1
  const sumaMixto = esMixto ? elegidas.reduce((s, id) => s + (leerMonto(montos[id] ?? '') ?? 0), 0) : 0
  const faltaMonto = esMixto && elegidas.some(id => leerMonto(montos[id] ?? '') === null)
  // Sin formas configuradas (o si no cargaron) no se bloquea el envio: el ticket queda "no registrado".
  const pideForma = !!formas && formas.length > 0
  const puedeEnviar = (!pideForma || elegidas.length > 0) && !faltaMonto && !(esMixto && imageFiles.length > 1)
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

  // Si el negocio lo permite (Configuracion > Opciones), el gerente tambien puede contar el inventario.
  const [puedeContar, setPuedeContar] = useState(false)
  useEffect(() => {
    if (!sessionToken) return
    fetch(`${EDGE_FUNCTIONS_URL}/conteo-gerente?estado=1`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.ok ? r.json() : null).then(d => setPuedeContar(!!d?.habilitado)).catch(() => {})
  }, [sessionToken])

  // Articulos que el admin NO aprobo (no autorizados, migracion 094): si el negocio lo activo, el gerente los ve al
  // entrar y los da por vistos. La lista sale del servidor (solo los tickets que subio este gerente).
  const [avisos, setAvisos] = useState<{ id: string; articulo: string; monto: number | null; comercio: string | null; fecha: string | null }[]>([])
  useEffect(() => {
    if (!sessionToken) return
    fetch(`${EDGE_FUNCTIONS_URL}/avisos-gerente`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.ok ? r.json() : null).then(d => setAvisos(Array.isArray(d?.avisos) ? d.avisos : [])).catch(() => {})
  }, [sessionToken])
  async function avisosVistos() {
    const ids = avisos.map(a => a.id)
    setAvisos([])
    await fetch(`${EDGE_FUNCTIONS_URL}/avisos-gerente`, {
      method: 'POST', headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    }).catch(() => {})
  }

  // Formas de pago del negocio: las da procesar-ticket (GET) con el mismo token de la sesion.
  const cargarFormas = useCallback(async () => {
    if (!sessionToken) return
    setFormasError(false)
    try {
      const res = await fetch(`${EDGE_FUNCTIONS_URL}/procesar-ticket`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      if (res.status === 401) {
        sessionStorage.removeItem(`auth_${slug}`)
        router.replace(`/sucursal/${slug}`)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data.formas_pago)) throw new Error('sin formas')
      setFormas(data.formas_pago as FormaPago[])
    } catch {
      setFormasError(true)
    }
  }, [sessionToken, slug, router])
  useEffect(() => { cargarFormas() }, [cargarFormas])

  // Pregunta a revisar-antes-de-subir si cada foto ya se subio (misma foto, mismo folio o factura + ticket).
  // Nunca frena: si tarda o falla, cuenta como "sin duplicado".
  const revisarAntes = useCallback((files: File[]) => {
    revisiones.current = new Map()
    let cadena: Promise<unknown> = Promise.resolve()
    for (const file of files) {
      const imagen = Promise.race<Blob>([
        comprimirImagen(file),
        new Promise<Blob>(resolve => setTimeout(() => resolve(file), 8000)),
      ])
      const dup = (cadena = cadena.then(async () => {
        if (!sessionToken) return null
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 25000)
        try {
          const fd = new FormData()
          fd.append('imagen', await imagen, 'ticket.jpg')
          const res = await fetch(`${EDGE_FUNCTIONS_URL}/revisar-antes-de-subir`, {
            method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` }, body: fd, signal: ctrl.signal,
          })
          const data = await res.json().catch(() => ({}))
          return (res.ok && data?.duplicado ? data.duplicado : null) as PosibleDuplicado | null
        } catch {
          return null
        } finally {
          clearTimeout(t)
        }
      })) as Promise<PosibleDuplicado | null>
      revisiones.current.set(file, { imagen, dup })
    }
  }, [sessionToken])

  // Abre la pregunta "¿es la misma compra?" y espera la respuesta del gerente.
  const preguntarDuplicado = (dup: PosibleDuplicado, n: number, total: number) =>
    new Promise<boolean>(resolve => { responder.current = resolve; setPregunta({ dup, n, total }) })
  function contestar(subir: boolean) {
    setPregunta(null)
    responder.current?.(subir)
    responder.current = null
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setImageFiles(files)
    setImageFile(files[0])
    setErrorMsg('')
    revisarAntes(files)

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
  }, [revisarAntes])

  const handleProcess = useCallback(async () => {
    if (!imageFile || !puedeEnviar) return
    setState('processing')
    setErrorMsg('')

    const elegidos = imageFiles.length ? imageFiles : (imageFile ? [imageFile] : [])
    if (elegidos.length === 0) return
    // Si alguna foto parece ya subida, se pregunta antes de mandarla. La revision suele terminar mientras se
    // elige la forma de pago; si no, se espera aqui (cada una tiene su propio limite de tiempo).
    setRevisando(true)
    const dups = await Promise.all(elegidos.map(f => revisiones.current.get(f)?.dup ?? Promise.resolve(null)))
    setRevisando(false)
    const archivos: File[] = []
    let descartados = 0
    const repetidos = dups.filter(Boolean).length
    let n = 0
    for (let i = 0; i < elegidos.length; i++) {
      const dup = dups[i]
      if (dup && !(await preguntarDuplicado(dup, ++n, repetidos))) { descartados++; continue }
      archivos.push(elegidos[i])
    }
    setDescartadas(descartados)
    if (archivos.length === 0) {
      setEnviadas(0); setDuplicadas(0); setFallidas(0)
      setState('done')
      return
    }
    // Con varias fotos, la misma nota va en cada una.
    const notaEnvio = nota.trim()
    const pagosEnvio = elegidas.length
      ? JSON.stringify(elegidas.map(id => ({ forma_pago_id: id, monto: esMixto ? leerMonto(montos[id] ?? '') : null })))
      : ''

    // Envia UNA foto con reintentos. Devuelve el resultado para contarlo.
    async function enviarUna(file: File): Promise<'ok' | 'dup' | 'fail' | 'expired'> {
      // La compresion no puede colgar el envio: si tarda >8s, usa la original.
      const imagen = await (revisiones.current.get(file)?.imagen ?? Promise.race<Blob>([
        comprimirImagen(file),
        new Promise<Blob>(resolve => setTimeout(() => resolve(file), 8000)),
      ]))
      // Hasta 3 intentos por foto (la red movil falla intermitente).
      for (let intento = 1; intento <= 3; intento++) {
        const formData = new FormData()
        formData.append('imagen', imagen, 'ticket.jpg')
        if (notaEnvio) formData.append('nota', notaEnvio)
        if (pagosEnvio) formData.append('pagos', pagosEnvio)
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
  }, [imageFile, imageFiles, nota, elegidas, montos, esMixto, puedeEnviar, sessionToken, slug, router])

  const handleDiscard = useCallback(() => {
    setImageFile(null)
    setImageFiles([])
    setEnviadas(0)
    setDuplicadas(0)
    setFallidas(0)
    setDescartadas(0)
    revisiones.current = new Map()
    setProgreso({ actual: 0, total: 0 })
    setImagePreview(null)
    setNota('')
    setElegidas([])
    setMontos({})
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
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-900 mb-6">
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
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{enviadas > 0 ? '¡Enviado! Gracias' : 'Listo, no se envió'}</h2>
        <p className="mt-2 text-sm text-zinc-400">
          {enviadas > 0
            ? `${enviadas > 1 ? `${enviadas} tickets se están` : 'El ticket se está'} procesando. No necesitas hacer nada más.`
            : 'Descartaste el ticket porque ya estaba subido. No necesitas hacer nada más.'}
        </p>
        {enviadas > 0 && descartadas > 0 && (
          <p className="mt-3 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
            {descartadas === 1 ? '1 foto se descartó' : `${descartadas} fotos se descartaron`} porque ya estaba subida.
          </p>
        )}
        {(duplicadas > 0 || fallidas > 0) && (
          <p className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-sm text-amber-300">
            {duplicadas > 0 && `${duplicadas} ya estaba(n) subido(s). `}
            {fallidas > 0 && `${fallidas} no se pudo(eron) enviar; vuelve a intentarlas.`}
          </p>
        )}
        <button
          onClick={handleNewTicket}
          className="btn-primario mt-8 w-full max-w-xs py-3.5 text-base"
        >
          Subir otro ticket
        </button>
        <button
          onClick={() => router.push(`/sucursal/${slug}`)}
          className="btn-quieto mt-3 w-full max-w-xs py-3.5 text-base"
        >
          Salir
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen min-h-[100dvh] flex-col px-4 pb-8 pt-10 safe-top safe-bottom">
      {avisos.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-4 sm:items-center">
          <div role="alertdialog" aria-modal="true" aria-labelledby="aviso-titulo" className="w-full max-w-md space-y-4 rounded-2xl border border-red-800 bg-zinc-900 p-5 shadow-xl">
            <h2 id="aviso-titulo" className="text-lg font-semibold text-red-300">{avisos.length === 1 ? 'Un artículo no fue aprobado' : `${avisos.length} artículos no fueron aprobados`}</h2>
            <ul className="space-y-2">
              {avisos.map(a => (
                <li key={a.id} className="rounded-lg bg-red-900 px-3 py-2 text-sm text-zinc-100">
                  <b className="font-semibold">{a.articulo}</b>{a.monto != null ? ` · $${Number(a.monto).toLocaleString('es-MX', { maximumFractionDigits: 2 })}` : ''}
                  <span className="block text-xs text-red-300">Ticket de {a.comercio ?? 'comercio sin nombre'}{a.fecha ? ` del ${a.fecha}` : ''}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed text-zinc-300">
              {avisos.length === 1 ? 'Este artículo no está aprobado y no pertenece' : 'Estos artículos no están aprobados y no pertenecen'} a la operación.
              No se cuenta en el total de tus tickets y debes reponer ese dinero, o se tomará como hurto.
              Para autorizarlo, habla con el administrador.
            </p>
            <button onClick={avisosVistos} className="btn-primario w-full py-3">Entendido</button>
          </div>
        </div>
      )}
      {pregunta && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-4 sm:items-center">
          <div role="alertdialog" aria-modal="true" aria-labelledby="dup-titulo" aria-describedby="dup-texto" className="w-full max-w-md space-y-4 rounded-2xl border border-amber-700 bg-zinc-900 p-5 shadow-xl">
            <h2 id="dup-titulo" className="text-lg font-semibold text-amber-300">
              {pregunta.dup.motivo === 'misma_foto' ? 'Esta foto ya se subió' : '¿Es la misma compra?'}
              {pregunta.total > 1 ? <span className="ml-2 text-sm font-normal text-zinc-500">({pregunta.n} de {pregunta.total})</span> : null}
            </h2>
            <div id="dup-texto" className="space-y-3">
              <p className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100">
                Ya hay {pregunta.dup.es_factura ? 'una factura' : 'un ticket'} de <b className="font-semibold">{pregunta.dup.comercio ?? 'este comercio'}</b>
                {pregunta.dup.monto != null ? <> por <b className="font-semibold">{pesos(pregunta.dup.monto)}</b></> : null}
                {pregunta.dup.fecha ? ` del ${fechaCorta(pregunta.dup.fecha)}` : ''}
                {pregunta.dup.folio ? ` con folio ${pregunta.dup.folio}` : ''}.
              </p>
              <p className="text-sm leading-relaxed text-zinc-300">
                Si es la misma compra, mejor descarta este ticket. Si lo subes, lo revisará el administrador.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => contestar(false)} className="btn-primario w-full py-3">Descartar este ticket</button>
              <button onClick={() => contestar(true)} className="btn-quieto w-full py-3">Subir de todos modos</button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.push(`/sucursal/${slug}`)}
          className="btn-quieto h-11 w-11 px-0"
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
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Subir ticket</h1>
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
            className="flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900 px-6 py-14 text-center transition-[border-color,transform] duration-150 ease-out hover:border-emerald-500 active:scale-[0.98]"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-emerald-900">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8 text-emerald-400"
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
              <p className="text-lg font-semibold text-zinc-100">Tomar foto</p>
              <p className="nota mt-1">o elegir de la galería</p>
            </div>
          </button>
          {puedeContar && (
            <button onClick={() => router.push(`/sucursal/${slug}/conteo`)} className="btn-secundario w-full py-3.5 text-base">
              Contar inventario
            </button>
          )}
        </div>
      )}

      {/* PREVIEW: image selected, not yet processed */}
      {(state === 'preview' || state === 'processing') && imagePreview && (
        <div className="flex flex-1 flex-col gap-4">
          {/* Image preview */}
          <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900" style={{ aspectRatio: '3/4', maxHeight: '36vh' }}>
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
                  className="h-10 w-10 animate-spin text-emerald-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <p className="text-sm font-medium text-zinc-100">
                  {revisando || pregunta ? 'Revisando si ya se subió...'
                    : progreso.total > 1 ? `Enviando ${progreso.actual} de ${progreso.total}...` : 'Enviando...'}
                </p>
              </div>
            )}
          </div>

          {state === 'preview' && (
            <div className="flex flex-col gap-3">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-zinc-200">
                  ¿Cómo se pagó? <span className="font-normal text-zinc-500">{esMixto ? '(escribe cuánto con cada una)' : '(puedes elegir varias)'}</span>
                </legend>
                {formas === null && !formasError && <p className="nota">Cargando formas de pago…</p>}
                {formasError && (
                  <button type="button" onClick={cargarFormas} className="min-h-[44px] text-left text-sm text-amber-400 underline">
                    No cargaron las formas de pago. Toca para reintentar
                  </button>
                )}
                <div className="flex flex-col gap-2">
                  {(formas ?? []).map(f => {
                    const activo = elegidas.includes(f.id)
                    return (
                      <div key={f.id} className="flex items-stretch gap-2">
                        <button
                          type="button"
                          aria-pressed={activo}
                          onClick={() => setElegidas(prev => (prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]))}
                          className={`min-h-[48px] flex-1 rounded-lg border px-4 py-2.5 text-left text-base font-medium transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] ${
                            activo ? 'border-emerald-500 bg-emerald-900 text-emerald-300' : 'border-zinc-800 bg-zinc-900 text-zinc-200'
                          }`}
                        >
                          {f.nombre}
                        </button>
                        {activo && esMixto && (
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Monto pagado con ${f.nombre}`}
                            placeholder="$ monto"
                            value={montos[f.id] ?? ''}
                            onChange={e => setMontos(prev => ({ ...prev, [f.id]: e.target.value }))}
                            className="campo w-32 text-right text-base"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                {esMixto && !faltaMonto && (
                  <p className="mt-1.5 text-right text-[13px] text-zinc-400">Suma: <span className="font-medium text-zinc-200">{pesos(sumaMixto)}</span> (debe ser el total del ticket)</p>
                )}
                {esMixto && imageFiles.length > 1 && (
                  <p className="mt-1.5 text-[13px] text-amber-400">Pago con varias formas: sube una foto a la vez.</p>
                )}
                {!esMixto && imageFiles.length > 1 && elegidas.length === 1 && (
                  <p className="nota mt-1">Se aplica a las {imageFiles.length} fotos.</p>
                )}
              </fieldset>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <label htmlFor="nota" className="text-sm font-medium text-zinc-200">
                    Nota <span className="font-normal text-zinc-500">(opcional)</span>
                  </label>
                  {nota.length > 0 && <span className="text-xs text-zinc-500">{nota.length}/500</span>}
                </div>
                <textarea
                  ref={notaRef}
                  id="nota"
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Solo si hace falta explicar algo"
                  className="campo w-full resize-none py-3 text-base"
                />
                <p className="nota mt-1">
                  La lee la persona que revisa, no la IA.{imageFiles.length > 1 ? ` Se guarda en las ${imageFiles.length} fotos.` : ''}
                </p>
              </div>
              <button
                onClick={handleProcess}
                disabled={!puedeEnviar}
                className="btn-primario w-full whitespace-normal py-3.5 text-base font-semibold disabled:bg-zinc-800 disabled:text-zinc-500 disabled:opacity-100"
              >
                {pideForma && elegidas.length === 0
                  ? 'Elige cómo se pagó'
                  : faltaMonto
                    ? 'Escribe el monto de cada forma'
                    : esMixto && imageFiles.length > 1
                      ? 'Sube una foto a la vez'
                      : imageFiles.length > 1 ? `Enviar ${imageFiles.length} fotos` : 'Enviar ticket'}
              </button>
              <button
                onClick={handleDiscard}
                className="btn-quieto w-full py-3 text-base"
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-900">
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
            className="btn-primario mt-4 w-full max-w-xs py-3.5 text-base"
          >
            Intentar de nuevo
          </button>
        </div>
      )}
    </main>
  )
}
