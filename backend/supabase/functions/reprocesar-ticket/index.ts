import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { loadCatalog, buildCatalogPromptContext, matchProductInCatalog, resolveCategoria } from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'

// deno-lint-ignore no-explicit-any
type SB = any
type ImageCandidate = { bucket: 'archivo' | 'por-revisar'; path: string }

interface GeminiItem {
  descripcion?: string
  cantidad?: number | null
  unidad?: string | null
  monto?: number | null
  categoria?: string | null
}
interface GeminiResult {
  comercio?: string | null
  fecha?: string | null
  folio_ticket?: string | null
  monto_total?: number | null
  confianza?: string
  items?: GeminiItem[]
}

function prompt(catalogContext: string): string {
  return `Vuelve a leer este ticket de gasto. Extrae JSON exacto:
{
  "comercio": "nombre o null",
  "fecha": "YYYY-MM-DD o null",
  "folio_ticket": "folio o null",
  "monto_total": numero o null,
  "confianza": "alta|media|baja",
  "items": [{"descripcion":"texto literal leido", "cantidad": numero o null, "unidad": "kg|g|pz|ml|lt|caja|bulto|paquete|rollo|galon|otro|null", "monto": numero o null, "categoria": "categoria valida o null"}]
}

${catalogContext}

Reglas:
- Conserva descripcion literal. No reemplaces codigos por nombres bonitos del catalogo.
- Usa catalogo solo para categoria/unidad cuando coincida.
- Un renglon por producto. No agrupes productos.
- Si no estas seguro, confianza "baja".
- Responde solo JSON.`
}

