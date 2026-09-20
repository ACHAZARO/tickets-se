import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  loadCatalog, buildCatalogPromptContext, matchProductInCatalog, resolveCategoria,
} from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'
import { enviarAGoogleSheets } from '../_shared/google-sheets.ts'
import { buildGeminiPrompt, fechaMexico, leerTicketConGemini, resolverFecha } from '../_shared/gemini.ts'
import { detectSmartDuplicate, palabrasDelNegocio } from '../_shared/duplicados.ts'
import { envioMuyAlto, guardarPrecios, hayPrecioAnomalo } from '../_shared/precios.ts'
import { aplicarImpuestos, impuestosPorRenglon, noCuadra, repartirSinImporte, sinTotal } from '../_shared/montos.ts'
import { copiarAArchivo, quitarDePorRevisar } from '../_shared/archivo.ts'
import type { GeminiItem } from '../_shared/gemini.ts'

// EdgeRuntime.waitUntil permite seguir procesando despues de responder.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

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

async function createAlert(
  supabase: SB, registroId: string, tipo: string, dupId?: string, correccion?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId, tipo, duplicado_de_id: dupId ?? null, correccion: correccion ?? null,
  })
  if (error) console.error(`createAlert(${tipo}) fallo:`, error.message)
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

// Procesamiento pesado en segundo plano: Gemini + items + alertas + auto-confirma.
async function procesarEnSegundoPlano(opts: {
  supabase: SB; registroId: string; sucursalId: string; empleadoId: string
  imageBytes: ArrayBuffer; mime: string; storagePath: string
}): Promise<void> {
  const { supabase, registroId, sucursalId, empleadoId, imageBytes, mime, storagePath } = opts
  try {
    // Marca "en proceso": si Supabase corta el proceso en segundo plano a media lectura,
    // el panel lo detecta (pendiente con _ia_en_proceso viejo) y lo ofrece para releer.
    await supabase.from('registros_tickets').update({
      gemini_raw: { items: [], _ia_en_proceso: new Date().toISOString() },
    }).eq('id', registroId)

    const catalog: Catalog = await loadCatalog(sucursalId)
    if (catalog.negocio.fallo) {
      // Sin las reglas del negocio no se lee (saldria mal clasificado y podria auto-confirmarse): queda para releer.
      console.error('procesar-ticket:', catalog.negocio.fallo)
      await supabase.from('registros_tickets').update({
        gemini_raw: { items: [], _ia_fallo: 'otro', _error: catalog.negocio.fallo },
      }).eq('id', registroId)
      await createAlert(supabase, registroId, 'ia_sin_leer')
      return
    }
    const hoy = fechaMexico()
    // Lo propio del negocio (como se llama, sus reglas) viene de la BD por cuenta/sucursal, no del codigo compartido.
    const prompt = buildGeminiPrompt(buildCatalogPromptContext(catalog), hoy, catalog.negocio)
    const propias = palabrasDelNegocio(catalog.negocio.sucursales)

    const lectura = await leerTicketConGemini({ imagenBase64: encodeBase64(imageBytes), mimeType: mime, prompt })
    if (!lectura.datos) {
      // La IA NO leyo el ticket (sin cuota, saturada, etc.). No es "ilegible" ni se inventa
      // fecha: queda marcado para releer (boton "Volver a leer IA" / releer en lote).
      await supabase.from('registros_tickets').update({
        gemini_raw: { items: [], _ia_fallo: lectura.fallo, _error: lectura.error, _intentos: lectura.intentos },
      }).eq('id', registroId)
      await createAlert(supabase, registroId, 'ia_sin_leer')
      return
    }
    const datos = lectura.datos
    ;(datos as Record<string, unknown>)._modelo = lectura.modelo
    ;(datos as Record<string, unknown>)._reglas_negocio = catalog.negocio.reglas.length

    let rawItems: GeminiItem[] = Array.isArray(datos.items) ? datos.items : []
    rawItems = rawItems.filter(it => it && (it.descripcion || it.monto != null))
    const montoTotal = datos.monto_total ?? (rawItems.length
      ? rawItems.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null : null)

    // Si Gemini no leyo una fecha real (o leyo un año imposible), corregir el año si dia/mes
    // sirven, o usar la fecha de subida; en ambos casos queda marcada como asumida.
    const { fecha: fechaTicket, asumida } = resolverFecha(datos.fecha, hoy)
    const fechaValida = !asumida
    if (asumida) {
      ;(datos as Record<string, unknown>)._fecha_asumida = true
      if (datos.fecha) (datos as Record<string, unknown>)._fecha_leida = datos.fecha
    }

    const matchedIds = new Set<string>()
    let anySinCategoria = false
    let anySinUnidad = false
    let anyProductoNuevo = false
    const itemsToInsert = (rawItems.length ? rawItems : [
      { descripcion: datos.comercio ?? 'Ticket', monto: montoTotal, categoria: null, unidad: null, cantidad: null },
    ]).map((it, index) => {
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
        orden: index,
        categoria_nombre: cat?.nombre ?? null,
      }
    })

    // Si solo hay un renglon sin precio pero el ticket tiene total, liga el total
    // a ese renglon (notas a mano: "alitas 50 pzas $850").
    const conMonto = itemsToInsert.filter(it => it.monto != null && Number(it.monto) > 0)
    if (montoTotal != null && conMonto.length === 0 && itemsToInsert.length === 1) {
      itemsToInsert[0].monto = montoTotal
    }
    // Nota con varios renglones sin importe y solo el total (pan): se reparte por cantidad.
    if (repartirSinImporte(itemsToInsert, montoTotal, datos.tipo_documento)) {
      ;(datos as Record<string, unknown>)._montos_repartidos = true
    }
    // Facturas: los renglones vienen antes de IVA/IEPS; se suma el impuesto a los renglones que lo
    // pagan para que sumen el total pagado (gastos CON IVA).
    const impuestos = impuestosPorRenglon(itemsToInsert, montoTotal, datos)
    if (impuestos) {
      aplicarImpuestos(itemsToInsert, impuestos, Number(montoTotal))
      ;(datos as Record<string, unknown>)._impuestos_sumados = Math.round(impuestos.reduce((s, x) => s + x, 0) * 100) / 100
    }
    const montoNoCuadra = sinTotal(itemsToInsert, montoTotal) || noCuadra(itemsToInsert, montoTotal, datos.tipo_documento)
    const { error: headerErr } = await supabase.from('registros_tickets').update({
      fecha_ticket: fechaTicket,
      folio_ticket: datos.folio_ticket ?? null,
      comercio: datos.comercio ?? null,
      monto: montoTotal,
      gemini_raw: datos as unknown as Record<string, unknown>,
    }).eq('id', registroId)
    if (headerErr) {
      // Sin encabezado guardado no se sigue (evita confirmar un ticket sin fecha/monto).
      console.error('registros_tickets update:', headerErr)
      await supabase.from('registros_tickets').update({
        gemini_raw: { items: [], _ia_fallo: 'otro', _error: 'no se pudo guardar la lectura: ' + headerErr.message },
      }).eq('id', registroId)
      await createAlert(supabase, registroId, 'ia_sin_leer')
      return
    }

    const { error: itemsErr } = await supabase.from('ticket_items').insert(
      itemsToInsert.map(({ categoria_nombre: _omit, ...rest }) => rest)
    )
    if (itemsErr) {
      // No auto-confirmar un ticket sin renglones: marcar para revision.
      console.error('ticket_items insert:', itemsErr)
      await createAlert(supabase, registroId, 'ilegible')
      return
    }

    for (const pid of matchedIds) {
      const prod = catalog.products.find(p => p.id === pid)
      if (prod) await supabase.from('catalogo_productos')
        .update({ veces_matched: prod.veces_matched + 1 }).eq('id', pid)
    }

    // Registra el comercio (las categorias se infieren por observacion; puede tener varias)
    await aprenderComercio(supabase, datos.comercio ?? null, sucursalId)

    // No auto-aprender productos desde IA: una lectura mala contamina el catalogo.
    // Los productos nuevos se confirman/ensenan manualmente desde Tickets.

    // Precios: detecta saltos fuertes vs la mediana de compras confirmadas. El historial se
    // guarda solo al confirmar (aqui abajo si sale limpio, o en confirmar-admin tras revision).
    const precioAnomalo = await hayPrecioAnomalo(supabase, itemsToInsert, catalog.products, registroId)
    const envioAlto = await envioMuyAlto(supabase, itemsToInsert, catalog.products, sucursalId, datos.comercio ?? null, registroId, propias)

    let hayAlerta = false
    // Senales de alteracion o de comprobante reutilizado (las ve la IA): van a Fraude.
    const sospecha = typeof datos.sospecha === 'string' ? datos.sospecha.trim().slice(0, 400) : ''
    if (datos.confianza === 'baja') {
      await createAlert(supabase, registroId, 'ilegible')
      notifyAlertEmail(registroId, 'ilegible'); hayAlerta = true
    }
    if (!fechaValida) { await createAlert(supabase, registroId, 'sin_fecha'); hayAlerta = true }
    if (anySinCategoria || anyProductoNuevo) { await createAlert(supabase, registroId, 'producto_no_reconocido'); hayAlerta = true }
    if (anySinUnidad) { await createAlert(supabase, registroId, 'sin_unidad'); hayAlerta = true }
    // Sin total, o renglones que no suman el total (y no es impuesto): probable lectura incompleta.
    if (montoNoCuadra) { await createAlert(supabase, registroId, 'monto_anomalo'); hayAlerta = true }
    if (precioAnomalo) {
      await createAlert(supabase, registroId, 'precio_anomalo')
      notifyAlertEmail(registroId, 'precio_anomalo'); hayAlerta = true
    }
    if (envioAlto) { await createAlert(supabase, registroId, 'envio_alto', undefined, { motivo: envioAlto }); hayAlerta = true }

    // registroId se excluye: el encabezado ya esta guardado y si no, se encontraria a si mismo
    // y un duplicado real (ej. factura + ticket de la misma compra) pasaria sin alerta.
    // Va despues de las alertas: si en Fraude se "Descarta" (era otra compra), el ticket regresa con ellas.
    const dupId = await detectSmartDuplicate(
      supabase, sucursalId, datos.folio_ticket ?? null, datos.comercio ?? null, montoTotal, fechaTicket, registroId,
      datos.tipo_documento ?? null, propias,
    )
    if (dupId) {
      // Papel repetido (factura + ticket de la misma compra, reimpresion, mismo folio). Decision Alejandro
      // 18-sep: no se cuenta ni se deja para revisar; se RECHAZA solo y va a la revision de fraude junto
      // con el original (si el gerente reporta el gasto dos veces, se le cobra).
      if (await rechazarDuplicadoAFraude(supabase, registroId, dupId, sospecha)) {
        notifyAlertEmail(registroId, 'posible_duplicado')
        return
      }
      // Si no se pudo rechazar, queda para revision normal como antes.
      await createAlert(supabase, registroId, 'posible_duplicado', dupId)
      notifyAlertEmail(registroId, 'posible_duplicado'); hayAlerta = true
    }
    if (sospecha) {
      const { error: sospErr } = await supabase.from('registros_tickets').update({
        sospechoso: true, sospecha_origen: 'auto', sospecha_estado: 'abierta', sospecha_motivo: `IA: ${sospecha}`,
      }).eq('id', registroId)
      if (sospErr) console.error('marcar sospecha fallo:', sospErr.message)
      hayAlerta = true
    }

    // Auto-confirmar tickets limpios (sin alertas): archiva imagen + Sheets.
    if (!hayAlerta) {
      if (await autoConfirmar(supabase, registroId, sucursalId, empleadoId, storagePath, itemsToInsert)) {
        await guardarPrecios(supabase, itemsToInsert, catalog.products, sucursalId, registroId, fechaTicket)
      }
    }
  } catch (err) {
    console.error('Error en procesamiento de fondo:', err)
  }
}

