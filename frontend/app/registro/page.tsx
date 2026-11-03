'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Alta de un negocio nuevo con una invitacion (enlace de un solo uso). La cuenta la crea la edge function crear-cuenta: sin correo de
// confirmacion, porque el enlace ya prueba que lo invitamos. Al terminar entra directo a configurar su negocio.

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

export default function RegistroPage() {
  const router = useRouter()
  const [codigo, setCodigo] = useState<string | null>(null)
  const [valida, setValida] = useState<boolean | null>(null)
  const [negocio, setNegocio] = useState('')
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [error, setError] = useState('')
  const [campo, setCampo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [yaTiene, setYaTiene] = useState(false)

  useEffect(() => {
    const inv = new URLSearchParams(window.location.search).get('inv')
    setCodigo(inv)
    if (!inv) { setValida(false); return }
    supabase.rpc('invitacion_valida', { p_codigo: inv }).then(({ data, error: e }) => setValida(e ? true : !!data))
  }, [])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true); setError(''); setCampo(''); setYaTiene(false)
    try {
      const res = await fetch(`${EDGE_FUNCTIONS_URL}/crear-cuenta`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, negocio, nombre, email, password }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; campo?: string; existe?: boolean; invitacion?: boolean }
      if (!res.ok || !d.ok) {
        if (d.invitacion) { setValida(false); return }
        setError(d.error ?? 'No se pudo crear tu cuenta. Intenta de nuevo.')
        setCampo(d.campo ?? '')
        setYaTiene(!!d.existe)
        return
      }
      const { error: errLogin } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (errLogin) { router.replace('/admin/login'); return }
      router.replace('/admin/entrenamiento')
    } catch {
      setError('No hay conexión. Revisa tu internet e intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (valida === null) {
    return <main className="flex min-h-[100dvh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></main>
  }

  if (!valida) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Este enlace ya no sirve</h1>
          <p className="text-[15px] leading-relaxed text-zinc-400">Ya se usó o ya venció. Pide otro a quien te invitó. Si ya creaste tu cuenta, solo entra.</p>
          <Link href="/admin/login" className="btn-secundario w-full py-3">Entrar con mi cuenta</Link>
        </div>
      </main>
    )
  }

  const claseCampo = (c: string) => `campo w-full px-4 py-3 ${campo === c ? 'border-red-500' : ''}`

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Crea tu cuenta</h1>
          <p className="nota mt-1">Toma un minuto. Después te guiamos paso a paso.</p>
        </div>
        <form onSubmit={crear} className="space-y-4">
          <label className="block space-y-1">
            <span className="etiqueta block">¿Cómo se llama tu negocio?</span>
            <input value={negocio} onChange={e => setNegocio(e.target.value)} className={claseCampo('negocio')} required maxLength={80} autoComplete="organization" placeholder="Ej. Taquería El Güero" />
          </label>
          <label className="block space-y-1">
            <span className="etiqueta block">Tu nombre</span>
            <input value={nombre} onChange={e => setNombre(e.target.value)} className={claseCampo('nombre')} required maxLength={80} autoComplete="name" />
          </label>
          <label className="block space-y-1">
            <span className="etiqueta block">Tu correo</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={claseCampo('email')} required autoComplete="email" inputMode="email" />
          </label>
          <label className="block space-y-1">
            <span className="etiqueta block">Inventa una contraseña</span>
            <span className="relative block">
              <input type={verPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className={`${claseCampo('password')} pr-16`} required minLength={8} autoComplete="new-password" />
              <button type="button" onClick={() => setVerPass(v => !v)} className="btn-quieto btn-sm absolute right-1 top-1/2 -translate-y-1/2">{verPass ? 'Ocultar' : 'Ver'}</button>
            </span>
            <span className="nota block">Mínimo 8 letras o números.</span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-900 px-3 py-2 text-sm text-red-300">
              {error} {yaTiene && <Link href="/admin/login" className="font-medium underline underline-offset-2">Entrar</Link>}
            </p>
          )}
          <button type="submit" disabled={enviando} className="btn-primario w-full py-3 text-base">{enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}</button>
        </form>
      </div>
    </main>
  )
}