function parseGemini(text: string): GeminiResult {
  return JSON.parse(text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')) as GeminiResult
}

async function callGemini(genAI: GoogleGenerativeAI, imagePart: unknown, textPrompt: string): Promise<GeminiResult> {
  const envModel = Deno.env.get('GEMINI_MODEL')
  const modelos = [
    ...(envModel ? [envModel] : []),
    'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest',
  ].filter((m, i, a) => a.indexOf(m) === i)
  let lastErr = ''
  for (const name of modelos) {
    try {
      const model = genAI.getGenerativeModel({ model: name })
      // deno-lint-ignore no-explicit-any
      const result = await model.generateContent([imagePart as any, textPrompt])
      const datos = parseGemini(result.response.text())
      ;(datos as Record<string, unknown>)._modelo = name
      ;(datos as Record<string, unknown>)._reproceso_manual = true
      return datos
    } catch (err) {
      lastErr = String(err)
      console.error(`Gemini reproceso fallo con ${name}:`, lastErr.slice(0, 160))
    }
  }
  return { confianza: 'baja', items: [], _error: lastErr } as GeminiResult
}

async function createAlert(supabase: SB, registroId: string, tipo: string): Promise<void> {
  await supabase.from('alertas_tickets').insert({ registro_ticket_id: registroId, tipo })
}

async function requireAdmin(supabase: SB, req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return false
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return false
  const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
  return !!data
}

async function downloadTicketImage(
  supabase: SB,
  reg: { storage_path_original?: string | null; storage_path_archivo?: string | null },
) {
  const candidates: ImageCandidate[] = []
  if (reg.storage_path_archivo) candidates.push({ bucket: 'archivo', path: reg.storage_path_archivo })
  if (reg.storage_path_original) candidates.push({ bucket: 'por-revisar', path: reg.storage_path_original })

  let lastError = ''
  for (const c of candidates) {
    const { data, error } = await supabase.storage.from(c.bucket).download(c.path)
    if (data) return { fileData: data, source: c, error: null as string | null }
    lastError = `${c.bucket}/${c.path}: ${error?.message ?? 'sin datos'}`
  }

  return {
    fileData: null,
    source: null,
    error: candidates.length ? lastError : 'ticket sin storage_path_original/storage_path_archivo',
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const { registro_id } = await req.json().catch(() => ({}))
    if (!registro_id) return json({ error: 'registro_id requerido' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await requireAdmin(supabase, req))) return json({ error: 'No autorizado' }, 401)
    const { data: reg } = await supabase.from('registros_tickets')
      .select('id, sucursal_id, storage_path_original, storage_path_archivo')
      .eq('id', registro_id).maybeSingle()
    if (!reg) return json({ error: 'Ticket no encontrado' }, 404)

    const { fileData, source, error: imageError } = await downloadTicketImage(supabase, reg)
    if (!fileData || !source) {
      return json({
        error: 'No se pudo descargar la imagen para releer. Revisa si el archivo existe en Storage.',
        detalle: imageError,
      }, 500)
    }

    const imageBytes = await fileData.arrayBuffer()
    const catalog: Catalog = await loadCatalog(reg.sucursal_id)
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY')!)
    const datos = await callGemini(genAI, {
      inlineData: { mimeType: fileData.type || 'image/jpeg', data: encodeBase64(imageBytes) },
    }, prompt(buildCatalogPromptContext(catalog)))

    const rawItems = (Array.isArray(datos.items) ? datos.items : []).filter(it => it && (it.descripcion || it.monto != null))
    // No destruir los renglones existentes si la IA no devolvio nada util (falla total).
    if (rawItems.length === 0 && datos.confianza === 'baja') {
      return json({ error: 'La IA no pudo releer el ticket. No se cambio nada; intenta de nuevo.' }, 422)
    }
    const montoTotal = datos.monto_total ?? (rawItems.length ? rawItems.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null : null)
    const hoy = new Date().toISOString().slice(0, 10)
    const fechaValida = !!(datos.fecha && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha))
    const fechaTicket = fechaValida ? datos.fecha! : hoy
    if (!fechaValida) (datos as Record<string, unknown>)._fecha_asumida = true

    await supabase.from('ticket_items').delete().eq('registro_ticket_id', registro_id)
    await supabase.from('alertas_tickets').update({ resuelta: true }).eq('registro_ticket_id', registro_id).eq('resuelta', false)
    await supabase.from('registros_tickets').update({
      estado: 'pendiente',
      fecha_ticket: fechaTicket,
      folio_ticket: datos.folio_ticket ?? null,
      comercio: datos.comercio ?? null,
      monto: montoTotal,
      gemini_raw: datos as unknown as Record<string, unknown>,
    }).eq('id', registro_id)

    let anySinCategoria = false
    let anySinUnidad = false
    let anyProductoNuevo = false
    const items = (rawItems.length ? rawItems : [{ descripcion: datos.comercio ?? 'Ticket', monto: montoTotal, categoria: null, unidad: null, cantidad: null }]).map((it, index) => {
      const desc = (it.descripcion ?? 'Producto').toString().slice(0, 500)
      const matched = matchProductInCatalog(desc, catalog.products)
      let cat = resolveCategoria(it.categoria ?? null, catalog.categories)
      if (!cat && matched) cat = resolveCategoria(matched.categoria_nombre, catalog.categories)
      const unidad = (it.unidad && String(it.unidad).trim()) || matched?.unidad_default || null
      let necesita = false, motivo: string | null = null
      if (!cat) { necesita = true; motivo = 'sin_categoria'; anySinCategoria = true }
      else if (!unidad) { necesita = true; motivo = 'sin_unidad'; anySinUnidad = true }
      else if (!matched) { necesita = true; motivo = 'producto_nuevo'; anyProductoNuevo = true }
      return {
        registro_ticket_id: registro_id,
        descripcion: desc,
        cantidad: it.cantidad ?? null,
        unidad,
        monto: it.monto ?? null,
        categoria_id: cat?.id ?? null,
        producto_catalogo_id: matched?.id ?? null,
        necesita_revision: necesita,
        motivo_revision: motivo,
        orden: index,
      }
    })
    await supabase.from('ticket_items').insert(items)

    if (!fechaValida) await createAlert(supabase, registro_id, 'sin_fecha')
    if (datos.confianza === 'baja') await createAlert(supabase, registro_id, 'ilegible')
    if (anySinCategoria || anyProductoNuevo) await createAlert(supabase, registro_id, 'producto_no_reconocido')
    if (anySinUnidad) await createAlert(supabase, registro_id, 'sin_unidad')

    return json({ ok: true, items: items.length })
  } catch (err) {
    console.error('Error reprocesar-ticket:', err)
    return json({ error: 'Error interno' }, 500)
  }
})
