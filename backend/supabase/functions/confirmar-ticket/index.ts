import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

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

// Stub: placeholder for Google Sheets integration
async function enviarAGoogleSheets(registro: Record<string, unknown>): Promise<void> {
  // TODO: Implement Google Sheets API call
  // 1. Authenticate with a service account (GOOGLE_SERVICE_ACCOUNT_KEY env var)
  // 2. Determine target spreadsheet (GOOGLE_SHEETS_ID env var)
  // 3. Determine sheet tab by current month (e.g. "2024-06")
  // 4. Append a row with: fecha, comercio, producto, cantidad, monto, categoria, sucursal, empleado, storage_path
  console.log('[Google Sheets stub] Registro a enviar:', registro)
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

    // Fetch the pending record — also verify it belongs to the session's empleado
    const { data: registro, error: fetchError } = await supabase
      .from('registros_tickets')
      .select('*')
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

    // Build archive path: archivo/YYYY-MM/<original_filename>
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const originalFilename = registro.storage_path.split('/').pop()!
    const archivoPath = `${yearMonth}/${originalFilename}`

    // Move file: copy to 'archivo' bucket then delete from 'por-revisar'
    const { error: copyError } = await supabase.storage
      .from('archivo')
      .copy(archivoPath, registro.storage_path, { sourceStorage: 'por-revisar' } as never)

    if (copyError) {
      // Supabase Storage doesn't have a native cross-bucket copy via JS SDK yet.
      // Workaround: download then upload.
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('por-revisar')
        .download(registro.storage_path)

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
    }

    // Delete from 'por-revisar'
    await supabase.storage.from('por-revisar').remove([registro.storage_path])

    // Update record: estado → 'confirmado', update storage_path to archive path
    const { error: updateError } = await supabase
      .from('registros_tickets')
      .update({
        estado: 'confirmado',
        storage_path: archivoPath,
        confirmado_en: new Date().toISOString(),
      })
      .eq('id', registro_id)

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(JSON.stringify({ error: 'Error al actualizar el registro' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Send to Google Sheets (stub)
    await enviarAGoogleSheets({ ...registro, storage_path: archivoPath, estado: 'confirmado' })

    return new Response(JSON.stringify({ success: true }), {
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
