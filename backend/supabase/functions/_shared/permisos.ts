// Quien puede operar un ticket desde el panel (migracion 101): el super admin de la plataforma (admin_users) o el dueno
// de la cuenta de esa sucursal (cuenta_usuarios). El verify_jwt del gateway NO basta: la anon key publica tambien pasa.
// Llamadas internas de la plataforma: Authorization con la service role key (nunca sale del servidor).
// deno-lint-ignore no-explicit-any
type SB = any

export type Llamante =
  | { interno: true; id: null; email: null }
  | { interno: false; id: string; email: string | null }

// La llave de servicio puede venir en otro formato que la del entorno: se comprueba contra Auth (solo ella pasa ahi).
async function esLlaveDeServicio(token: string): Promise<boolean> {
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true
  let rol: unknown = null
  try {
    rol = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role
  } catch { return false }
  if (rol !== 'service_role') return false
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users?per_page=1`, {
    headers: { apikey: token, Authorization: `Bearer ${token}` },
  }).catch(() => null)
  return !!r?.ok
}

export async function llamanteDe(supabase: SB, req: Request): Promise<Llamante | null> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return null
  if (await esLlaveDeServicio(token)) return { interno: true, id: null, email: null }
  const { data: { user } } = await supabase.auth.getUser(token)
  return user ? { interno: false, id: user.id, email: user.email ?? null } : null
}

// Puede ese llamante ver y operar esa sucursal. Si la consulta falla, NO.
export async function puedeSucursal(supabase: SB, quien: Llamante, sucursalId: string | null | undefined): Promise<boolean> {
  if (quien.interno) return true
  if (!sucursalId) return false
  const { data, error } = await supabase.rpc('usuario_puede_sucursal', { p_user: quien.id, p_sucursal: sucursalId })
  if (error) {
    console.error('usuario_puede_sucursal:', error.message)
    return false
  }
  return data === true
}
