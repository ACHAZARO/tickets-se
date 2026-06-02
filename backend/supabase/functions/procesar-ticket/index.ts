import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

const GEMINI_PROMPT = `Analiza esta imagen de un ticket o comprobante de gasto y extrae la siguiente información en formato JSON:
{
  "fecha": "YYYY-MM-DD o null si no se puede determinar",
  "comercio": "nombre del establecimiento o null",
  "producto": "descripción del producto o servicio principal o null",
  "cantidad": número o null,
  "monto": número decimal o null,
  "categoria_gasto": "una de: alimentos, bebidas, limpieza, mantenimiento, servicios, papeleria, otro"
}
Si hay texto escrito a mano, también inclúyelo en tu análisis.
Responde ÚNICAMENTE con el JSON, sin explicaciones adicionales.`

async function verifySessionToken(
  token: string,
  jwtSecret: string
): Promise<{ sub: string; slug: string } | null> {
  try {
    const keyData = new TextEncoder().encode(jwtSecret)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
    const payload = await verify(token, cryptoKey) as { sub: string; slug: string }
    return payload
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

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate session token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Token de sesión requerido' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwtSecret = Deno.env.get('JWT_SECRET')!
    const token = authHeader.slice(7)
    const sessionPayload = await verifySessionToken(token, jwtSecret)

    if (!sessionPayload) {
      return new Response(JSON.stringify({ error: 'Token de sesión inválido o expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse multipart form data
    const formData = await req.formData()
    const imagenFile = formData.get('imagen') as File | null
    const sucursalId = formData.get('sucursal_id') as string | null
    const empleadoId = formData.get('empleado_id') as string | null

    if (!imagenFile || !sucursalId || !empleadoId) {
      return new Response(
        JSON.stringify({ error: 'imagen, sucursal_id y empleado_id son requeridos' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Verify empleado_id matches token subject
    if (sessionPayload.sub !== empleadoId) {
      return new Response(JSON.stringify({ error: 'Token no corresponde al empleado' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Read image bytes
    const imageBytes = await imagenFile.arrayBuffer()

    // Calculate SHA-256 hash for duplicate detection
    const hashImagen = await sha256Hex(imageBytes)

    // Check for duplicates
    const { data: existing, error: dupError } = await supabase
      .from('registros_tickets')
      .select('id')
      .eq('hash_imagen', hashImagen)
      .maybeSingle()

    if (dupError) {
      console.error('Duplicate check error:', dupError)
    }

    if (existing) {
      return new Response(
        JSON.stringify({ duplicado: true, ticket_original_id: existing.id }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Upload image to Storage bucket 'por-revisar'
    const timestamp = Date.now()
    const extension = imagenFile.name.split('.').pop() ?? 'jpg'
    const storagePath = `${sucursalId}/${timestamp}_${hashImagen.slice(0, 8)}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('por-revisar')
      .upload(storagePath, imageBytes, {
        contentType: imagenFile.type || 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return new Response(JSON.stringify({ error: 'Error al subir la imagen' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Call Gemini 1.5 Flash
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const imageBase64 = btoa(
      String.fromCharCode(...new Uint8Array(imageBytes))
    )

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: imagenFile.type || 'image/jpeg',
          data: imageBase64,
        },
      },
      GEMINI_PROMPT,
    ])

    const geminiText = result.response.text().trim()

    // Parse Gemini response — strip markdown code fences if present
    let datosExtraidos: Record<string, unknown>
    try {
      const cleanJson = geminiText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      datosExtraidos = JSON.parse(cleanJson)
    } catch {
      console.error('Gemini JSON parse error. Raw:', geminiText)
      datosExtraidos = { raw_response: geminiText }
    }

    // Insert record in registros_tickets with estado 'pendiente'
    const { data: registro, error: insertError } = await supabase
      .from('registros_tickets')
      .insert({
        sucursal_id: sucursalId,
        empleado_id: empleadoId,
        hash_imagen: hashImagen,
        storage_path_original: storagePath,
        estado: 'pendiente',
        fecha_ticket: datosExtraidos.fecha ?? null,
        comercio: datosExtraidos.comercio ?? null,
        producto: datosExtraidos.producto ?? null,
        cantidad: datosExtraidos.cantidad ?? null,
        monto: datosExtraidos.monto ?? null,
        categoria_gasto: datosExtraidos.categoria_gasto ?? null,
        gemini_raw: datosExtraidos,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return new Response(JSON.stringify({ error: 'Error al guardar el registro' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        duplicado: false,
        registro_id: registro.id,
        datos_extraidos: datosExtraidos,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
