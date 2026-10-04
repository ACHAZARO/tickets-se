// revisar-precio: la IA revisa una alerta de precio (variacion grande entre el renglon ANTERIOR y el ULTIMO de un
// articulo) y dice si es una FALSA ALARMA (mismo articulo, medida mal tomada: caja vs pieza, kg vs g, paquete vs
// unidad) o una subida real. Propone la correccion exacta; NO cambia nada: quien revisa la aplica desde Precios.
// Solo admin (JWT de Supabase + admin_users). Ve las dos fotos (una si es el mismo ticket).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { leerTicketConGemini, modelosCandidatos } from '../_shared/gemini.ts'

// deno-lint-ignore no-explicit-any
type SB = any

const UNIDADES = ['pz', 'g', 'kg', 'ml', 'lt', 'caja', 'paquete', 'bolsa', 'bulto', 'rollo', 'galon', 'servicio', 'cono', 'charola', 'docena', 'botella', 'lata']

async function requireAdmin(supabase: SB, req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return null
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return null
  const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
  return data ? (user.email ?? 'admin') : null
}

type Item = {
  id: string; descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null
  catalogo_productos: { id: string; nombre: string; unidad_default: string | null; contiene_cantidad: number | null; contiene_unidad: string | null; contiene_sub_cantidad: number | null; contiene_sub_unidad: string | null } | null
  registros_tickets: { id: string; comercio: string | null; fecha_ticket: string | null; monto: number | null; storage_path_original: string | null; storage_path_archivo: string | null }
}

const pesos = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '?' : `$${Number(n).toFixed(2)}`)
const pu = (i: Item) => (Number(i.cantidad) > 0 && Number(i.monto) > 0 ? Number(i.monto) / Number(i.cantidad) : null)

