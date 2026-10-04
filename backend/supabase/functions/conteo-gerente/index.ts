// conteo-gerente: el gerente captura el conteo fisico de inventario desde su celular (migracion 088).
//   GET  -> { habilitado, fecha, articulos: [{ clave, nombre, unidad, unidades, ultimo }] }
//   POST -> { renglones: [{ clave, cantidad, unidad }] }  guarda el conteo de HOY (hora de Mexico)
// Seguridad: token de sesion del PIN (mismo que procesar-ticket); la sucursal sale del token, nunca del cliente;
// solo si el negocio tiene cuenta_opciones.usa_stock y gerente_conteo encendidos.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

// Fecha de hoy en Mexico (igual que _shared/gemini.ts; copiada para no cargar ese modulo aqui).
const fechaMexico = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function verifySessionToken(token: string, jwtSecret: string): Promise<{ sub: string; slug: string } | null> {
  try {
    const keyData = new TextEncoder().encode(jwtSecret)
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    return await verify(token, cryptoKey) as { sub: string; slug: string }
  } catch {
    return null
  }
}

// Misma idea que el frontend: se compara en la unidad mas granular (kg -> g, lt -> ml).
const CANON: Record<string, string> = { kg: 'g', kgs: 'g', kilo: 'g', kilos: 'g', g: 'g', gr: 'g', grs: 'g', lt: 'ml', l: 'ml', lts: 'ml', litro: 'ml', litros: 'ml', ml: 'ml' }
const canon = (u: string | null | undefined) => { const k = (u ?? '').trim().toLowerCase(); return k ? (CANON[k] ?? k) : null }
const compatibles = (u: string) => u === 'g' ? ['g', 'kg'] : u === 'ml' ? ['ml', 'lt'] : [u]

type Prod = {
  id: string; nombre: string; unidad_default: string | null; contiene_unidad: string | null; contiene_sub_unidad: string | null
  insumos: { id: string; nombre: string; unidad_base: string } | null
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
    if (!session) return json({ error: 'Token de sesion invalido o expirado' }, 401)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: suc } = await supabase.from('sucursales').select('id, cuenta_id').eq('slug', session.slug).eq('activa', true).maybeSingle()
    if (!suc) return json({ error: 'Sucursal no encontrada o inactiva' }, 404)
    const { data: ops } = await supabase.from('cuenta_opciones').select('usa_stock, gerente_conteo').eq('cuenta_id', suc.cuenta_id).maybeSingle()
    if (!ops?.usa_stock || !ops?.gerente_conteo) return json({ habilitado: false })

    // Articulos que se han comprado en ESTA sucursal (confirmados y ligados al catalogo), de 1000 en 1000.
    const prods = new Map<string, Prod>()
    for (let desde = 0; desde < 50000; desde += 1000) {
      const { data, error } = await supabase.from('ticket_items')
        .select('id, catalogo_productos:producto_catalogo_id(id, nombre, unidad_default, contiene_unidad, contiene_sub_unidad, insumos:insumo_id(id, nombre, unidad_base)), registros_tickets!inner(estado, sucursal_id)')
        .eq('registros_tickets.estado', 'confirmado').eq('registros_tickets.sucursal_id', suc.id)
        .not('producto_catalogo_id', 'is', null).order('id').range(desde, desde + 999)
      if (error) return json({ error: 'No se pudo leer la lista' }, 500)
      for (const r of (data as unknown as { catalogo_productos: Prod | null }[]) ?? []) if (r.catalogo_productos) prods.set(r.catalogo_productos.id, r.catalogo_productos)
      if (!data || data.length < 1000) break
    }
    const articulos = new Map<string, { clave: string; nombre: string; unidad: string; producto_id: string | null; insumo_id: string | null }>()
    for (const p of prods.values()) {
      const ins = p.insumos
      const clave = ins ? 'i:' + ins.id : 'p:' + p.id
      if (articulos.has(clave)) continue
      const unidad = ins ? (canon(ins.unidad_base) ?? 'pz') : (canon(p.contiene_sub_unidad) ?? canon(p.contiene_unidad) ?? canon(p.unidad_default) ?? 'pz')
      if (/^servicios?$/.test(unidad)) continue // envios, mantenimiento: no van al inventario
      articulos.set(clave, { clave, nombre: ins?.nombre?.trim() || p.nombre, unidad, producto_id: ins ? null : p.id, insumo_id: ins?.id ?? null })
    }

    const hoy = fechaMexico()
    if (req.method === 'GET') {
      const { data: prev } = await supabase.from('conteos_inventario').select('clave, fecha, cantidad, unidad')
        .eq('sucursal_id', suc.id).order('fecha', { ascending: false }).limit(1000)
      const ultimo = new Map<string, { fecha: string; cantidad: number; unidad: string | null }>()
      for (const c of prev ?? []) if (!ultimo.has(c.clave)) ultimo.set(c.clave, { fecha: c.fecha, cantidad: Number(c.cantidad), unidad: c.unidad })
      const lista = [...articulos.values()]
        .map(a => ({ clave: a.clave, nombre: a.nombre, unidad: a.unidad, unidades: compatibles(a.unidad), ultimo: ultimo.get(a.clave) ?? null }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))
      return json({ habilitado: true, fecha: hoy, articulos: lista })
    }

    // POST: guardar el conteo de hoy
    const body = await req.json().catch(() => null) as { renglones?: { clave: string; cantidad: number; unidad: string }[] } | null
    const renglones = Array.isArray(body?.renglones) ? body!.renglones.slice(0, 1000) : []
    if (renglones.length === 0) return json({ error: 'Escribe al menos una cantidad' }, 400)
    const { data: emp } = await supabase.from('empleados').select('nombre').eq('id', session.sub).maybeSingle()
    const filas = []
    for (const r of renglones) {
      const a = articulos.get(String(r.clave))
      const q = Number(r.cantidad)
      const u = String(r.unidad ?? '').trim().toLowerCase()
      if (!a) return json({ error: 'Artículo que no es de esta sucursal' }, 400)
      if (!Number.isFinite(q) || q < 0 || q > 1e9) return json({ error: `Cantidad inválida en «${a.nombre}»` }, 400)
      if (!compatibles(a.unidad).includes(u)) return json({ error: `Unidad inválida en «${a.nombre}»` }, 400)
      filas.push({
        sucursal_id: suc.id, fecha: hoy, clave: a.clave, nombre: a.nombre, producto_catalogo_id: a.producto_id, insumo_id: a.insumo_id,
        cantidad: q, unidad: u, contado_por: (emp?.nombre as string | undefined) ?? 'gerente', empleado_id: session.sub,
        updated_at: new Date().toISOString(),
      })
    }
    const { error } = await supabase.from('conteos_inventario').upsert(filas, { onConflict: 'sucursal_id,fecha,clave' })
    if (error) return json({ error: 'No se pudo guardar el conteo' }, 500)
    return json({ ok: true, guardados: filas.length, fecha: hoy })
  } catch (e) {
    console.error('conteo-gerente', e)
    return json({ error: 'Error interno' }, 500)
  }
})
