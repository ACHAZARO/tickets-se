import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  loadCatalog, buildCatalogPromptContext, matchProductInCatalog, resolveCategoria,
} from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'

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

function buildGeminiPrompt(catalogContext: string): string {
  return `Analiza esta imagen de un ticket o comprobante de gasto. Un ticket puede contener VARIOS productos (renglones). Extrae la informacion en este formato JSON exacto:
{
  "comercio": "nombre del establecimiento o null",
  "fecha": "YYYY-MM-DD o null si no se puede determinar",
  "folio_ticket": "numero de ticket, nota o factura, o null",
  "monto_total": numero decimal del total del ticket o null,
  "confianza": "alta si los datos son claros, media si algunos son ambiguos, baja si es ilegible o muy borroso",
  "items": [
    {
      "descripcion": "texto del producto tal como aparece",
      "cantidad": numero o null,
      "unidad": "kg, pz, ml, lt, caja, bulto, paquete, rollo, galon u otro, o null si no se indica",
      "monto": numero decimal del precio de ese renglon o null,
      "categoria": "una de las categorias validas listadas abajo, o null si ninguna aplica"
    }
  ]
}

${catalogContext}

Reglas importantes:
- Crea un objeto dentro de "items" por CADA producto o renglon del ticket. No agrupes varios productos en uno.
- Asigna a cada renglon la categoria mas adecuada de la lista de categorias validas. Si de plano ninguna aplica, usa null en "categoria".
- Si es una nota escrita a mano sin precio por renglon, deja "monto" en null en los items y pon el total en "monto_total".
- Si un producto coincide con uno de los productos conocidos, usa su categoria y unidad.
- Incluye tambien el texto escrito a mano en tu analisis.
Responde UNICAMENTE con el JSON, sin explicaciones adicionales.`
}

async function verifySessionToken(
  token: string, jwtSecret: string
): Promise<{ sub: string; slug: string } | null> {
  try {
    const keyData = new TextEncoder().encode(jwtSecret)
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    )
    return await verify(token, cryptoKey) as { sub: string; slug: string }
  } catch {
    return null
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function detectSmartDuplicate(
  supabase: ReturnType<typeof createClient>,
  sucursalId: string, folio: string | null, comercio: string | null,
  monto: number | null, fecha: string | null
): Promise<string | null> {
  if (folio) {
    const { data } = await supabase.from('registros_tickets').select('id')
      .eq('sucursal_id', sucursalId).eq('folio_ticket', folio)
      .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      .limit(1).maybeSingle()
    if (data) return data.id as string
  }
  if (comercio && monto && fecha) {
    const { data } = await supabase.from('registros_tickets').select('id')
      .eq('sucursal_id', sucursalId).eq('fecha_ticket', fecha).ilike('comercio', comercio)
      .gte('monto', monto * 0.9).lte('monto', monto * 1.1)
      .limit(1).maybeSingle()
    if (data) return data.id as string
  }
  return null
}

async function createAlert(
  supabase: ReturnType<typeof createClient>, registroId: string, tipo: string, duplicadoDeId?: string
): Promise<void> {
  await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId, tipo, duplicado_de_id: duplicadoDeId ?? null,
  })
}

async function notifyAlertEmail(registroId: string, tipo: string): Promise<void> {
  if (tipo !== 'duplicado' && tipo !== 'posible_duplicado' && tipo !== 'ilegible') return
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/enviar-alerta-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ registro_ticket_id: registroId, tipo }),
    })
  } catch (err) {
    console.error('Email notification error:', err)
  }
}

