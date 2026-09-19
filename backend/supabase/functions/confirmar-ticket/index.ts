import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

// RETIRADA el 2026-09-19 (decision de Alejandro). Era el flujo viejo en el que el GERENTE confirmaba su propio ticket.
// Hoy confirma el admin desde /admin (confirmar-admin). Se retira porque con una sesion de PIN vigente un gerente podia
// confirmar su propio ticket, incluso uno marcado para revision o en fraude, saltandose al admin; ademas borraba la foto
// original antes de guardar el registro.
// Comprobado antes de retirarla: la app dejo de llamarla el 2026-06-09 (commit 531745f) y en los registros de llamadas
// los gerentes solo usan verificar-pin y procesar-ticket.
// El codigo anterior quedo en ../_archive/confirmar-ticket-2026-09-19.ts y en el historial de git.
serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(
    JSON.stringify({ error: 'Esta funcion se retiro. Los tickets los confirma el admin desde el panel.' }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
