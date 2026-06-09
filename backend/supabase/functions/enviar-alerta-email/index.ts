import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RESEND_API = 'https://api.resend.com/emails'
const ADMIN_EMAIL = 'alepolch@gmail.com'
const ALERT_TYPES_EMAIL = ['duplicado', 'posible_duplicado', 'ilegible']

const ALERT_LABELS: Record<string, string> = {
  duplicado: 'Ticket duplicado detectado',
  posible_duplicado: 'Posible ticket duplicado',
  ilegible: 'Ticket ilegible',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Interno: solo se invoca desde procesar-ticket con el service role key.
    // Cierra el endpoint a llamadas externas (filtraba datos del ticket / spam).
    const auth = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    if (auth !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { registro_ticket_id, tipo } = await req.json()

    if (!ALERT_TYPES_EMAIL.includes(tipo)) {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY not configured')
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: ticket } = await supabase
      .from('registros_tickets')
      .select('comercio, monto, fecha_ticket, sucursales:sucursal_id(nombre)')
      .eq('id', registro_ticket_id)
      .single()

    const sucursal = (ticket?.sucursales as { nombre: string })?.nombre ?? 'Desconocida'
    const label = ALERT_LABELS[tipo] ?? tipo
    const subject = `${label} - ${sucursal}`

    const body = `
      <h2>${label}</h2>
      <p><strong>Sucursal:</strong> ${sucursal}</p>
      <p><strong>Comercio:</strong> ${ticket?.comercio ?? 'No detectado'}</p>
      <p><strong>Monto:</strong> $${ticket?.monto ?? '?'}</p>
      <p><strong>Fecha:</strong> ${ticket?.fecha_ticket ?? 'No detectada'}</p>
      <br>
      <p><a href="https://tickets-se.vercel.app/admin/alertas">Ver en el panel de administracion</a></p>
    `

    const emailRes = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Tickets SE <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject,
        html: body,
      }),
    })

    const emailResult = await emailRes.json()
    return new Response(JSON.stringify({ sent: true, id: emailResult.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Email error:', err)
    return new Response(JSON.stringify({ error: 'Error sending email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