function describir(etiqueta: string, i: Item, foto: string): string {
  const t = i.registros_tickets
  return `${etiqueta} (${foto}): ticket del ${t.fecha_ticket ?? '?'} en "${t.comercio ?? 'sin comercio'}" (total del ticket ${pesos(t.monto)}).
  Renglon leido: "${i.descripcion ?? ''}" | cantidad ${i.cantidad ?? '?'} ${i.unidad ?? '(sin unidad)'} | importe ${pesos(i.monto)} | precio por ${i.unidad ?? 'unidad'} ${pesos(pu(i))}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const quien = await requireAdmin(supabase, req)
    if (!quien) return json({ error: 'No autorizado' }, 401)

    const { item_anterior, item_ultimo } = await req.json().catch(() => ({})) as { item_anterior?: string; item_ultimo?: string }
    const uuid = /^[0-9a-f-]{36}$/i
    if (!item_anterior || !item_ultimo || !uuid.test(item_anterior) || !uuid.test(item_ultimo)) return json({ error: 'Faltan los renglones' }, 400)

    const { data, error } = await supabase.from('ticket_items')
      .select('id, descripcion, cantidad, unidad, monto, catalogo_productos:producto_catalogo_id(id, nombre, unidad_default, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, contiene_sub_unidad), registros_tickets!inner(id, comercio, fecha_ticket, monto, storage_path_original, storage_path_archivo)')
      .in('id', [item_anterior, item_ultimo])
    if (error) return json({ error: 'No se pudieron leer los renglones' }, 500)
    const items = (data ?? []) as unknown as Item[]
    const a = items.find(x => x.id === item_anterior), b = items.find(x => x.id === item_ultimo)
    if (!a || !b) return json({ error: 'No se encontraron los renglones' }, 404)

    // Fotos: una sola si es el mismo ticket.
    const mismoTicket = a.registros_tickets.id === b.registros_tickets.id
    const fotos: { data: string; mimeType: string }[] = []
    for (const t of mismoTicket ? [a.registros_tickets] : [a.registros_tickets, b.registros_tickets]) {
      for (const r of [{ bucket: 'archivo', path: t.storage_path_archivo }, { bucket: 'por-revisar', path: t.storage_path_original }]) {
        if (!r.path) continue
        const { data: blob } = await supabase.storage.from(r.bucket).download(r.path)
        if (blob) { fotos.push({ data: encodeBase64(await blob.arrayBuffer()), mimeType: blob.type || 'image/jpeg' }); break }
      }
    }
    // Sin las dos fotos la IA confundiria cual es cual: mejor no adivinar.
    if (fotos.length < (mismoTicket ? 1 : 2)) return json({ error: 'Falta la foto de uno de los tickets (se guardan 12 meses).' }, 422)

    const prod = a.catalogo_productos ?? b.catalogo_productos
    const equiv = prod?.contiene_cantidad ? `1 ${prod.unidad_default ?? 'unidad'} = ${prod.contiene_cantidad} ${prod.contiene_unidad ?? ''}` : 'ninguna'
    const prompt = `Eres auditor de compras de un restaurante en Mexico. Un articulo cambio mucho de precio entre dos compras y hay
que decidir si es una FALSA ALARMA (el mismo articulo, pero una de las dos lecturas tomo mal la medida o la cantidad:
caja contra pieza, paquete contra unidad, kg contra g, 1 contra 12, etc.) o una SUBIDA REAL de precio, o si en realidad
son ARTICULOS DISTINTOS ligados al mismo nombre por error.

Articulo del catalogo: "${prod?.nombre ?? '?'}" | se compra por: ${prod?.unidad_default ?? '?'} | equivalencia guardada: ${equiv}
${mismoTicket ? 'OJO: los dos renglones son del MISMO ticket (misma foto).' : 'Foto 1 = ticket ANTERIOR, foto 2 = ticket ULTIMO.'}
${describir('ANTERIOR', a, mismoTicket ? 'foto 1' : 'foto 1')}
${describir('ULTIMO', b, mismoTicket ? 'foto 1' : 'foto 2')}
Variacion del precio por unidad: ${pu(a) && pu(b) ? Math.round(((pu(b)! - pu(a)!) / pu(a)!) * 100) + '%' : '?'}

Mira las fotos: que dice el ticket de verdad (cantidad, unidad, precio unitario e importe de ESE renglon).
Responde SOLO un JSON:
{
  "veredicto": "falsa_alarma" | "subida_real" | "otro_articulo" | "no_se",
  "explicacion": "1 o 2 frases en espanol sencillo para el dueno, con los numeros (ej. 'El anterior es 1 pieza de 250 ml a $18.50 y el ultimo 1 caja de 12 piezas a $350: por pieza son $29.17')",
  "correcciones": [ { "renglon": "anterior" | "ultimo", "cantidad": numero, "unidad": "texto" } ],
  "equivalencia": { "contiene_cantidad": numero, "contiene_unidad": "texto" } | null
}
Reglas: "correcciones" solo si un renglon tiene MAL la cantidad o la unidad segun la foto (lista vacia si no). Usa la unidad
que se ve en el ticket. "equivalencia" solo si el mismo articulo se compra en dos presentaciones (ej. caja y pieza) y la
foto lo deja claro: cuantas piezas/gramos/ml trae 1 ${prod?.unidad_default ?? 'unidad'}. Si no estas seguro: "no_se".`

    const res = await leerTicketConGemini({
      imagenBase64: fotos[0].data, mimeType: fotos[0].mimeType, imagenesExtra: fotos.slice(1),
      prompt, modelos: modelosCandidatos(), deadlineMs: 90_000,
    })
    const d = res.datos as Record<string, unknown> | null
    if (!d) return json({ error: 'La IA no respondió. Intenta en un momento.', detalle: res.error }, 502)

    // Validar lo que propone la IA antes de mostrarlo (nunca se confia a ciegas).
    const veredicto = ['falsa_alarma', 'subida_real', 'otro_articulo', 'no_se'].includes(String(d.veredicto)) ? String(d.veredicto) : 'no_se'
    const correcciones = (Array.isArray(d.correcciones) ? d.correcciones : [])
      .map(c => c as Record<string, unknown>)
      .filter(c => (c.renglon === 'anterior' || c.renglon === 'ultimo') && Number(c.cantidad) > 0 && Number(c.cantidad) < 100000)
      .map(c => ({
        item_id: c.renglon === 'anterior' ? a.id : b.id, renglon: c.renglon as string,
        cantidad: Number(c.cantidad), unidad: UNIDADES.includes(String(c.unidad ?? '').trim().toLowerCase()) ? String(c.unidad).trim().toLowerCase() : (c.renglon === 'anterior' ? a.unidad : b.unidad),
      }))
    const eq = d.equivalencia as Record<string, unknown> | null
    const UNIDADES_CONTENIDO = ['g', 'kg', 'ml', 'lt', 'pz']
    const equivalencia = eq && Number(eq.contiene_cantidad) > 0 && UNIDADES_CONTENIDO.includes(String(eq.contiene_unidad ?? '').trim().toLowerCase())
      ? { producto_id: prod?.id ?? null, contiene_cantidad: Number(eq.contiene_cantidad), contiene_unidad: String(eq.contiene_unidad).trim().toLowerCase() }
      : null

    return json({
      ok: true, modelo: res.modelo, veredicto,
      explicacion: String(d.explicacion ?? '').slice(0, 600),
      correcciones, equivalencia: equivalencia?.producto_id ? equivalencia : null,
    })
  } catch (e) {
    console.error('revisar-precio', e)
    return json({ error: 'Error interno' }, 500)
  }
})
