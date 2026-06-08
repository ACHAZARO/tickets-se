import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  loadCatalog, buildCatalogPromptContext, matchProductInCatalog, resolveCategoria,
} from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'
import { enviarAGoogleSheets } from '../_shared/google-sheets.ts'

// EdgeRuntime.waitUntil permite seguir procesando despues de responder.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

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
      "descripcion": "texto literal del producto tal como aparece en el ticket",
      "cantidad": numero o null,
      "unidad": "kg, g (gramos), pz, ml, lt, caja, bulto, paquete, rollo, galon u otro, o null si no se indica",
      "monto": numero decimal del precio de ese renglon o null,
      "categoria": "una de las categorias validas listadas abajo, o null si ninguna aplica"
    }
  ]
}

${catalogContext}

Reglas importantes:
- Crea un objeto dentro de "items" por CADA producto o renglon del ticket. No agrupes varios productos en uno.
- La "descripcion" debe ser LITERAL: conserva codigos, abreviaturas y texto raro tal como lo lees. NO reemplaces la descripcion por el nombre del catalogo.
- Asigna a cada renglon la categoria MAS ESPECIFICA que aplique de la lista de categorias validas. Si de plano ninguna aplica, usa null en "categoria".
- USA EL NOMBRE DEL COMERCIO para decidir la categoria. Ejemplos: en una gasolinera o "centro gasolinero", palabras como "gas", "magna", "premium", "diesel" son COMBUSTIBLE para auto (categoria de gasolina/combustible), NO gas de cocina. En cambio "Gas LP", "gas de cocina" o un comercio tipo "Gas de Xalapa" si es gas de cocina.
- Si un renglon esta abreviado, cortado o con error de dedo pero se parece a un producto conocido (ej. "popt" o "popote", "azuc" o "azucar", "serv" o "servilletas"), usa el catalogo SOLO para categoria/unidad. Conserva la descripcion literal leida.
- Si un producto coincide con uno de los productos conocidos (o uno de sus sinonimos/marcas), usa su categoria y unidad, pero NO cambies la descripcion literal.
- Si una nota tiene UN SOLO producto y un total (ej. "alitas 50 pzas $850"), pon ese total como el "monto" de ese producto Y en "monto_total".
- Si una nota a mano tiene VARIOS productos sin precio por renglon pero un total general, deja "monto" en null en cada item y pon el total solo en "monto_total".
- Si el ticket tiene un DESCUENTO, promocion o rebaja (dinero que se resta del total), captúralo como un renglon APARTE: "descripcion": "Descuento", "categoria": "Descuentos" y "monto" NEGATIVO (el ahorro, ej. -50). No lo restes de los otros renglones.
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

// deno-lint-ignore no-explicit-any
type SB = any

async function detectSmartDuplicate(
  supabase: SB, sucursalId: string, folio: string | null,
  comercio: string | null, monto: number | null, fecha: string | null
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

async function createAlert(supabase: SB, registroId: string, tipo: string, dupId?: string): Promise<void> {
  await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId, tipo, duplicado_de_id: dupId ?? null,
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
  } catch (err) { console.error('Email notification error:', err) }
}

// Registra el comercio (sin forzar categoria: un comercio puede vender de varias,
// ej. Costco). Las categorias se infieren por observacion en loadCatalog.
// El admin puede fijar manualmente una categoria (categoria_id) como override.
async function aprenderComercio(
  supabase: SB, comercio: string | null, sucursalId: string
): Promise<void> {
  const nombre = comercio?.trim()
  if (!nombre) return
  try {
    const { data: ex } = await supabase.from('comercios').select('id, veces')
      .ilike('nombre', nombre).eq('sucursal_id', sucursalId).maybeSingle()
    if (ex) {
      await supabase.from('comercios').update({ veces: (ex.veces as number) + 1 }).eq('id', ex.id)
    } else {
      await supabase.from('comercios').insert({ nombre, sucursal_id: sucursalId })
    }
  } catch (e) { console.error('aprenderComercio:', e) }
}

