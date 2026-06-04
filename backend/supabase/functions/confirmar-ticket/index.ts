import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { enviarAGoogleSheets } from '../_shared/google-sheets.ts'

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

serve(async (req: Request) => {
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

    const { registro_id } = await req.json()

    if (!registro_id) {
      return new Response(JSON.stringify({ error: 'registro_id es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: registro, error: fetchError } = await supabase
      .from('registros_tickets')
      .select(`
        *,
        sucursales:sucursal_id ( nombre ),
        empleados:empleado_id ( nombre )
      `)
      .eq('id', registro_id)
      .eq('empleado_id', sessionPayload.sub)
      .eq('estado', 'pendiente')
      .single()

    if (fetchError || !registro) {
      return new Response(
        JSON.stringify({ error: 'Registro no encontrado o ya procesado' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Build archive path
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const originalPath = registro.storage_path_original
    const originalFilename = originalPath?.split('/').pop() ?? `${registro_id}.jpg`
    const archivoPath = `${yearMonth}/${originalFilename}`

    // Move file: download from por-revisar, upload to archivo
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('por-revisar')
      .download(originalPath)

    if (downloadError || !fileData) {
      console.error('Download error:', downloadError)
      return new Response(JSON.stringify({ error: 'Error al mover la imagen' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fileBuffer = await fileData.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('archivo')
      .upload(archivoPath, fileBuffer, {
        contentType: fileData.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Archive upload error:', uploadError)
      return new Response(JSON.stringify({ error: 'Error al archivar la imagen' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await supabase.storage.from('por-revisar').remove([originalPath])

    const confirmadoEn = now.toISOString()

    // Items del ticket (multi-producto). Fallback al registro legacy si no hay items.
    const { data: itemsData } = await supabase
      .from('ticket_items')
      .select('descripcion, cantidad, unidad, monto, categorias_gasto:categoria_id ( nombre )')
      .eq('registro_ticket_id', registro_id)

    const items = (itemsData ?? []).map((it: Record<string, unknown>) => ({
      descripcion: (it.descripcion as string) ?? null,
      cantidad: (it.cantidad as number) ?? null,
      unidad: (it.unidad as string) ?? null,
      monto: (it.monto as number) ?? null,
      categoria_gasto: (it.categorias_gasto as { nombre: string } | null)?.nombre ?? null,
    }))

    const itemsForSheet = items.length ? items : [{
      descripcion: registro.producto ?? null,
      cantidad: registro.cantidad ?? null,
      unidad: registro.unidad ?? null,
      monto: registro.monto ?? null,
      categoria_gasto: registro.categoria_gasto ?? null,
    }]

    // Send to Google Sheets (una fila por item)
    let sheetsRowId: string | null = null
    try {
      sheetsRowId = await enviarAGoogleSheets({
        fecha_ticket: registro.fecha_ticket,
        folio_ticket: registro.folio_ticket,
        comercio: registro.comercio,
        sucursal_nombre: registro.sucursales?.nombre ?? sessionPayload.slug,
        empleado_nombre: registro.empleados?.nombre ?? 'Desconocido',
        storage_path: archivoPath,
        confirmado_en: confirmadoEn,
        items: itemsForSheet,
      })
    } catch (sheetsErr) {
      console.error('Google Sheets error (non-blocking):', sheetsErr)
    }

    const { error: updateError } = await supabase
      .from('registros_tickets')
      .update({
        estado: 'confirmado',
        storage_path_archivo: archivoPath,
        confirmado_en: confirmadoEn,
        sheets_row_id: sheetsRowId,
      })
      .eq('id', registro_id)

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(JSON.stringify({ error: 'Error al actualizar el registro' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, sheets_row: sheetsRowId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
