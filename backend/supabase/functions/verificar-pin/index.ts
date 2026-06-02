import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

// Simple in-memory rate limiting (resets on cold start)
// For production, consider a Redis/KV store or a Supabase table
const attemptLog = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attemptLog.get(key)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attemptLog.set(key, { count: 1, windowStart: now })
    return false
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true
  }

  entry.count++
  return false
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

    const { slug, pin } = await req.json()

    if (!slug || !pin) {
      return new Response(JSON.stringify({ error: 'slug y pin son requeridos' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limiting per slug
    const rateLimitKey = `pin:${slug}`
    if (isRateLimited(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: 'Demasiados intentos. Espera 60 segundos.' }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const jwtSecret = Deno.env.get('JWT_SECRET')!

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Call the SQL function verificar_pin
    const { data, error } = await supabase.rpc('verificar_pin', {
      p_slug: slug,
      p_pin: pin,
    })

    if (error) {
      console.error('RPC error:', error)
      return new Response(JSON.stringify({ error: 'Error al verificar PIN' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // verificar_pin returns a UUID if valid, null otherwise
    const empleadoId: string | null = data

    if (!empleadoId) {
      return new Response(JSON.stringify({ valid: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate a short-lived session JWT (1 hour)
    const keyData = new TextEncoder().encode(jwtSecret)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )

    const payload = {
      sub: empleadoId,
      slug,
      iat: getNumericDate(0),
      exp: getNumericDate(60 * 60), // 1 hour
    }

    const sessionToken = await create({ alg: 'HS256', typ: 'JWT' }, payload, cryptoKey)

    return new Response(
      JSON.stringify({ valid: true, empleado_id: empleadoId, session_token: sessionToken }),
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
