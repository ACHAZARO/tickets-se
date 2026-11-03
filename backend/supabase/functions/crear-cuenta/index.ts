import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Alta de un negocio nuevo con una invitacion (enlace de un solo uso que genera el super admin). Sin correo de confirmacion:
// el enlace ya prueba que lo invitamos. La cuenta se crea en una sola transaccion (alta_cuenta); si falla, se borra el usuario.

const intentos = new Map<string, { n: number; desde: number }>()
function demasiados(clave: string): boolean {
  const ahora = Date.now()
  const e = intentos.get(clave)
  if (!e || ahora - e.desde > 3_600_000) { intentos.set(clave, { n: 1, desde: ahora }); return false }
  e.n++
  return e.n > 20
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sin-ip'
    if (demasiados(ip)) return json({ error: 'Demasiados intentos. Espera un rato e intenta de nuevo.' }, 429)

    const { codigo, negocio, nombre, email, password } = await req.json().catch(() => ({})) as Record<string, string | undefined>
    const correo = (email ?? '').trim().toLowerCase()
    const nombreNegocio = (negocio ?? '').trim().slice(0, 80)
    const nombrePersona = (nombre ?? '').trim().slice(0, 80)
    if (!codigo) return json({ error: 'Falta la invitación.' }, 400)
    if (nombreNegocio.length < 2) return json({ error: 'Escribe el nombre de tu negocio.', campo: 'negocio' }, 400)
    if (nombrePersona.length < 2) return json({ error: 'Escribe tu nombre.', campo: 'nombre' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return json({ error: 'Ese correo no parece correcto.', campo: 'email' }, 400)
    if ((password ?? '').length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.', campo: 'password' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const invalida = { error: 'Este enlace ya se usó o ya venció. Pide otro a quien te invitó.', invitacion: true }
    const { data: valida } = await supabase.rpc('invitacion_valida', { p_codigo: codigo })
    if (!valida) return json(invalida, 410)

    const { data: creado, error: errUser } = await supabase.auth.admin.createUser({
      email: correo, password, email_confirm: true, user_metadata: { nombre: nombrePersona },
    })
    if (errUser || !creado?.user) {
      if (/already|registered|exists/i.test(errUser?.message ?? '')) {
        return json({ error: 'Ese correo ya tiene cuenta. Entra con tu contraseña.', campo: 'email', existe: true }, 409)
      }
      console.error('crear-cuenta createUser:', errUser?.message)
      return json({ error: 'No se pudo crear tu cuenta. Intenta de nuevo.' }, 500)
    }

    const { error: errAlta } = await supabase.rpc('alta_cuenta', { p_codigo: codigo, p_user: creado.user.id, p_negocio: nombreNegocio })
    if (errAlta) {
      await supabase.auth.admin.deleteUser(creado.user.id)
      if (errAlta.message.includes('invitacion_invalida')) return json(invalida, 410)
      console.error('crear-cuenta alta:', errAlta.message)
      return json({ error: 'No se pudo crear tu cuenta. Intenta de nuevo.' }, 500)
    }
    return json({ ok: true })
  } catch (err) {
    console.error('Error crear-cuenta:', err)
    return json({ error: 'Error interno' }, 500)
  }
})
