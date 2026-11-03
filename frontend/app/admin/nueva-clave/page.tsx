'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Poner otra contrasena: se llega desde el enlace del correo de "Olvide mi contrasena". Supabase abre la sesion con ese enlace.
export default function NuevaClavePage() {
  const router = useRouter()
  const [listo, setListo] = useState<boolean | null>(null)
  const [clave, setClave] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setListo(!!data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { if (s) setListo(true) })
    return () => subscription.unsubscribe()
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (clave.length < 8) { setError('Mínimo 8 letras o números.'); return }
    setGuardando(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: clave })
    setGuardando(false)
    if (err) { setError('No se pudo guardar. Pide otro correo e intenta de nuevo.'); return }
    router.replace('/admin/tickets')
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-xl font-semibold tracking-tight text-zinc-100">Pon otra contraseña</h1>
        {listo === false ? (
          <p className="text-center text-[15px] leading-relaxed text-zinc-400">Este enlace ya no sirve. Vuelve a pedirlo en la pantalla de entrar.</p>
        ) : (
          <form onSubmit={guardar} className="space-y-4">
            <span className="relative block">
              <input type={ver ? 'text' : 'password'} value={clave} onChange={e => setClave(e.target.value)} minLength={8} required autoComplete="new-password" placeholder="Nueva contraseña" aria-label="Nueva contraseña" className="campo w-full px-4 py-3 pr-16" />
              <button type="button" onClick={() => setVer(v => !v)} className="btn-quieto btn-sm absolute right-1 top-1/2 -translate-y-1/2">{ver ? 'Ocultar' : 'Ver'}</button>
            </span>
            {error && <p role="alert" className="text-center text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={guardando || !listo} className="btn-primario w-full py-3 text-base">{guardando ? 'Guardando…' : 'Guardar y entrar'}</button>
          </form>
        )}
      </div>
    </main>
  )
}
