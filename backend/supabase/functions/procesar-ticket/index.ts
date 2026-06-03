import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { loadCatalog, buildCatalogPromptContext, matchProductInCatalog } from '../_shared/catalog.ts'
import type { CatalogProduct } from '../_shared/catalog.ts'

function buildGeminiPrompt(catalogContext: string): string {
  return `Analiza esta imagen de un ticket o comprobante de gasto y extrae la siguiente informacion en formato JSON:
{
  "folio_ticket": "numero de ticket, nota, factura o folio visible, o null si no hay",
  "fecha": "YYYY-MM-DD o null si no se puede determinar",
  "comercio": "nombre del establecimiento o null",
  "producto": "descripcion del producto o servicio principal o null",
  "cantidad": numero o null,
  "unidad": "kg, pz, ml, lt, caja, bulto, u otro, o null si no se puede determinar",
  "monto": numero decimal (total) o null,
  "categoria_gasto": "una de las categorias validas listadas abajo",
  "confianza": "alta si los datos son claros, media si algunos son ambiguos, baja si el ticket es ilegible o muy borroso"
}

${catalogContext}

Si hay texto escrito a mano, tambien incluyelo en tu analisis.
Si el producto aparece en la lista de productos conocidos, usa su categoria y unidad.
Responde UNICAMENTE con el JSON, sin explicaciones adicionales.`
}

async function verifySessionToken(
  token: string,
  jwtSecret: string
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
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function detectSmartDuplicate(
  supabase: ReturnType<typeof createClient>,
  sucursalId: string,
  folio: string | null,
  comercio: string | null,
  monto: number | null,
  fecha: string | null
): Promise<string | null> {
  if (folio) {
    const { data } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('sucursal_id', sucursalId)
      .eq('folio_ticket', folio)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()
    if (data) return data.id
  }

  if (comercio && monto && fecha) {
    const { data } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('sucursal_id', sucursalId)
      .eq('fecha_ticket', fecha)
      .ilike('comercio', comercio)
      .gte('monto', monto * 0.9)
      .lte('monto', monto * 1.1)
      .limit(1)
      .maybeSingle()
    if (data) return data.id
  }

  return null
}

async function createAlert(
  supabase: ReturnType<typeof createClient>,
  registroId: string,
  tipo: string,
  duplicadoDeId?: string
): Promise<void> {
  await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId,
    tipo,
    duplicado_de_id: duplicadoDeId ?? null,
  })
}