// Rechaza el ticket nuevo como papel repetido y pone a ambos (nuevo y original) en el mismo grupo de
// la revision de fraude. El original sigue contando; el nuevo no.
// Devuelve false si no se pudo rechazar (el llamador lo deja para revision normal).
async function rechazarDuplicadoAFraude(supabase: SB, registroId: string, dupId: string, sospechaIA: string): Promise<boolean> {
  const { data: orig } = await supabase.from('registros_tickets')
    .select('fecha_ticket, comercio, monto, folio_ticket, sospecha_grupo, sospechoso').eq('id', dupId).maybeSingle()
  const grupo = (orig?.sospecha_grupo as string | null) ?? crypto.randomUUID()
  const quien = `${orig?.comercio ?? 'otro ticket'} ${orig?.fecha_ticket ?? ''} $${orig?.monto ?? '?'} (folio ${orig?.folio_ticket ?? 's/f'})`
  const { data: nuevo } = await supabase.from('registros_tickets').select('gemini_raw').eq('id', registroId).maybeSingle()
  const { error: rechErr } = await supabase.from('registros_tickets').update({
    estado: 'rechazado', es_duplicado: true, duplicado_de: dupId,
    sospechoso: true, sospecha_origen: 'auto', sospecha_estado: 'abierta', sospecha_grupo: grupo,
    sospecha_motivo: `Papel repetido de ${quien}: se rechazo solo y no cuenta. Si fue otra compra, "Descartar" lo regresa a Por confirmar.`
      + (sospechaIA ? ` Ademas la IA vio: ${sospechaIA}` : ''),
    gemini_raw: { ...((nuevo?.gemini_raw as Record<string, unknown> | null) ?? {}), _rechazo_auto: 'posible_duplicado' },
  }).eq('id', registroId)
  if (rechErr) { console.error('rechazar duplicado fallo:', rechErr.message); return false }
  // El original entra al mismo grupo. Si ya estaba en Fraude (p. ej. marcado o decidido por el admin),
  // no se tocan su estado ni su motivo: solo se le asigna el grupo si no tenia.
  const marcaOrig = orig?.sospechoso
    ? (orig.sospecha_grupo ? null : { sospecha_grupo: grupo })
    : { sospechoso: true, sospecha_origen: 'auto', sospecha_estado: 'abierta', sospecha_grupo: grupo,
        sospecha_motivo: 'Tiene una copia (factura/ticket/reimpresion) subida despues, que se rechazo sola. Este si cuenta.' }
  if (marcaOrig) {
    const { error: origErr } = await supabase.from('registros_tickets').update(marcaOrig).eq('id', dupId)
    if (origErr) console.error('marcar original del duplicado fallo:', origErr.message)
  }
  const { error } = await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId, tipo: 'posible_duplicado', duplicado_de_id: dupId, resuelta: true,
    correccion: { nota: 'rechazado solo como papel repetido; ver revision de fraude' },
  })
  if (error) console.error('alerta posible_duplicado fallo:', error.message)
  return true
}

