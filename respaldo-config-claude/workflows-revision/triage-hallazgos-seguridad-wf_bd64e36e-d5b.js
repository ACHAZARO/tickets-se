export const meta = {
  name: 'triage-hallazgos-seguridad',
  description: 'Verificacion adversarial de hallazgos sin confirmar de la auditoria de Revision de Tickets',
  phases: [
    { title: 'Verificar', detail: 'un agente esceptico por hallazgo' },
  ],
}

const ROOT = 'C:/Users/koach/Documents/Claude/Projects/revisión de tickets'

const VERDICT = {
  type: 'object',
  required: ['isReal', 'severity', 'evidence', 'reasoning'],
  properties: {
    isReal: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
    evidence: { type: 'string', description: 'cita archivo:linea y el codigo exacto que prueba o refuta' },
    reasoning: { type: 'string' },
    fix: { type: 'string', description: 'fix concreto si es real, o vacio' },
    needsProdDeploy: { type: 'boolean', description: 'true si el fix toca edge functions/migraciones/comportamiento de produccion' }
  }
}

const COMMON = 'Eres un VERIFICADOR ADVERSARIAL senior de la web app "Revision de Tickets" (tickets-se): Next.js 14 en /frontend, Supabase Edge Functions (Deno) en /backend/supabase/functions, migraciones SQL en /supabase/migrations. Raiz: "' + ROOT + '". Modelo de auth: el kiosko usa un JWT de sesion HMAC propio (verificar-pin -> procesar-ticket con verify_jwt=false); el admin usa Supabase Auth (RLS via is_admin()/admin_users). Las edge functions admin (confirmar-admin, reprocesar-ticket) validan admin REAL en codigo. Tu trabajo: determinar si el hallazgo es REAL y accionable, o FALSO POSITIVO / ya mitigado. Se ESCEPTICO: si otra capa ya lo cubre, marca isReal=false. Lee los archivos citados con Read/Grep/Bash antes de concluir. Cita evidencia concreta (archivo:linea). Severidad realista para una app que se quiere vender. Tu texto final es un dato de retorno, no un mensaje para humanos. '

const FINDINGS = [
  {
    key: 'cors',
    prompt: COMMON + 'HALLAZGO: "CORS abierto a cualquier origen (Access-Control-Allow-Origin: *) en todas las edge functions". Lee backend/supabase/functions/_shared/cors.ts y como se usa. Evalua el RIESGO REAL considerando que estas APIs usan tokens en el header Authorization (NO cookies, NO credenciales de navegador). Un CORS * SIN credenciales es practica estandar y comun para APIs con bearer token. Determina si es un riesgo real explotable o un falso positivo. Considera tambien si algun endpoint deberia restringir origenes.'
  },
  {
    key: 'storage',
    prompt: COMMON + 'HALLAZGO: "Politicas de storage de los buckets por-revisar/archivo permiten acceso indebido". Lee supabase/migrations/011_storage_admin_read.sql y cualquier migracion de storage. Usa Bash con curl si quieres reproducir, pero NO tienes credenciales admin; razona desde las policies. Determina si un usuario anonimo o authenticated-no-admin puede LEER, SUBIR o BORRAR objetos de los buckets privados por-revisar/archivo. Los buckets deben ser privados; el admin los ve via signed URLs. Verifica que las policies de storage.objects realmente exijan is_admin() para SELECT y que no haya policy publica de lectura/escritura.'
  },
  {
    key: 'sheets-injection',
    prompt: COMMON + 'HALLAZGO: "Inyeccion de formulas en Google Sheets". Lee backend/supabase/functions/_shared/google-sheets.ts. Fija si los valores (descripcion del producto, comercio, etc., que vienen de OCR de Gemini sobre fotos subidas por gerentes) se escriben con valueInputOption=USER_ENTERED. Si un valor empieza con = + - @ podria interpretarse como FORMULA en Sheets (formula/CSV injection). Evalua el riesgo real (los gerentes son semi-confiables, pero el texto viene de OCR de imagenes arbitrarias) y propon el fix concreto (RAW en vez de USER_ENTERED, o prefijar con apostrofo los valores que empiezan con caracteres de formula). Nota: cambiar a RAW afecta como se ven numeros/fechas en Sheets — considera el fix de prefijo como mas seguro.'
  },
  {
    key: 'optimistic-mutations',
    prompt: COMMON + 'HALLAZGO: "Mutaciones criticas ignoran el error y refrescan la UI de forma optimista (el usuario cree que se guardo aunque fallo)". Revisa los handlers en frontend/app/admin/tickets/page.tsx (marcarSospechoso, resolverSospecha, guardarMotivo, actualizarHeader, borrarRenglon, syncTicketTotal) y en frontend/app/admin/catalogo/page.tsx, comercios/page.tsx, sucursales/page.tsx. Identifica los casos donde se hace supabase...update/insert/delete SIN revisar `error` y se actualiza el estado local igual (refresh optimista que miente si fallo). NOTA: ya se arreglo confirmarTicket, guardarItemTicket y ensureProduct en tickets/page.tsx — no los marques. Enfocate en los OTROS. Devuelve la lista concreta de handlers afectados con archivo:linea.'
  },
  {
    key: 'limit-sin-order',
    prompt: COMMON + 'HALLAZGO: "Queries con .limit() sin ORDER BY (resultados no deterministas; al crecer los datos puede traer filas equivocadas)". Usa Grep para encontrar `.limit(` en frontend/ y backend/supabase/functions/. Para cada uno, revisa si tiene un .order() acompanante. Determina cuales son riesgo REAL (ej. .limit(1).maybeSingle() esperando "el mas reciente" sin order by created_at desc traeria una fila arbitraria) vs cuales no importan (ej. limites de paginacion con order, o donde cualquier fila sirve). Devuelve la lista concreta de los problematicos con archivo:linea y por que importa.'
  }
]

phase('Verificar')
log('Lanzando ' + FINDINGS.length + ' verificadores esceptingos en paralelo')

const verdicts = await parallel(FINDINGS.map(f => () =>
  agent(f.prompt, { label: 'verify:' + f.key, phase: 'Verificar', schema: VERDICT })
    .then(v => ({ key: f.key, ...v }))
))

const real = verdicts.filter(Boolean).filter(v => v.isReal)
const falsos = verdicts.filter(Boolean).filter(v => !v.isReal)

log('Reales: ' + real.length + ' · Falsos positivos: ' + falsos.length)

const rank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
real.sort((a, b) => rank[a.severity] - rank[b.severity])

return {
  confirmados: real,
  descartados: falsos.map(v => ({ key: v.key, severity: v.severity, reasoning: v.reasoning }))
}
