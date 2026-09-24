// API de SOLO LECTURA para el programa que revisa cuentas.
//   GET /api-cuentas/resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sucursal=slug]
//   GET /api-cuentas/desglose?categoria=Bodega&desde=..&hasta=..[&sucursal=slug][&detalle=1]
//   GET /api-cuentas/tickets?desde=..&hasta=..[&sucursal=slug][&estado=confirmado][&formato=csv]
//   GET /api-cuentas/sucursales
// Auth: llave en `Authorization: Bearer tk_...` o `x-api-key: tk_...` (solo se guarda su SHA-256 en api_keys).
// Cada llave pertenece a UNA cuenta (api_keys.cuenta_id) y solo ve las sucursales de esa cuenta.
// Sin CORS a proposito: es para servidores, no para navegadores.
// DESPLEGAR SIEMPRE con verify_jwt=false (--no-verify-jwt): la llave tk_ no es un JWT y el gateway la rechazaria.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
// Ida y vuelta: Date.parse acepta 2026-02-31 y lo rueda a marzo; Postgres no.
const fechaValida = (s: string) => {
  if (!FECHA_RE.test(s)) return false
  const ms = Date.parse(s + 'T00:00:00Z')
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s
}
const MAX_DIAS = 400

// Hoy y primer dia del mes en hora de Mexico (UTC-6, sin horario de verano desde 2022).
function hoyMx(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10)
}

// Periodo pedido (?desde&hasta) ya validado; si algo esta mal regresa la respuesta de error.
function leerPeriodo(url: URL): { desde: string; hasta: string } | Response {
  const hoy = hoyMx()
  const desde = url.searchParams.get('desde') ?? hoy.slice(0, 8) + '01'
  const hasta = url.searchParams.get('hasta') ?? hoy
  if (!fechaValida(desde) || !fechaValida(hasta)) return json({ error: 'desde/hasta deben ser AAAA-MM-DD' }, 400)
  if (hasta < desde) return json({ error: 'hasta debe ser igual o posterior a desde' }, 400)
  if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > MAX_DIAS) {
    return json({ error: `El rango maximo es de ${MAX_DIAS} dias` }, 400)
  }
  return { desde, hasta }
}

