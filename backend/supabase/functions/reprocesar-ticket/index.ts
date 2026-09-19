import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { loadCatalog, buildCatalogPromptContext, matchProductInCatalog, resolveCategoria } from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'
import { buildGeminiPrompt, explicarFallo, fechaMexico, leerTicketConGemini, resolverFecha } from '../_shared/gemini.ts'
import type { GeminiResult, LecturaIA } from '../_shared/gemini.ts'
import { detectSmartDuplicate } from '../_shared/duplicados.ts'
import { envioMuyAlto, hayPrecioAnomalo } from '../_shared/precios.ts'
import { aplicarImpuestos, impuestosPorRenglon, noCuadra, repartirSinImporte, sinTotal } from '../_shared/montos.ts'

// Segunda pasada de IA (manual, desde Tickets). Usa EXACTAMENTE las mismas reglas de
// lectura que procesar-ticket. Si la IA no puede leer, no toca nada del ticket.
// Parametros opcionales:
// - modelo + solo_leer: PRUEBA de un modelo; devuelve la lectura sin tocar la BD.
// - solo_si_sin_leer: para el lote; se niega (409) si el ticket ya tiene renglones o ya
//   no esta marcado como "IA no lo leyo" (no pisar capturas manuales).
// - desde_guardada: NO llama a Gemini; rehace renglones, ligas al catalogo y alertas desde la
//   lectura ya guardada (gemini_raw). Sirve tras ensenar sinonimos o mejorar el emparejador.
//   Solo tickets pendientes (no toca confirmados).

// deno-lint-ignore no-explicit-any
type SB = any
type ImageCandidate = { bucket: 'archivo' | 'por-revisar'; path: string }

async function createAlert(
  supabase: SB, registroId: string, tipo: string, dupId?: string, correccion?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('alertas_tickets').insert({
    registro_ticket_id: registroId, tipo, duplicado_de_id: dupId ?? null, correccion: correccion ?? null,
  })
  if (error) console.error(`createAlert(${tipo}) fallo:`, error.message)
}

async function requireAdmin(supabase: SB, req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return false
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return false
  const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
  return !!data
}