async function autoConfirmar(
  supabase: SB, registroId: string, sucursalId: string, empleadoId: string,
  storagePath: string, items: { descripcion: string; cantidad: number | null; unidad: string | null; monto: number | null; categoria_nombre: string | null }[]
): Promise<boolean> {
  let confirmado = false
  try {
    const now = new Date()
    // Candado: solo un confirmador gana. El admin pudo confirmar (o rechazar) mientras la IA terminaba; entonces
    // aqui no se toca nada (ni foto, ni Sheets, ni precios).
    const { data: claim, error: claimErr } = await supabase.from('registros_tickets')
      .update({ estado: 'confirmado', confirmado_en: now.toISOString() })
      .eq('id', registroId).eq('estado', 'pendiente').select('id')
    if (claimErr) console.error('auto-confirmacion: no se pudo confirmar:', claimErr.message)
    if (claimErr || !claim?.length) return false
    confirmado = true
    // Copia verificada a 'archivo'; el original se quita solo al final, con el ticket ya apuntando a la copia.
    const archivoPath = await copiarAArchivo(supabase, storagePath, now)

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
        storage_path: archivoPath ?? storagePath,
        confirmado_en: now.toISOString(),
        items: items.map(it => ({
          descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad,
          monto: it.monto, categoria_gasto: it.categoria_nombre,
        })),
      })
    } catch (e) { console.error('Sheets (no bloqueante):', e) }

    // Solo se escribe lo nuevo: nunca se pone en null algo que otro confirmador ya guardo.
    const cambios = {
      ...(archivoPath ? { storage_path_archivo: archivoPath } : {}),
      ...(sheetsRowId ? { sheets_row_id: sheetsRowId } : {}),
    }
    if (Object.keys(cambios).length) {
      const { error: updErr } = await supabase.from('registros_tickets').update(cambios).eq('id', registroId)
      if (updErr) console.error('auto-confirmacion: no se guardo la ruta de archivo, la foto se queda en por-revisar:', updErr.message)
      else if (archivoPath) await quitarDePorRevisar(supabase, storagePath)
    }
  } catch (err) {
    console.error('Error en auto-confirmacion:', err)
  }
  return confirmado
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
      .select('id, cuenta_id').eq('slug', slug).eq('activa', true).maybeSingle()
    if (!suc) return json({ error: 'Sucursal no encontrada o inactiva' }, 404)
    const sucursalId = suc.id as string
    // Sucursales del MISMO negocio (cuenta): una foto repetida solo se compara contra ellas, nunca contra otro negocio.
    const { data: hermanas } = await supabase.from('sucursales').select('id').eq('cuenta_id', suc.cuenta_id)
    const sucursalesDelNegocio = [...new Set([sucursalId, ...((hermanas ?? []) as { id: string }[]).map(s => s.id)])]

    const imageBytes = await imagenFile.arrayBuffer()
    const mime = imagenFile.type || 'image/jpeg'
    const hashImagen = await sha256Hex(imageBytes)

    const extension = imagenFile.name.split('.').pop() ?? 'jpg'

    // Duplicado exacto por hash: queda registrado como rechazado para auditoria
    // en Tickets, no desaparece del flujo del admin.
    const { data: existing } = await supabase.from('registros_tickets')
      .select('id, fecha_ticket, comercio').eq('hash_imagen', hashImagen).neq('estado', 'rechazado')
      .in('sucursal_id', sucursalesDelNegocio)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (existing) {
      const dupPath = `${sucursalId}/${Date.now()}_${hashImagen.slice(0, 8)}_dup.${extension}`
      // Si la copia no se guarda, el gerente ve el error y vuelve a subir: no queda un registro sin foto.
      const { error: dupUpErr } = await supabase.storage.from('por-revisar')
        .upload(dupPath, imageBytes, { contentType: mime, upsert: false })
      if (dupUpErr) {
        console.error('Storage upload error (duplicado):', dupUpErr)
        return json({ error: 'Error al subir la imagen' }, 500)
      }
      // La copia toma fecha/comercio del original: se archiva en el mes del gasto (no "colada" en el
      // mes en que se subio). Ya queda rechazada, asi que su alerta nace resuelta (solo auditoria).
      const { data: dupReg, error: dupInsErr } = await supabase.from('registros_tickets').insert({
        sucursal_id: sucursalId, empleado_id: empleadoId,
        hash_imagen: hashImagen, storage_path_original: dupPath,
        estado: 'rechazado', es_duplicado: true, duplicado_de: existing.id,
        fecha_ticket: existing.fecha_ticket ?? null, comercio: existing.comercio ?? null,
      }).select('id').single()
      if (dupInsErr || !dupReg) {
        console.error('Insert error (duplicado):', dupInsErr)
        return json({ error: 'Error al guardar el registro' }, 500)
      }
      if (dupReg?.id) {
        const { error: alertaError } = await supabase.from('alertas_tickets').insert({
          registro_ticket_id: dupReg.id, tipo: 'duplicado', duplicado_de_id: existing.id, resuelta: true,
          correccion: { nota: 'foto identica a otra ya subida: se rechazo sola' },
        })
        if (alertaError) console.error('alerta duplicado fallo:', alertaError.message)
      }
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
