// Lectura de tickets con Gemini, compartida por procesar-ticket y reprocesar-ticket.
// - Llama a la API REST directo (sin SDK: @google/generative-ai quedo deprecado).
// - Reintenta por rondas cuando Google esta saturado (5xx/timeout) o limita por minuto (429).
// - Si se acaba la cuota DIARIA de un modelo, lo descarta y pasa al siguiente.
// - Si ningun modelo pudo leer, lo dice (fallo = 'cuota' | 'saturado' | ...) en vez de
//   fingir que el ticket es "ilegible".

export interface GeminiItem {
  descripcion?: string
  cantidad?: number | null
  unidad?: string | null
  monto?: number | null
  categoria?: string | null
}
export interface GeminiResult {
  comercio?: string | null
  fecha?: string | null
  folio_ticket?: string | null
  tipo_documento?: string | null
  subtotal?: number | null
  iva?: number | null
  ieps?: number | null
  monto_total?: number | null
  confianza?: string
  items?: GeminiItem[]
}

export type FalloIA = 'cuota' | 'saturado' | 'modelo_no_existe' | 'respuesta_invalida' | 'otro'

export interface LecturaIA {
  datos: GeminiResult | null
  modelo: string
  fallo: FalloIA | null
  error: string | null
  intentos: string[]
}

// Orden de preferencia. GEMINI_MODEL (secret, admite lista separada por comas) va primero.
// NO incluir modelos retirados: gemini-1.5-*, gemini-2.0-flash y gemini-2.0-flash-lite ya dan 404.
// Un modelo Gemini 3.x puede llevar nivel de razonamiento con '@': 'gemini-3.1-flash-lite@minimal'.
// Elegido con prueba sobre 22 tickets reales de Wings Palace (2026-09-18), contra lectura verdad:
//   3.8-flash: 17/22 perfectos, 99% renglones, 3 renglones basura, ~US$0.015/ticket
//   3.1-pro-preview: 13/22 (respaldo de otro modelo = otra cuota); 3.1-flash-lite@minimal: 10/22, barato.
//   2.5-flash (el anterior): 8/22, y podria apagarse el 16-oct-2026.
export const MODELOS_DEFAULT = ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite@minimal']