// --- CSV del reporte ticket por ticket ---
interface Articulo { producto: string; cantidad: number | null; unidad: string | null; monto: number }
interface TicketRep {
  ticket_id: string; folio: string | null; comercio: string | null; sucursal_nombre: string
  fecha_ticket: string | null; fecha_captura: string; estado: string; estado_texto: string; total: number; articulos: Articulo[]
}
const pesos = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)
// Comillas dobles y, si empieza con = + - @, un apostrofe para que Excel no lo tome como formula.
const celda = (v: string | number | null) => {
  if (v === null) return ''
  if (typeof v === 'number') return String(v)
  const t = /^[=+\-@\t\r]/.test(v) ? "'" + v : v
  return '"' + t.replace(/"/g, '""') + '"'
}
function ticketsCsv(tickets: TicketRep[]): string {
  const filas = [['Ticket', 'Estado', 'Folio', 'Comercio', 'Sucursal', 'Fecha del ticket', 'Fecha de captura', 'Total del ticket', 'Articulos', 'Desglose']
    .map(celda).join(',')]
  for (const t of tickets) {
    const desglose = t.articulos.map(a =>
      [a.producto, a.cantidad !== null ? `${a.cantidad}${a.unidad ? ' ' + a.unidad : ''}` : '', pesos(a.monto)].filter(Boolean).join(' ')).join(' | ')
    filas.push([t.ticket_id.slice(0, 8), t.estado_texto, t.folio, t.comercio, t.sucursal_nombre, t.fecha_ticket, t.fecha_captura,
      t.total, t.articulos.length, desglose].map(celda).join(','))
  }
  // BOM para que Excel abra bien los acentos.
  return String.fromCharCode(0xfeff) + filas.join('\r\n') + '\r\n'
}

serve(async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Solo GET (esta API es de solo lectura)' }, 405)

  // --- Autenticacion ---
  const auth = req.headers.get('authorization') ?? ''
  const key = (req.headers.get('x-api-key') || auth.replace(/^Bearer\s+/i, '')).trim()
  if (!/^tk_[A-Za-z0-9]{32,64}$/.test(key)) return json({ error: 'No autorizado' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: llave, error: keyErr } = await supabase
    .from('api_keys').select('id, cuenta_id').eq('key_hash', await sha256Hex(key)).eq('activa', true).maybeSingle()
  if (keyErr) return json({ error: 'Error interno' }, 500)
  if (!llave || !llave.cuenta_id) return json({ error: 'No autorizado' }, 401)
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', llave.id)
  // Cada llave es de UNA cuenta: TODO lo de abajo se filtra por esta cuenta. Nunca hay vista global.
  const cuentaId: string = llave.cuenta_id

  // --- Ruteo ---
  const url = new URL(req.url)
  const ruta = (url.pathname.match(/api-cuentas(\/.*)?$/)?.[1] ?? '/').replace(/\/+$/, '') || '/'

  const { data: sucs, error: sucErr } = await supabase
    .from('sucursales').select('id, slug, nombre, es_prueba').eq('activa', true).eq('cuenta_id', cuentaId).order('nombre')
  if (sucErr) return json({ error: 'Error interno' }, 500)
  const reales = (sucs ?? []).filter(s => !s.es_prueba)

  if (ruta === '/sucursales') {
    return json({ sucursales: reales.map(s => ({ slug: s.slug, nombre: s.nombre })) })
  }

  if (ruta === '/resumen') {
    const periodo = leerPeriodo(url)
    if (periodo instanceof Response) return periodo
    const { desde, hasta } = periodo

    const resumen = async (sucursalId: string | null) => {
      const { data, error } = await supabase.rpc('resumen_tickets', {
        p_desde: desde, p_hasta: hasta, p_sucursal: sucursalId, p_comercio: null, p_cuenta: cuentaId,
      })
      if (error) throw new Error(error.message)
      const { periodo: _periodo, ...resto } = data as Record<string, unknown>
      return resto
    }

    try {
      const slug = url.searchParams.get('sucursal')
      if (slug) {
        const s = reales.find(x => x.slug === slug)
        if (!s) return json({ error: `Sucursal desconocida: ${slug}` }, 404)
        return json({ periodo: { desde, hasta }, sucursal: { slug: s.slug, nombre: s.nombre }, ...(await resumen(s.id)) })
      }
      const porSucursal = []
      for (const s of reales) porSucursal.push({ slug: s.slug, nombre: s.nombre, ...(await resumen(s.id)) })
      return json({ periodo: { desde, hasta }, total: await resumen(null), por_sucursal: porSucursal })
    } catch (e) {
      console.error('api-cuentas resumen:', (e as Error).message)
      return json({ error: 'Error interno' }, 500)
    }
  }

  // Desglose de UNA categoria por producto (solo lo autorizado). Ej. Bodega -> playo, bolsas, envios...
  if (ruta === '/desglose') {
    const periodo = leerPeriodo(url)
    if (periodo instanceof Response) return periodo
    const { desde, hasta } = periodo

    const pedida = (url.searchParams.get('categoria') ?? '').trim()
    if (!pedida) return json({ error: 'Falta ?categoria=<nombre>, por ejemplo Bodega. Los nombres salen en /resumen (oficiales_por_categoria).' }, 400)
    const detalle = ['1', 'true', 'si'].includes((url.searchParams.get('detalle') ?? '').toLowerCase())

    // Solo categorias que esta cuenta puede ver: las globales y las de sus sucursales (+ "Sin categoria").
    const idsCuenta = new Set(reales.map(s => s.id))
    const { data: cats, error: catErr } = await supabase.from('categorias_gasto').select('nombre, sucursal_id')
    if (catErr) return json({ error: 'Error interno' }, 500)
    const visibles = [...new Set((cats ?? [])
      .filter(c => c.sucursal_id === null || idsCuenta.has(c.sucursal_id as string))
      .map(c => c.nombre as string))].concat('Sin categoria')
    const canonica = visibles.find(n => n.toLowerCase() === pedida.toLowerCase())
    if (!canonica) return json({ error: `Categoria desconocida: ${pedida}`, disponibles: visibles }, 404)

    const desglose = async (sucursalId: string | null) => {
      const { data, error } = await supabase.rpc('desglose_categoria', {
        p_desde: desde, p_hasta: hasta, p_categoria: canonica, p_sucursal: sucursalId, p_cuenta: cuentaId, p_detalle: detalle,
      })
      if (error) throw new Error(error.message)
      return data as Record<string, unknown>
    }

    try {
      const slug = url.searchParams.get('sucursal')
      if (slug) {
        const s = reales.find(x => x.slug === slug)
        if (!s) return json({ error: `Sucursal desconocida: ${slug}` }, 404)
        return json({ periodo: { desde, hasta }, sucursal: { slug: s.slug, nombre: s.nombre }, ...(await desglose(s.id)) })
      }
      const porSucursal = []
      for (const s of reales) {
        const { categoria: _c, cuenta_operativo: _o, ...resto } = await desglose(s.id)
        porSucursal.push({ slug: s.slug, nombre: s.nombre, ...resto })
      }
      return json({ periodo: { desde, hasta }, ...(await desglose(null)), por_sucursal: porSucursal })
    } catch (e) {
      console.error('api-cuentas desglose:', (e as Error).message)
      return json({ error: 'Error interno' }, 500)
    }
  }

  // Ticket por ticket con su desglose por articulo (para cuadrar contra el punto de venta).
  if (ruta === '/tickets') {
    const periodo = leerPeriodo(url)
    if (periodo instanceof Response) return periodo
    const { desde, hasta } = periodo
    // Default: todos (cada ticket dice si esta Aprobado, Rechazado o Por revisar). confirmado = solo lo autorizado.
    const estado = (url.searchParams.get('estado') ?? 'todos').toLowerCase()
    if (!['confirmado', 'todos'].includes(estado)) return json({ error: 'estado debe ser todos (default) o confirmado' }, 400)
    const formato = (url.searchParams.get('formato') ?? 'json').toLowerCase()
    if (!['json', 'csv'].includes(formato)) return json({ error: 'formato debe ser json (default) o csv' }, 400)

    let sucursalId: string | null = null
    const slug = url.searchParams.get('sucursal')
    if (slug) {
      const s = reales.find(x => x.slug === slug)
      if (!s) return json({ error: `Sucursal desconocida: ${slug}` }, 404)
      sucursalId = s.id
    }
    const { data, error } = await supabase.rpc('reporte_tickets', {
      p_desde: desde, p_hasta: hasta, p_sucursal: sucursalId, p_cuenta: cuentaId, p_estado: estado,
    })
    if (error) { console.error('api-cuentas tickets:', error.message); return json({ error: 'Error interno' }, 500) }
    const rep = data as { tickets: TicketRep[] } & Record<string, unknown>

    if (formato === 'csv') {
      return new Response(ticketsCsv(rep.tickets), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="tickets_${slug ?? 'todas'}_${desde}_a_${hasta}.csv"`,
        },
      })
    }
    return json({ periodo: { desde, hasta }, ...(slug ? { sucursal: slug } : {}), ...rep })
  }

  return json({ error: 'Ruta no encontrada. Disponibles: /resumen, /desglose, /tickets, /sucursales' }, 404)
})