async function notifyAlertEmail(
  registroId: string,
  tipo: string
): Promise<void> {
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Token de sesion requerido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwtSecret = Deno.env.get('JWT_SECRET')!
    const sessionPayload = await verifySessionToken(authHeader.slice(7), jwtSecret)
    if (!sessionPayload) {
      return new Response(JSON.stringify({ error: 'Token de sesion invalido o expirado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const formData = await req.formData()
    const imagenFile = formData.get('imagen') as File | null
    const sucursalId = formData.get('sucursal_id') as string | null
    const empleadoId = formData.get('empleado_id') as string | null

    if (!imagenFile || !sucursalId || !empleadoId) {
      return new Response(
        JSON.stringify({ error: 'imagen, sucursal_id y empleado_id son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (sessionPayload.sub !== empleadoId) {
      return new Response(JSON.stringify({ error: 'Token no corresponde al empleado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!

    const imageBytes = await imagenFile.arrayBuffer()
    const hashImagen = await sha256Hex(imageBytes)

    // Layer 1: exact image hash duplicate
    const { data: existing } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('hash_imagen', hashImagen)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({ duplicado: true, ticket_original_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Upload image
    const extension = imagenFile.name.split('.').pop() ?? 'jpg'
    const storagePath = `${sucursalId}/${Date.now()}_${hashImagen.slice(0, 8)}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('por-revisar')
      .upload(storagePath, imageBytes, {
        contentType: imagenFile.type || 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return new Response(JSON.stringify({ error: 'Error al subir la imagen' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Load catalog for Gemini context
    const catalog = await loadCatalog()
    const catalogContext = buildCatalogPromptContext(catalog)
    const prompt = buildGeminiPrompt(catalogContext)

    // Call Gemini
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const imageBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes)))

    const result = await model.generateContent([
      { inlineData: { mimeType: imagenFile.type || 'image/jpeg', data: imageBase64 } },
      prompt,
    ])

    const geminiText = result.response.text().trim()

    let datosExtraidos: Record<string, unknown>
    try {
      const cleanJson = geminiText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      datosExtraidos = JSON.parse(cleanJson)
    } catch {
      console.error('Gemini JSON parse error. Raw:', geminiText)
      datosExtraidos = { raw_response: geminiText, confianza: 'baja' }
    }

    // Match product in catalog
    const matchedProduct: CatalogProduct | null = matchProductInCatalog(
      datosExtraidos.producto as string | null,
      catalog.products
    )

    // Resolve categoria_id
    let categoriaId: string | null = null
    if (matchedProduct) {
      const cat = catalog.categories.find(c => c.nombre === matchedProduct.categoria_nombre)
      categoriaId = cat?.id ?? null
    } else {
      const catName = (datosExtraidos.categoria_gasto as string || '').toLowerCase()
      const cat = catalog.categories.find(c => c.nombre.toLowerCase() === catName)
      categoriaId = cat?.id ?? null
    }

    // Insert record
    const { data: registro, error: insertError } = await supabase
      .from('registros_tickets')
      .insert({
        sucursal_id: sucursalId,
        empleado_id: empleadoId,
        hash_imagen: hashImagen,
        storage_path_original: storagePath,
        estado: 'pendiente',
        fecha_ticket: datosExtraidos.fecha ?? null,
        folio_ticket: datosExtraidos.folio_ticket ?? null,
        comercio: datosExtraidos.comercio ?? null,
        producto: datosExtraidos.producto ?? null,
        cantidad: datosExtraidos.cantidad ?? null,
        unidad: datosExtraidos.unidad ?? null,
        monto: datosExtraidos.monto ?? null,
        categoria_gasto: datosExtraidos.categoria_gasto ?? null,
        categoria_id: categoriaId,
        gemini_raw: datosExtraidos,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return new Response(JSON.stringify({ error: 'Error al guardar el registro' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Post-insert: smart duplicates, alerts, catalog updates
    const alertas: string[] = []

    // Layer 2+3: smart duplicate detection (folio + data similarity)
    const dupId = await detectSmartDuplicate(
      supabase, sucursalId,
      datosExtraidos.folio_ticket as string | null,
      datosExtraidos.comercio as string | null,
      datosExtraidos.monto as number | null,
      datosExtraidos.fecha as string | null
    )
    if (dupId && dupId !== registro.id) {
      await createAlert(supabase, registro.id, 'posible_duplicado', dupId)
      alertas.push('posible_duplicado')
      notifyAlertEmail(registro.id, 'posible_duplicado')
    }

    if (datosExtraidos.confianza === 'baja') {
      await createAlert(supabase, registro.id, 'ilegible')
      alertas.push('ilegible')
      notifyAlertEmail(registro.id, 'ilegible')
    }

    if (!matchedProduct && datosExtraidos.producto) {
      await createAlert(supabase, registro.id, 'producto_no_reconocido')
      alertas.push('producto_no_reconocido')
    }

    if (!datosExtraidos.unidad) {
      await createAlert(supabase, registro.id, 'sin_unidad')
      alertas.push('sin_unidad')
    }

    if (matchedProduct?.precio_referencia && datosExtraidos.monto) {
      if ((datosExtraidos.monto as number) > matchedProduct.precio_referencia * 1.5) {
        await createAlert(supabase, registro.id, 'monto_anomalo')
        alertas.push('monto_anomalo')
      }
    }

    // Increment match counter on catalog product
    if (matchedProduct) {
      await supabase.from('catalogo_productos')
        .update({ veces_matched: matchedProduct.veces_matched + 1 })
        .eq('id', matchedProduct.id)
    }

    return new Response(
      JSON.stringify({
        duplicado: false,
        registro_id: registro.id,
        datos_extraidos: datosExtraidos,
        alertas,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