// Agrega al catalogo los renglones que ya tienen categoria pero no estaban en
// el catalogo (producto_catalogo_id null). Asi la IA va aprendiendo sola.
async function aprenderProductos(
  supabase: SB, sucursalId: string,
  items: { descripcion: string; categoria_id: string | null; producto_catalogo_id: string | null; unidad: string | null }[]
): Promise<void> {
  const vistos = new Set<string>()
  for (const it of items) {
    if (!it.categoria_id || it.producto_catalogo_id) continue
    const nombre = it.descripcion?.trim()
    if (!nombre) continue
    const key = nombre.toLowerCase()
    if (vistos.has(key)) continue
    vistos.add(key)
    try {
      const { data: ex } = await supabase.from('catalogo_productos').select('id')
        .ilike('nombre', nombre).or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`).limit(1).maybeSingle()
      if (ex) continue
      await supabase.from('catalogo_productos').insert({
        nombre, sinonimos: [], categoria_id: it.categoria_id,
        unidad_default: it.unidad ?? null, sucursal_id: sucursalId,
      })
    } catch (e) { console.error('aprenderProductos:', e) }
  }
}

// Registra el precio unitario (monto/cantidad) de cada renglon ligado a un producto,
// guarda historial y detecta saltos fuertes vs el precio de referencia.
async function registrarPrecios(
  supabase: SB,
  items: { producto_catalogo_id: string | null; monto: number | null; cantidad: number | null; unidad: string | null }[],
  catalog: Catalog, sucursalId: string, registroId: string, fecha: string
): Promise<boolean> {
  let anomalia = false
  for (const it of items) {
    const pid = it.producto_catalogo_id
    const monto = Number(it.monto)
    const cant = Number(it.cantidad)
    if (!pid || !Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
    const unit = monto / cant
    const prod = catalog.products.find(p => p.id === pid)
    try {
      // Compara contra el promedio de hasta 5 compras previas (no contra una sola),
      // y solo si ya hay >=2 registros (para no alertar mientras se forma la base).
      const { data: previos } = await supabase.from('precio_historial')
        .select('precio_unitario').eq('producto_catalogo_id', pid)
        .order('created_at', { ascending: false }).limit(5)
      await supabase.from('precio_historial').insert({
        producto_catalogo_id: pid, sucursal_id: sucursalId,
        registro_ticket_id: registroId, precio_unitario: unit, fecha,
      })
      await supabase.from('catalogo_productos').update({ precio_referencia: unit }).eq('id', pid)

      const prev = (previos ?? []).map((r: { precio_unitario: number }) => Number(r.precio_unitario))
        .filter((n: number) => Number.isFinite(n) && n > 0)
      // misma unidad: si el producto tiene unidad_default, el renglon debe coincidir
      const mismaUnidad = !prod?.unidad_default || !it.unidad || it.unidad === prod.unidad_default
      if (prev.length >= 2 && mismaUnidad) {
        const avg = prev.reduce((s: number, n: number) => s + n, 0) / prev.length
        if (avg > 0) {
          const ratio = unit / avg
          if (ratio > 1.4 || ratio < 0.6) anomalia = true // +40% o -40% vs promedio
        }
      }
    } catch (e) { console.error('registrarPrecios:', e) }
  }
  return anomalia
}

function parseGemini(text: string): GeminiResult {
  const clean = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(clean) as GeminiResult
}

async function callGeminiWithFallback(
  genAI: GoogleGenerativeAI, imagePart: unknown, prompt: string
): Promise<{ datos: GeminiResult; modelo: string }> {
  const envModel = Deno.env.get('GEMINI_MODEL')
  const candidatos = [
    ...(envModel ? [envModel] : []),
    'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-1.5-flash-latest',
  ].filter((m, i, a) => a.indexOf(m) === i)

  let lastErr = ''
  for (const mname of candidatos) {
    try {
      const model = genAI.getGenerativeModel({ model: mname })
      // deno-lint-ignore no-explicit-any
      const result = await model.generateContent([imagePart as any, prompt])
      return { datos: parseGemini(result.response.text()), modelo: mname }
    } catch (err) {
      lastErr = String(err)
      console.error(`Gemini fallo con ${mname}:`, lastErr.slice(0, 160))
    }
  }
  return { datos: { confianza: 'baja', items: [], _error: lastErr } as GeminiResult, modelo: '' }
}

// Procesamiento pesado en segundo plano: Gemini + items + alertas + auto-confirma.
async function procesarEnSegundoPlano(opts: {
  supabase: SB; registroId: string; sucursalId: string; empleadoId: string
  imageBytes: ArrayBuffer; mime: string; storagePath: string
}): Promise<void> {
  const { supabase, registroId, sucursalId, empleadoId, imageBytes, mime, storagePath } = opts
  try {
    const catalog: Catalog = await loadCatalog(sucursalId)
    const prompt = buildGeminiPrompt(buildCatalogPromptContext(catalog))
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY')!)
    const imagePart = { inlineData: { mimeType: mime, data: encodeBase64(imageBytes) } }

    const { datos, modelo } = await callGeminiWithFallback(genAI, imagePart, prompt)
    ;(datos as Record<string, unknown>)._modelo = modelo

    let rawItems: GeminiItem[] = Array.isArray(datos.items) ? datos.items : []
    rawItems = rawItems.filter(it => it && (it.descripcion || it.monto != null))
    const montoTotal = datos.monto_total ?? (rawItems.length
      ? rawItems.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null : null)

    // Si Gemini no leyo una fecha valida, usar la fecha de subida (hoy) para que
    // el ticket NO quede invisible en el arqueo/lista (filtrados por fecha).
    const hoy = new Date().toISOString().slice(0, 10)
    const fechaValida = !!(datos.fecha && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha))
    const fechaTicket = fechaValida ? datos.fecha! : hoy
    if (!fechaValida) (datos as Record<string, unknown>)._fecha_asumida = true

    await supabase.from('registros_tickets').update({
      fecha_ticket: fechaTicket,
      folio_ticket: datos.folio_ticket ?? null,
      comercio: datos.comercio ?? null,
      monto: montoTotal,
      gemini_raw: datos as unknown as Record<string, unknown>,
    }).eq('id', registroId)

    const matchedIds = new Set<string>()
    let anySinCategoria = false
    let anySinUnidad = false
    let anyProductoNuevo = false
    const itemsToInsert = (rawItems.length ? rawItems : [
      { descripcion: datos.comercio ?? 'Ticket', monto: montoTotal, categoria: null, unidad: null, cantidad: null },
    ]).map(it => {
      const desc = (it.descripcion ?? 'Producto').toString().slice(0, 500)
      const matched = matchProductInCatalog(desc, catalog.products)
      if (matched) matchedIds.add(matched.id)
      let cat = resolveCategoria(it.categoria ?? null, catalog.categories)
      if (!cat && matched) cat = resolveCategoria(matched.categoria_nombre, catalog.categories)
      const unidad = (it.unidad && String(it.unidad).trim()) || matched?.unidad_default || null
      let necesita = false, motivo: string | null = null
      if (!cat) { necesita = true; motivo = 'sin_categoria'; anySinCategoria = true }
      else if (!unidad) { necesita = true; motivo = 'sin_unidad'; anySinUnidad = true }
      else if (!matched) { necesita = true; motivo = 'producto_nuevo'; anyProductoNuevo = true }
      return {
        registro_ticket_id: registroId, descripcion: desc,
        cantidad: it.cantidad ?? null, unidad, monto: it.monto ?? null,
        categoria_id: cat?.id ?? null, producto_catalogo_id: matched?.id ?? null,
        necesita_revision: necesita, motivo_revision: motivo,
        categoria_nombre: cat?.nombre ?? null,
      }
    })

    // Si solo hay un renglon sin precio pero el ticket tiene total, liga el total
    // a ese renglon (notas a mano: "alitas 50 pzas $850").
    const conMonto = itemsToInsert.filter(it => it.monto != null && Number(it.monto) > 0)
    if (montoTotal != null && conMonto.length === 0 && itemsToInsert.length === 1) {
      itemsToInsert[0].monto = montoTotal
    }

    await supabase.from('ticket_items').insert(
      itemsToInsert.map(({ categoria_nombre: _omit, ...rest }) => rest)
    )

    for (const pid of matchedIds) {
      const prod = catalog.products.find(p => p.id === pid)
      if (prod) await supabase.from('catalogo_productos')
        .update({ veces_matched: prod.veces_matched + 1 }).eq('id', pid)
    }

    // Registra el comercio (las categorias se infieren por observacion; puede tener varias)
    await aprenderComercio(supabase, datos.comercio ?? null, sucursalId)

    // No auto-aprender productos desde IA: una lectura mala contamina el catalogo.
    // Los productos nuevos se confirman/ensenan manualmente desde Tickets.

    // Precios: guarda historial y detecta saltos fuertes vs referencia.
    const precioAnomalo = await registrarPrecios(supabase, itemsToInsert, catalog, sucursalId, registroId, fechaTicket)

    let hayAlerta = false
    const dupId = await detectSmartDuplicate(
      supabase, sucursalId, datos.folio_ticket ?? null, datos.comercio ?? null, montoTotal, fechaTicket
    )
    if (dupId && dupId !== registroId) {
      await createAlert(supabase, registroId, 'posible_duplicado', dupId)
      notifyAlertEmail(registroId, 'posible_duplicado'); hayAlerta = true
    }
    if (datos.confianza === 'baja') {
      await createAlert(supabase, registroId, 'ilegible')
      notifyAlertEmail(registroId, 'ilegible'); hayAlerta = true
    }
    if (!fechaValida) { await createAlert(supabase, registroId, 'sin_fecha'); hayAlerta = true }
    if (anySinCategoria || anyProductoNuevo) { await createAlert(supabase, registroId, 'producto_no_reconocido'); hayAlerta = true }
    if (anySinUnidad) { await createAlert(supabase, registroId, 'sin_unidad'); hayAlerta = true }
    if (precioAnomalo) {
      await createAlert(supabase, registroId, 'precio_anomalo')
      notifyAlertEmail(registroId, 'precio_anomalo'); hayAlerta = true
    }

    // Auto-confirmar tickets limpios (sin alertas): archiva imagen + Sheets.
    if (!hayAlerta) {
      await autoConfirmar(supabase, registroId, sucursalId, empleadoId, storagePath, itemsToInsert)
    }
  } catch (err) {
    console.error('Error en procesamiento de fondo:', err)
  }
}

async function autoConfirmar(
  supabase: SB, registroId: string, sucursalId: string, empleadoId: string,
  storagePath: string, items: { descripcion: string; cantidad: number | null; unidad: string | null; monto: number | null; categoria_nombre: string | null }[]
): Promise<void> {
  try {
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const filename = storagePath.split('/').pop() ?? `${registroId}.jpg`
    const archivoPath = `${yearMonth}/${filename}`

    const { data: fileData } = await supabase.storage.from('por-revisar').download(storagePath)
    if (fileData) {
      await supabase.storage.from('archivo').upload(archivoPath, await fileData.arrayBuffer(), {
        contentType: fileData.type, upsert: true,
      })
      await supabase.storage.from('por-revisar').remove([storagePath])
    }

    const [{ data: suc }, { data: emp }, { data: reg }] = await Promise.all([
      supabase.from('sucursales').select('nombre').eq('id', sucursalId).maybeSingle(),
      supabase.from('empleados').select('nombre').eq('id', empleadoId).maybeSingle(),
      supabase.from('registros_tickets').select('fecha_ticket, folio_ticket, comercio').eq('id', registroId).maybeSingle(),
    ])

    let sheetsRowId: string | null = null
    try {
      sheetsRowId = await enviarAGoogleSheets({
        fecha_ticket: reg?.fecha_ticket ?? null,
        folio_ticket: reg?.folio_ticket ?? null,
        comercio: reg?.comercio ?? null,
        sucursal_nombre: suc?.nombre ?? 'Sucursal',
        empleado_nombre: emp?.nombre ?? 'Desconocido',
        storage_path: archivoPath,
        confirmado_en: now.toISOString(),
        items: items.map(it => ({
          descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad,
          monto: it.monto, categoria_gasto: it.categoria_nombre,
        })),
      })
    } catch (e) { console.error('Sheets (no bloqueante):', e) }

    await supabase.from('registros_tickets').update({
      estado: 'confirmado', storage_path_archivo: archivoPath,
      confirmado_en: now.toISOString(), sheets_row_id: sheetsRowId,
    }).eq('id', registroId)
  } catch (err) {
    console.error('Error en auto-confirmacion:', err)
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Token de sesion requerido' }, 401)

    const session = await verifySessionToken(authHeader.slice(7), Deno.env.get('JWT_SECRET')!)
    if (!session) return json({ error: 'Token de sesion invalido o expirado' }, 401)
    const empleadoId = session.sub
    const slug = session.slug

    const formData = await req.formData()
    const imagenFile = formData.get('imagen') as File | null
    if (!imagenFile) return json({ error: 'imagen es requerida' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: suc } = await supabase.from('sucursales')
      .select('id').eq('slug', slug).eq('activa', true).maybeSingle()
    if (!suc) return json({ error: 'Sucursal no encontrada o inactiva' }, 404)
    const sucursalId = suc.id as string

    const imageBytes = await imagenFile.arrayBuffer()
    const mime = imagenFile.type || 'image/jpeg'
    const hashImagen = await sha256Hex(imageBytes)

    const extension = imagenFile.name.split('.').pop() ?? 'jpg'

    // Duplicado exacto por hash: queda registrado como rechazado para auditoria
    // en Tickets, no desaparece del flujo del admin.
    const { data: existing } = await supabase.from('registros_tickets')
      .select('id').eq('hash_imagen', hashImagen).maybeSingle()
    if (existing) {
      const dupPath = `${sucursalId}/${Date.now()}_${hashImagen.slice(0, 8)}_dup.${extension}`
      await supabase.storage.from('por-revisar').upload(dupPath, imageBytes, { contentType: mime, upsert: false })
      const { data: dupReg } = await supabase.from('registros_tickets').insert({
        sucursal_id: sucursalId, empleado_id: empleadoId,
        hash_imagen: hashImagen, storage_path_original: dupPath,
        estado: 'rechazado', es_duplicado: true, duplicado_de: existing.id,
      }).select('id').single()
      if (dupReg?.id) await createAlert(supabase, dupReg.id as string, 'duplicado', existing.id as string)
      return json({ duplicado: true, registro_id: dupReg?.id ?? null, ticket_original_id: existing.id })
    }

    const storagePath = `${sucursalId}/${Date.now()}_${hashImagen.slice(0, 8)}.${extension}`
    const { error: uploadError } = await supabase.storage.from('por-revisar')
      .upload(storagePath, imageBytes, { contentType: mime, upsert: false })
    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return json({ error: 'Error al subir la imagen' }, 500)
    }

    // Registro encabezado en estado pendiente (Gemini lo completa en background)
    const { data: registro, error: insertError } = await supabase.from('registros_tickets').insert({
      sucursal_id: sucursalId, empleado_id: empleadoId,
      hash_imagen: hashImagen, storage_path_original: storagePath, estado: 'pendiente',
    }).select('id').single()
    if (insertError || !registro) {
      console.error('Insert error:', insertError)
      return json({ error: 'Error al guardar el registro' }, 500)
    }
    const registroId = registro.id as string

    // Responde YA al gerente; el procesamiento corre en segundo plano.
    EdgeRuntime.waitUntil(procesarEnSegundoPlano({
      supabase, registroId, sucursalId, empleadoId, imageBytes, mime, storagePath,
    }))

    return json({ recibido: true, registro_id: registroId })
  } catch (err) {
    console.error('Unhandled error:', err)
    return json({ error: 'Error interno del servidor' }, 500)
  }
})