function parseGemini(text: string): GeminiResult {
  const clean = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(clean) as GeminiResult
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Token de sesion requerido' }, 401)

    const jwtSecret = Deno.env.get('JWT_SECRET')!
    const session = await verifySessionToken(authHeader.slice(7), jwtSecret)
    if (!session) return json({ error: 'Token de sesion invalido o expirado' }, 401)

    const empleadoId = session.sub
    const slug = session.slug

    const formData = await req.formData()
    const imagenFile = formData.get('imagen') as File | null
    if (!imagenFile) return json({ error: 'imagen es requerida' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Resolver sucursal desde el slug del token (no se confia en el cliente)
    const { data: suc } = await supabase.from('sucursales')
      .select('id').eq('slug', slug).eq('activa', true).maybeSingle()
    if (!suc) return json({ error: 'Sucursal no encontrada o inactiva' }, 404)
    const sucursalId = suc.id as string

    const imageBytes = await imagenFile.arrayBuffer()
    const hashImagen = await sha256Hex(imageBytes)

    // Layer 1: duplicado exacto por hash de imagen
    const { data: existing } = await supabase.from('registros_tickets')
      .select('id').eq('hash_imagen', hashImagen).maybeSingle()
    if (existing) return json({ duplicado: true, ticket_original_id: existing.id })

    // Subir imagen
    const extension = imagenFile.name.split('.').pop() ?? 'jpg'
    const storagePath = `${sucursalId}/${Date.now()}_${hashImagen.slice(0, 8)}.${extension}`
    const { error: uploadError } = await supabase.storage.from('por-revisar')
      .upload(storagePath, imageBytes, { contentType: imagenFile.type || 'image/jpeg', upsert: false })
    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return json({ error: 'Error al subir la imagen' }, 500)
    }

    // Catalogo como contexto de Gemini
    const catalog: Catalog = await loadCatalog()
    const prompt = buildGeminiPrompt(buildCatalogPromptContext(catalog))

    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY')!)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes)))

    let datos: GeminiResult
    try {
      const result = await model.generateContent([
        { inlineData: { mimeType: imagenFile.type || 'image/jpeg', data: imageBase64 } },
        prompt,
      ])
      datos = parseGemini(result.response.text())
    } catch (err) {
      console.error('Gemini error/parse:', err)
      datos = { confianza: 'baja', items: [] }
    }

    // Normalizar items (robustez ante respuestas incompletas)
    let rawItems: GeminiItem[] = Array.isArray(datos.items) ? datos.items : []
    rawItems = rawItems.filter(it => it && (it.descripcion || it.monto != null))

    const montoTotal = datos.monto_total ?? (rawItems.length
      ? rawItems.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null
      : null)

    // Header del ticket
    const { data: registro, error: insertError } = await supabase.from('registros_tickets').insert({
      sucursal_id: sucursalId,
      empleado_id: empleadoId,
      hash_imagen: hashImagen,
      storage_path_original: storagePath,
      estado: 'pendiente',
      fecha_ticket: datos.fecha ?? null,
      folio_ticket: datos.folio_ticket ?? null,
      comercio: datos.comercio ?? null,
      monto: montoTotal,
      gemini_raw: datos as unknown as Record<string, unknown>,
    }).select('id').single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return json({ error: 'Error al guardar el registro' }, 500)
    }
    const registroId = registro.id as string

    // Construir e insertar items
    const matchedIds = new Set<string>()
    let anySinCategoria = false
    let anySinUnidad = false

    const itemsToInsert = (rawItems.length ? rawItems : [
      { descripcion: datos.comercio ?? 'Ticket', monto: montoTotal, categoria: null, unidad: null, cantidad: null },
    ]).map(it => {
      const desc = (it.descripcion ?? 'Producto').toString().slice(0, 500)
      const matched = matchProductInCatalog(desc, catalog.products)
      if (matched) matchedIds.add(matched.id)

      // Categoria: la sugerida por Gemini, o la del producto del catalogo
      let cat = resolveCategoria(it.categoria ?? null, catalog.categories)
      if (!cat && matched) cat = resolveCategoria(matched.categoria_nombre, catalog.categories)

      // Unidad: la de Gemini o la default del catalogo
      const unidad = (it.unidad && String(it.unidad).trim()) || matched?.unidad_default || null

      let necesita = false
      let motivo: string | null = null
      if (!cat) { necesita = true; motivo = 'sin_categoria'; anySinCategoria = true }
      else if (!unidad) { necesita = true; motivo = 'sin_unidad'; anySinUnidad = true }

      return {
        registro_ticket_id: registroId,
        descripcion: desc,
        cantidad: it.cantidad ?? null,
        unidad,
        monto: it.monto ?? null,
        categoria_id: cat?.id ?? null,
        producto_catalogo_id: matched?.id ?? null,
        necesita_revision: necesita,
        motivo_revision: motivo,
      }
    })

    const { error: itemsError } = await supabase.from('ticket_items').insert(itemsToInsert)
    if (itemsError) console.error('ticket_items insert error:', itemsError)

    // Incrementar veces_matched de los productos del catalogo que hicieron match
    for (const pid of matchedIds) {
      const prod = catalog.products.find(p => p.id === pid)
      if (prod) {
        await supabase.from('catalogo_productos')
          .update({ veces_matched: prod.veces_matched + 1 }).eq('id', pid)
      }
    }

    // Alertas a nivel ticket
    const alertas: string[] = []
    const dupId = await detectSmartDuplicate(
      supabase, sucursalId, datos.folio_ticket ?? null, datos.comercio ?? null, montoTotal, datos.fecha ?? null
    )
    if (dupId && dupId !== registroId) {
      await createAlert(supabase, registroId, 'posible_duplicado', dupId)
      alertas.push('posible_duplicado'); notifyAlertEmail(registroId, 'posible_duplicado')
    }
    if (datos.confianza === 'baja') {
      await createAlert(supabase, registroId, 'ilegible')
      alertas.push('ilegible'); notifyAlertEmail(registroId, 'ilegible')
    }
    if (anySinCategoria) {
      await createAlert(supabase, registroId, 'producto_no_reconocido')
      alertas.push('producto_no_reconocido')
    }
    if (anySinUnidad) {
      await createAlert(supabase, registroId, 'sin_unidad')
      alertas.push('sin_unidad')
    }

    const necesitaRevision = anySinCategoria || anySinUnidad || datos.confianza === 'baja'

    return json({
      duplicado: false,
      registro_id: registroId,
      necesita_revision: necesitaRevision,
      ticket: {
        comercio: datos.comercio ?? null,
        fecha: datos.fecha ?? null,
        folio_ticket: datos.folio_ticket ?? null,
        monto_total: montoTotal,
        confianza: datos.confianza ?? 'media',
        items: itemsToInsert.map(it => ({
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: it.unidad,
          monto: it.monto,
          categoria_id: it.categoria_id,
          necesita_revision: it.necesita_revision,
        })),
      },
      alertas,
    })
  } catch (err) {
    console.error('Unhandled error:', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