export function modelosCandidatos(): string[] {
  const env = (Deno.env.get('GEMINI_MODEL') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return [...env, ...MODELOS_DEFAULT].filter((m, i, a) => a.indexOf(m) === i)
}

export function buildGeminiPrompt(catalogContext: string, hoyISO: string): string {
  return `Analiza esta imagen de un ticket o comprobante de gasto de un restaurante en Mexico. Un ticket puede contener VARIOS productos (renglones). Extrae la informacion en este formato JSON exacto:
{
  "comercio": "nombre del establecimiento o proveedor que VENDE, o null",
  "fecha": "YYYY-MM-DD o null si no se puede determinar",
  "folio_ticket": "numero de ticket, nota, remision o factura, o null",
  "tipo_documento": "ticket | factura | nota_a_mano | remision | otro",
  "subtotal": numero antes de IVA si aparece, o null,
  "iva": numero de IVA si aparece desglosado, o null,
  "ieps": numero de IEPS si aparece desglosado aparte, o null,
  "monto_total": numero decimal del total a pagar, o null,
  "confianza": "alta si los datos son claros, media si algunos son ambiguos, baja si es ilegible o muy borroso",
  "items": [
    {
      "descripcion": "texto literal del producto tal como aparece en el ticket",
      "cantidad": numero o null,
      "unidad": "kg, g, pz, ml, lt, caja, bulto, paquete, rollo, galon u otro, o null si no se indica",
      "monto": numero decimal del importe de ese renglon o null,
      "categoria": "una de las categorias validas listadas abajo, o null si ninguna aplica"
    }
  ]
}

${catalogContext}

Reglas importantes:
- Crea un objeto dentro de "items" por CADA producto o renglon del ticket. No agrupes varios productos en uno.
- NO son renglones: subtotal, IVA, total, cambio, pago con tarjeta/efectivo, "cambio en monedero", litros, precio unitario, GPS, observaciones, leyendas legales ni datos del cliente. Un ticket de gas LP o gasolina tiene UN solo renglon: el combustible, con cantidad en litros y el monto total.
- "comercio" es quien VENDE (el emisor). Si el restaurante que compra aparece impreso como cliente o receptor (ej. "RESTAURANT WINGS PALACE"), ese NO es el comercio: busca el nombre del proveedor en el encabezado.
- La "descripcion" debe ser LITERAL: conserva codigos, abreviaturas y texto raro tal como lo lees. NO reemplaces la descripcion por el nombre del catalogo.
- FECHA: en Mexico se escribe dia/mes/año (DD/MM/AAAA o DD/MM/AA). Hoy es ${hoyISO}; el ticket es de las ultimas semanas o meses, nunca del futuro. Si lees un año imposible (ej. 2020, 2024 o 2028) en un ticket que claramente es reciente, corrigelo al año que corresponde y baja la confianza a "media".
- "tipo_documento": "factura" si es un CFDI / factura electronica (tiene RFC, folio fiscal o UUID, uso de CFDI); "remision" si es nota de entrega del proveedor; "nota_a_mano" si esta escrita a mano; "ticket" para tickets impresos de tienda.
- Asigna a cada renglon la categoria MAS ESPECIFICA que aplique de la lista de categorias validas. Si de plano ninguna aplica, usa null en "categoria".
- USA EL NOMBRE DEL COMERCIO para decidir la categoria. Ejemplos: en una gasolinera o "centro gasolinero", palabras como "gas", "magna", "premium", "diesel" son COMBUSTIBLE para auto, NO gas de cocina. En cambio "Gas LP", "gas de cocina" o un comercio de gas LP si es gas de cocina.
- Si un renglon esta abreviado, cortado o con error de dedo pero se parece a un producto conocido (ej. "popt" o "popote", "azuc" o "azucar", "serv" o "servilletas"), usa el catalogo SOLO para categoria/unidad. Conserva la descripcion literal leida.
- Si un producto coincide con uno de los productos conocidos (o uno de sus sinonimos/marcas), usa su categoria y unidad, pero NO cambies la descripcion literal.
- Si no se indica unidad y el producto se cuenta por pieza (latas, botellas, paquetes, piezas de fruta), usa "pz".
- Si una nota tiene UN SOLO producto y un total (ej. "alitas 50 pzas $850"), pon ese total como el "monto" de ese producto Y en "monto_total".
- Si una nota a mano tiene VARIOS productos sin precio por renglon pero un total general, deja "monto" en null en cada item y pon el total solo en "monto_total".
- Si el ticket tiene un DESCUENTO, promocion o rebaja (dinero que se resta del total), capturalo como un renglon APARTE: "descripcion": "Descuento", "categoria": "Descuentos" y "monto" NEGATIVO (el ahorro, ej. -50). No lo restes de los otros renglones.
- Incluye tambien el texto escrito a mano en tu analisis.
Responde UNICAMENTE con el JSON, sin explicaciones adicionales.`
}

// Fecha YYYY-MM-DD en hora de Mexico (America/Mexico_City). Evita que lo subido
// despues de las 18:00 quede con fecha del dia siguiente (UTC).
export function fechaMexico(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function fechaReal(fecha: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const t = Date.parse(fecha + 'T00:00:00Z')
  // Date.parse acepta 2026-02-30 (lo pasa a 2-mar); Postgres no. Exigir ida y vuelta exacta.
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== fecha) return null
  return t
}

const DIA = 864e5
// Ventana normal: un ticket se sube a mas tardar ~4 meses despues de la compra y nunca antes.
const VENTANA_NORMAL = 120

// Fecha real del calendario, no posterior a la referencia (dia de subida en hora de Mexico)
// y de los ultimos ~4 meses. Atrapa años mal leidos (2020/2024/2028) y dia/mes volteados.
export function fechaPlausible(fecha: string | null | undefined, refISO: string): boolean {
  if (!fecha) return false
  const t = fechaReal(fecha)
  const h = fechaReal(refISO)
  if (t === null || h === null) return false
  // +1 dia de tolerancia: el borde de medianoche entre la hora del ticket y la de subida.
  return t <= h + DIA && t >= h - VENTANA_NORMAL * DIA
}

// Decide la fecha a guardar. asumida=true => alerta 'sin_fecha' ("Fecha asumida") para revisarla.
// 1) Fecha leida dentro de los ultimos ~4 meses: se usa tal cual.
// 2) Mismo dia/mes en el año de subida o el anterior, si cae en la ventana (2024-07-31 -> 2026-07-31).
// 3) Dia y mes volteados (DD/MM <-> MM/DD) si cae en la ventana.
// 4) Fecha leida real de hace 4-13 meses: se conserva, pero asumida (rara, hay que verla).
// 5) Si nada sirve, la fecha de subida.
export function resolverFecha(leida: string | null | undefined, refISO: string): { fecha: string; asumida: boolean } {
  if (leida && fechaPlausible(leida, refISO)) return { fecha: leida, asumida: false }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(leida ?? '')
  if (m) {
    const anio = Number(refISO.slice(0, 4))
    for (const y of [anio, anio - 1]) {
      const cand = `${y}-${m[2]}-${m[3]}`
      if (fechaPlausible(cand, refISO)) return { fecha: cand, asumida: true }
    }
    if (Number(m[3]) <= 12) {
      for (const y of [m[1], String(anio)]) {
        const cand = `${y}-${m[3]}-${m[2]}`
        if (fechaPlausible(cand, refISO)) return { fecha: cand, asumida: true }
      }
    }
    const t = fechaReal(leida!)
    const h = fechaReal(refISO)
    if (t !== null && h !== null && t <= h + DIA && t >= h - 400 * DIA) return { fecha: leida!, asumida: true }
  }
  return { fecha: refISO, asumida: true }
}

function parseGemini(text: string): GeminiResult {
  const clean = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const datos = JSON.parse(clean)
  // Debe ser un objeto; un arreglo o un valor suelto no es una lectura valida.
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('la respuesta no es un objeto JSON')
  return datos as GeminiResult
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Lee el tipo de 429: cuota diaria (no sirve reintentar ese modelo hoy) o por minuto.
function info429(body: string): { diaria: boolean; esperaMs: number } {
  let diaria = /per ?day|PerDay|daily/i.test(body)
  let esperaMs = 10_000
  try {
    // deno-lint-ignore no-explicit-any
    const j = JSON.parse(body) as any
    // deno-lint-ignore no-explicit-any
    for (const d of (j?.error?.details ?? []) as any[]) {
      if (typeof d?.retryDelay === 'string') {
        const s = parseFloat(d.retryDelay)
        if (Number.isFinite(s)) esperaMs = Math.min(Math.max(s * 1000, 2_000), 30_000)
      }
      // deno-lint-ignore no-explicit-any
      for (const v of (d?.violations ?? []) as any[]) {
        if (/PerDay/i.test(String(v?.quotaId ?? ''))) diaria = true
      }
    }
  } catch { /* cuerpo no JSON */ }
  return { diaria, esperaMs }
}

// Lee la imagen con el primer modelo que responda. Trabaja por RONDAS: en cada ronda
// prueba una vez cada modelo aun "vivo"; si todos fallan por algo pasajero (saturado,
// timeout, limite por minuto) espera y hace otra ronda. Un modelo queda descartado si da
// 404, 400 o cuota DIARIA agotada. deadlineMs limita el tiempo total (tope de reloj de
// los procesos en segundo plano de Supabase).
export async function leerTicketConGemini(opts: {
  imagenBase64: string
  mimeType: string
  prompt: string
  deadlineMs?: number
  modelos?: string[] // fuerza estos modelos (p.ej. para comparar); por defecto modelosCandidatos()
}): Promise<LecturaIA> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const limite = Date.now() + (opts.deadlineMs ?? 110_000)
  const modelos = opts.modelos?.length ? opts.modelos : modelosCandidatos()
  const intentos: string[] = []
  const ultimoFallo = new Map<string, FalloIA>() // ultimo fallo de cada modelo
  const descartados = new Set<string>()
  let ultimoError = ''
  let esperaSugerida = 0

  for (let ronda = 0; ronda < 3 && Date.now() < limite; ronda++) {
    if (ronda > 0) {
      const espera = Math.max(esperaSugerida, [0, 3_000, 8_000][ronda]) + Math.floor(Math.random() * 1_000)
      if (Date.now() + espera + 5_000 > limite) break
      await sleep(espera)
      esperaSugerida = 0
    }
    for (const modelo of modelos) {
      if (descartados.has(modelo)) continue
      const restante = limite - Date.now()
      if (restante < 5_000) break
      const [idModelo, nivel] = modelo.split('@')
      let status = 0
      let body = ''
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${idModelo}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [
                  { inline_data: { mime_type: opts.mimeType, data: opts.imagenBase64 } },
                  { text: opts.prompt },
                ],
              }],
              // Sin temperature/top_p/top_k: los modelos Gemini 3.x los rechazan (deprecados 21-jul-2026).
              generationConfig: {
                responseMimeType: 'application/json',
                ...(nivel ? { thinkingConfig: { thinkingLevel: nivel } } : {}),
              },
            }),
            // Una lectura normal tarda ~10-25 s; 45 s maximo por intento deja tiempo al respaldo.
            signal: AbortSignal.timeout(Math.min(45_000, restante)),
          },
        )
        status = res.status
        body = await res.text()
      } catch (err) {
        status = 0
        body = String(err)
      }

      if (status === 200) {
        try {
          // deno-lint-ignore no-explicit-any
          const j = JSON.parse(body) as any
          // deno-lint-ignore no-explicit-any
          const parts = (j?.candidates?.[0]?.content?.parts ?? []) as any[]
          const text = parts.filter(p => typeof p?.text === 'string' && !p?.thought).map(p => p.text).join('')
          const datos = parseGemini(text)
          intentos.push(`${modelo}:ok`)
          // Consumo real de tokens (incluye "thinking") para medir el costo por ticket.
          const u = j?.usageMetadata
          if (u) (datos as Record<string, unknown>)._uso = {
            entrada: u.promptTokenCount ?? null, salida: u.candidatesTokenCount ?? null,
            pensamiento: u.thoughtsTokenCount ?? null, total: u.totalTokenCount ?? null,
          }
          return { datos, modelo, fallo: null, error: null, intentos }
        } catch (err) {
          intentos.push(`${modelo}:json_invalido`)
          ultimoError = `respuesta invalida (${modelo}): ${String(err).slice(0, 200)}`
          ultimoFallo.set(modelo, 'respuesta_invalida')
          continue
        }
      }

      ultimoError = `${modelo} HTTP ${status}: ${body.slice(0, 300)}`
      console.error('Gemini:', ultimoError)
      if (status === 404) {
        intentos.push(`${modelo}:404`); ultimoFallo.set(modelo, 'modelo_no_existe'); descartados.add(modelo)
      } else if (status === 429) {
        const { diaria, esperaMs } = info429(body)
        intentos.push(`${modelo}:429${diaria ? '_dia' : ''}`)
        ultimoFallo.set(modelo, 'cuota')
        if (diaria) descartados.add(modelo)
        else esperaSugerida = Math.max(esperaSugerida, esperaMs)
      } else if (status === 0 || status >= 500) {
        intentos.push(`${modelo}:${status || 'timeout_o_red'}`)
        ultimoFallo.set(modelo, 'saturado')
      } else if (status === 401 || status === 403) {
        // La llave no sirve; otro modelo no lo arregla.
        intentos.push(`${modelo}:${status}`)
        return { datos: null, modelo: '', fallo: 'otro', error: ultimoError, intentos }
      } else {
        // 400 u otro: puede ser un parametro que este modelo no acepta; probar el siguiente.
        intentos.push(`${modelo}:${status}`); ultimoFallo.set(modelo, 'otro'); descartados.add(modelo)
      }
    }
    if (modelos.every(m => descartados.has(m))) break
  }

  // 'cuota' solo si TODOS los modelos intentados terminaron sin cuota; si alguno quedo
  // saturado/timeout, es algo pasajero ('saturado').
  const f = [...ultimoFallo.values()]
  const fallo: FalloIA =
    f.length && f.every(x => x === 'cuota') ? 'cuota'
    : f.includes('saturado') ? 'saturado'
    : f.includes('cuota') ? 'cuota'
    : f.includes('respuesta_invalida') ? 'respuesta_invalida'
    : f.length && f.every(x => x === 'modelo_no_existe') ? 'modelo_no_existe'
    : 'otro'
  return { datos: null, modelo: '', fallo, error: ultimoError || 'sin respuesta', intentos }
}

// Texto corto para el admin segun el tipo de falla.
export function explicarFallo(fallo: FalloIA | null): string {
  switch (fallo) {
    case 'cuota': return 'Google Gemini sin cuota disponible (limite diario o por minuto). Se puede releer mas tarde.'
    case 'saturado': return 'Google Gemini saturado o sin respuesta. Se puede releer en unos minutos.'
    case 'modelo_no_existe': return 'El modelo de IA configurado ya no existe. Revisar GEMINI_MODEL.'
    case 'respuesta_invalida': return 'La IA respondio algo que no es JSON valido.'
    default: return 'La IA no pudo leer el ticket.'
  }
}
