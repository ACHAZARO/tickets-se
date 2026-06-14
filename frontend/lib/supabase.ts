import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// Garantiza un token de sesion VALIDO antes de operaciones criticas (confirmar
// ticket, ensenar producto al catalogo). El admin suele dejar la pestana abierta
// horas; el token vive 1h y el auto-refresh de supabase-js se throttlea cuando la
// pestana esta en segundo plano. Si el token esta vencido o por vencer (<2 min),
// lo refrescamos para que la siguiente escritura NO falle con 401 (Edge Functions)
// ni con bloqueo RLS silencioso (PostgREST / insert al catalogo).
// Devuelve la sesion vigente, o null si ya no hay sesion (el layout redirige a login).
export async function ensureFreshSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs - Date.now() < 120_000) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error) return session
    return data.session ?? session
  }
  return session
}
