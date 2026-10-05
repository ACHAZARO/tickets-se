// avisos-gerente: renglones NO APROBADOS (articulos no autorizados, migracion 094) que el gerente debe ver en su
// siguiente sesion. Solo si el negocio lo activo en Opciones (cuenta_opciones.avisar_gerente_no_autorizado).
//   GET  -> { avisos: [{ id, articulo, monto, comercio, fecha }] }   los aun no vistos de tickets que ESE gerente subio
//   POST -> { ids: [...] }                                           los marca como vistos
// Seguridad: token de sesion del PIN; sucursal y empleado salen del token, nunca del cliente.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

async function verifySessionToken(token: string, jwtSecret: string): Promise<{ sub: string; slug: string } | null> {
  try {
    const keyData = new TextEncoder().encode(jwtSecret)
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    return await verify(token, cryptoKey) as { sub: string; slug: string }
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const auth = req.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return json({ error: 'Token de sesion requerido' }, 401)
    const session = await verifySessionToken(auth.slice(7), Deno.env.get('JWT_SECRET')!)
    if (!session?.sub) return json({ error: 'Token de sesion invalido o expirado' }, 401)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: suc } = await supabase.from('sucursales').select('id, cuenta_id').eq('slug', session.slug).eq('activa', true).maybeSingle()
    if (!suc) return json({ error: 'Sucursal no encontrada o inactiva' }, 404)
    const { data: ops } = await supabase.from('cuenta_opciones').select('avisar_gerente_no_autorizado').eq('cuenta_id', suc.cuenta_id).maybeSingle()
    if (!ops?.avisar_gerente_no_autorizado) return json({ avisos: [] })

    if (req.method === 'POST') {
      const { ids } = await req.json().catch(() => ({})) as { ids?: unknown }
      const uuid = /^[0-9a-f-]{36}$/i
      const lista = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && uuid.test(x)).slice(0, 200) : []
      if (!lista.length) return json({ ok: true, vistos: 0 })
      // Solo los renglones de tickets que subio ESTE gerente en ESTA sucursal.
      const { data: mios } = await supabase.from('ticket_items').select('id, registros_tickets!inner(sucursal_id, empleado_id)')
        .in('id', lista).eq('autorizacion', 'rechazado')
        .eq('registros_tickets.sucursal_id', suc.id).eq('registros_tickets.empleado_id', session.sub)
      const propios = ((mios ?? []) as { id: string }[]).map(r => r.id)
      if (propios.length) await supabase.from('ticket_items').update({ aviso_gerente_visto: new Date().toISOString() }).in('id', propios)
      return json({ ok: true, vistos: propios.length })
    }

    const { data, error } = await supabase.from('ticket_items')
      .select('id, descripcion, monto, catalogo_productos:producto_catalogo_id(nombre), registros_tickets!inner(comercio, fecha_ticket, sucursal_id, empleado_id, estado)')
      .eq('autorizacion', 'rechazado').is('aviso_gerente_visto', null)
      .eq('registros_tickets.sucursal_id', suc.id).eq('registros_tickets.empleado_id', session.sub)
      .neq('registros_tickets.estado', 'rechazado')
      .limit(50)
    if (error) return json({ error: 'No se pudieron leer los avisos' }, 500)
    type F = { id: string; descripcion: string | null; monto: number | null; catalogo_productos: { nombre: string } | null; registros_tickets: { comercio: string | null; fecha_ticket: string | null } }
    return json({
      avisos: ((data ?? []) as unknown as F[]).map(r => ({
        id: r.id, articulo: r.catalogo_productos?.nombre ?? r.descripcion ?? 'Artículo', monto: r.monto,
        comercio: r.registros_tickets.comercio, fecha: r.registros_tickets.fecha_ticket,
      })),
    })
  } catch (e) {
    console.error('avisos-gerente', e)
    return json({ error: 'Error interno' }, 500)
  }
})