async function downloadTicketImage(
  supabase: SB,
  reg: { storage_path_original?: string | null; storage_path_archivo?: string | null },
) {
  const candidates: ImageCandidate[] = []
  if (reg.storage_path_archivo) candidates.push({ bucket: 'archivo', path: reg.storage_path_archivo })
  if (reg.storage_path_original) candidates.push({ bucket: 'por-revisar', path: reg.storage_path_original })

  let lastError = ''
  for (const c of candidates) {
    const { data, error } = await supabase.storage.from(c.bucket).download(c.path)
    if (data) return { fileData: data, source: c, error: null as string | null }
    lastError = `${c.bucket}/${c.path}: ${error?.message ?? 'sin datos'}`
  }

  return {
    fileData: null,
    source: null,
    error: candidates.length ? lastError : 'ticket sin storage_path_original/storage_path_archivo',
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const { registro_id, modelo, solo_leer, solo_si_sin_leer, desde_guardada } = await req.json().catch(() => ({})) as {
      registro_id?: string; modelo?: string; solo_leer?: boolean; solo_si_sin_leer?: boolean; desde_guardada?: boolean
    }
    if (!registro_id) return json({ error: 'registro_id requerido' }, 400)
    if (modelo !== undefined && !/^[a-z0-9.\-]{3,60}(@(minimal|low|medium|high))?$/.test(String(modelo))) return json({ error: 'modelo invalido' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await requireAdmin(supabase, req))) return json({ error: 'No autorizado' }, 401)
    const { data: reg } = await supabase.from('registros_tickets')
      .select('id, sucursal_id, estado, created_at, gemini_raw, storage_path_original, storage_path_archivo')
      .eq('id', registro_id).maybeSingle()
    if (!reg) return json({ error: 'Ticket no encontrado' }, 404)

    const { data: viejos } = await supabase.from('ticket_items').select('id').eq('registro_ticket_id', registro_id)
    const idsViejos = ((viejos ?? []) as { id: string }[]).map(r => r.id)

    if (solo_si_sin_leer && !solo_leer) {
      const { data: abierta } = await supabase.from('alertas_tickets').select('id')
        .eq('registro_ticket_id', registro_id).eq('tipo', 'ia_sin_leer').eq('resuelta', false).limit(1)
      const enProceso = !!(reg.gemini_raw as Record<string, unknown> | null)?._ia_en_proceso
      if (idsViejos.length > 0 || (!(abierta ?? []).length && !enProceso)) {
        return json({ omitido: true, motivo: 'El ticket ya tiene renglones o ya no esta marcado como sin leer.' }, 409)
      }
    }

    const catalog: Catalog = await loadCatalog(reg.sucursal_id)
    // Referencia de fecha = dia (hora de Mexico) en que se SUBIO el ticket, no hoy: un ticket
    // subido el 6-ago no puede ser de septiembre, y si no trae fecha se asume la de subida.
    const fechaSubida = fechaMexico(new Date(String(reg.created_at ?? new Date().toISOString())))

    const inicio = Date.now()
    let lectura: LecturaIA
    if (desde_guardada && !solo_leer) {
      const raw = reg.gemini_raw as (GeminiResult & Record<string, unknown>) | null
      if (reg.estado !== 'pendiente') return json({ omitido: true, motivo: 'Solo se rehacen tickets pendientes.' }, 409)
      if (!raw || raw._ia_fallo || raw._ia_en_proceso || !Array.isArray(raw.items) || !raw.items.length) {
        return json({ omitido: true, motivo: 'El ticket no tiene una lectura guardada util.' }, 409)
      }
      lectura = { datos: raw, modelo: String(raw._modelo ?? ''), fallo: null, error: null, intentos: ['guardada'] }
    } else {
      const { fileData, source, error: imageError } = await downloadTicketImage(supabase, reg)
      if (!fileData || !source) {
        return json({
          error: 'No se pudo descargar la imagen para releer. Revisa si el archivo existe en Storage.',
          detalle: imageError,
        }, 500)
      }
      const imageBytes = await fileData.arrayBuffer()
      lectura = await leerTicketConGemini({
        imagenBase64: encodeBase64(imageBytes),
        mimeType: fileData.type || 'image/jpeg',
        prompt: buildGeminiPrompt(buildCatalogPromptContext(catalog), fechaSubida),
        modelos: modelo ? [modelo] : undefined,
      })
    }
    if (solo_leer) {
      return json({
        ok: !!lectura.datos, modelo: lectura.modelo || modelo || null, ms: Date.now() - inicio,
        datos: lectura.datos, fallo: lectura.fallo, error: lectura.error?.slice(0, 300) ?? null, intentos: lectura.intentos,
      }, lectura.datos ? 200 : 503)
    }
    if (!lectura.datos) {
      return json({
        error: explicarFallo(lectura.fallo) + ' No se cambio nada del ticket.',
        fallo: lectura.fallo,
        detalle: lectura.error?.slice(0, 300) ?? null,
      }, 503)
    }
    const datos = lectura.datos
    ;(datos as Record<string, unknown>)._modelo = lectura.modelo
    ;(datos as Record<string, unknown>)._reproceso_manual = true

    const rawItems = (Array.isArray(datos.items) ? datos.items : []).filter(it => it && (it.descripcion || it.monto != null))
    // No destruir los renglones existentes si la IA no devolvio renglones utiles.
    if (rawItems.length === 0) {
      if (solo_si_sin_leer) {
        // En el lote: la IA SI leyo pero no hay renglones (foto ilegible). Sale de la cola de
        // "sin leer" como 'ilegible' para no volver a gastar Gemini en cada corrida.
        await supabase.from('alertas_tickets').update({ resuelta: true })
          .eq('registro_ticket_id', registro_id).eq('tipo', 'ia_sin_leer').eq('resuelta', false)
        await createAlert(supabase, registro_id, 'ilegible')
        await supabase.from('registros_tickets').update({ gemini_raw: datos as unknown as Record<string, unknown> }).eq('id', registro_id)
      }
      return json({ error: 'La IA no encontro renglones en el ticket (imagen ilegible o vacia). No se cambio nada.', fallo: 'sin_renglones' }, 422)
    }
    const montoTotal = datos.monto_total ?? (rawItems.reduce((s, it) => s + (Number(it.monto) || 0), 0) || null)
    const { fecha: fechaTicket, asumida } = resolverFecha(datos.fecha, fechaSubida)
    if (asumida) {
      ;(datos as Record<string, unknown>)._fecha_asumida = true
      if (datos.fecha) (datos as Record<string, unknown>)._fecha_leida = datos.fecha
    }

    let anySinCategoria = false
    let anySinUnidad = false
    let anyProductoNuevo = false
    const items = rawItems.map((it, index) => {
      const desc = (it.descripcion ?? 'Producto').toString().slice(0, 500)
      const matched = matchProductInCatalog(desc, catalog.products)
      let cat = resolveCategoria(it.categoria ?? null, catalog.categories)
      if (!cat && matched) cat = resolveCategoria(matched.categoria_nombre, catalog.categories)
      const unidad = (it.unidad && String(it.unidad).trim()) || matched?.unidad_default || null
      let necesita = false, motivo: string | null = null
      if (!cat) { necesita = true; motivo = 'sin_categoria'; anySinCategoria = true }
      else if (!unidad) { necesita = true; motivo = 'sin_unidad'; anySinUnidad = true }
      else if (!matched) { necesita = true; motivo = 'producto_nuevo'; anyProductoNuevo = true }
      return {
        registro_ticket_id: registro_id,
        descripcion: desc,
        cantidad: it.cantidad ?? null,
        unidad,
        monto: it.monto ?? null,
        categoria_id: cat?.id ?? null,
        producto_catalogo_id: matched?.id ?? null,
        necesita_revision: necesita,
        motivo_revision: motivo,
        orden: index,
      }
    })
    // Si solo hay un renglon sin precio pero el ticket tiene total, liga el total a ese renglon.
    if (montoTotal != null && items.length === 1 && !(Number(items[0].monto) > 0)) items[0].monto = montoTotal
    // Nota con varios renglones sin importe y solo el total (pan): se reparte por cantidad.
    if (repartirSinImporte(items, montoTotal, datos.tipo_documento)) {
      ;(datos as Record<string, unknown>)._montos_repartidos = true
    }
    // Facturas: los renglones vienen antes de IVA/IEPS; se suma el impuesto a los renglones que lo
    // pagan para que sumen el total pagado (gastos CON IVA).
    const impuestos = impuestosPorRenglon(items, montoTotal, datos)
    if (impuestos) {
      aplicarImpuestos(items, impuestos, Number(montoTotal))
      ;(datos as Record<string, unknown>)._impuestos_sumados = Math.round(impuestos.reduce((s, x) => s + x, 0) * 100) / 100
    }

    // Orden seguro: 1) insertar lo nuevo, 2) actualizar encabezado, 3) borrar lo viejo.
    // Si algo falla a medio camino se deshace lo nuevo y el ticket queda como estaba.
    const { data: nuevos, error: itemsErr } = await supabase.from('ticket_items').insert(items).select('id')
    if (itemsErr) {
      console.error('reprocesar ticket_items insert:', itemsErr)
      return json({ error: 'No se pudieron guardar los renglones releidos. No se cambio nada.', detalle: itemsErr.message }, 500)
    }
    // Un rechazado sigue rechazado (p.ej. duplicado exacto): releerlo no debe revivirlo.
    const rechazado = reg.estado === 'rechazado'
    const { error: headerErr } = await supabase.from('registros_tickets').update({
      estado: rechazado ? 'rechazado' : 'pendiente',
      fecha_ticket: fechaTicket,
      folio_ticket: datos.folio_ticket ?? null,
      comercio: datos.comercio ?? null,
      monto: montoTotal,
      gemini_raw: datos as unknown as Record<string, unknown>,
    }).eq('id', registro_id)
    if (headerErr) {
      console.error('reprocesar registros_tickets update:', headerErr)
      const idsNuevos = ((nuevos ?? []) as { id: string }[]).map(r => r.id)
      if (idsNuevos.length) await supabase.from('ticket_items').delete().in('id', idsNuevos)
      return json({ error: 'No se pudo guardar la lectura. No se cambio nada.', detalle: headerErr.message }, 500)
    }
    if (idsViejos.length) await supabase.from('ticket_items').delete().in('id', idsViejos)
    // Los precios registrados con los renglones viejos ya no aplican (se registran al confirmar).
    await supabase.from('precio_historial').delete().eq('registro_ticket_id', registro_id)
    // 'revisar_gerente' es decision de una persona: releer no la borra.
    await supabase.from('alertas_tickets').update({ resuelta: true })
      .eq('registro_ticket_id', registro_id).eq('resuelta', false).not('tipo', 'in', '(duplicado,revisar_gerente)')

    const alertas: string[] = []
    const dupId = await detectSmartDuplicate(
      supabase, reg.sucursal_id, datos.folio_ticket ?? null, datos.comercio ?? null, montoTotal, fechaTicket, registro_id,
      datos.tipo_documento ?? null,
    )
    if (dupId) { await createAlert(supabase, registro_id, 'posible_duplicado', dupId); alertas.push('posible_duplicado') }
    if (asumida) { await createAlert(supabase, registro_id, 'sin_fecha'); alertas.push('sin_fecha') }
    if (datos.confianza === 'baja') { await createAlert(supabase, registro_id, 'ilegible'); alertas.push('ilegible') }
    if (anySinCategoria || anyProductoNuevo) { await createAlert(supabase, registro_id, 'producto_no_reconocido'); alertas.push('producto_no_reconocido') }
    if (anySinUnidad) { await createAlert(supabase, registro_id, 'sin_unidad'); alertas.push('sin_unidad') }
    // Misma revision de precios que la subida normal (solo lectura; el historial se guarda al confirmar).
    if (await hayPrecioAnomalo(supabase, items, catalog.products, registro_id)) {
      await createAlert(supabase, registro_id, 'precio_anomalo'); alertas.push('precio_anomalo')
    }
    const envioAlto = await envioMuyAlto(supabase, items, catalog.products, reg.sucursal_id, datos.comercio ?? null, registro_id)
    if (envioAlto) { await createAlert(supabase, registro_id, 'envio_alto', undefined, { motivo: envioAlto }); alertas.push('envio_alto') }
    // Sin total, o renglones que no suman el total (y no es impuesto): probable lectura incompleta.
    if (sinTotal(items, montoTotal) || noCuadra(items, montoTotal, datos.tipo_documento)) { await createAlert(supabase, registro_id, 'monto_anomalo'); alertas.push('monto_anomalo') }
    if (rechazado) alertas.push('rechazado')

    return json({ ok: true, items: items.length, modelo: lectura.modelo, fecha: fechaTicket, posible_duplicado: dupId, alertas })
  } catch (err) {
    console.error('Error reprocesar-ticket:', err)
    return json({ error: 'Error interno' }, 500)
  }
})
