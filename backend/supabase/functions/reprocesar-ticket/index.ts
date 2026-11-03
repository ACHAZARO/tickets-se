import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { loadCatalog, buildCatalogPromptContext } from '../_shared/catalog.ts'
import type { Catalog } from '../_shared/catalog.ts'
import { buildGeminiPrompt, explicarFallo, fechaMexico, fechaPideRevision, leerTicketConGemini, resolverFecha } from '../_shared/gemini.ts'
import type { GeminiResult, LecturaIA } from '../_shared/gemini.ts'
import { detectSmartDuplicate, palabrasDelNegocio } from '../_shared/duplicados.ts'
import { envioMuyAlto, hayPrecioAnomalo } from '../_shared/precios.ts'
import { noCuadra, sinTotal } from '../_shared/montos.ts'
import { AVISO_NO_CUADRO, construirRenglones, lecturaNoCuadra, motivoCuentaAMano, papelPideRevision } from '../_shared/renglones.ts'
import { detectarTextoParaIA, motivoTextoParaIA } from '../_shared/inyeccion.ts'
import { pagoDistinto, revisarPagos } from '../_shared/pagos.ts'
import { revisarUsoArticulos } from '../_shared/uso-articulos.ts'
import { llamanteDe, puedeSucursal } from '../_shared/permisos.ts'

// Segunda pasada de IA (manual, desde Tickets). Usa EXACTAMENTE las mismas reglas de
// lectura que procesar-ticket. Si la IA no puede leer, no toca nada del ticket.
// Parametros opcionales:
// - modelo + solo_leer: PRUEBA de un modelo; devuelve la lectura sin tocar la BD.
// - solo_si_sin_leer: para el lote; se niega (409) si el ticket ya tiene renglones o ya
//   no esta marcado como "IA no lo leyo" (no pisar capturas manuales).
// - desde_guardada: NO llama a Gemini; rehace renglones, ligas al catalogo y alertas desde la
//   lectura ya guardada (gemini_raw). Sirve tras ensenar sinonimos o mejorar el emparejador.
//   Solo tickets pendientes (no toca confirmados).
// - simular: hace todo el camino (leer o usar la lectura guardada, ligar, cuadrar, alertas) y devuelve el resultado SIN
//   escribir nada. Sirve para medir la IA contra tickets ya auditados, confirmados o no.

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
    const { registro_id, modelo, solo_leer, solo_si_sin_leer, desde_guardada, simular } = await req.json().catch(() => ({})) as {
      registro_id?: string; modelo?: string; solo_leer?: boolean; solo_si_sin_leer?: boolean; desde_guardada?: boolean; simular?: boolean
    }
    if (!registro_id) return json({ error: 'registro_id requerido' }, 400)
    if (modelo !== undefined && !/^[a-z0-9.\-]{3,60}(@(minimal|low|medium|high))?$/.test(String(modelo))) return json({ error: 'modelo invalido' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const quien = await llamanteDe(supabase, req)
    if (!quien) return json({ error: 'No autorizado' }, 401)
    const { data: reg } = await supabase.from('registros_tickets')
      .select('id, sucursal_id, estado, created_at, gemini_raw, storage_path_original, storage_path_archivo, sospecha_estado')
      .eq('id', registro_id).maybeSingle()
    // Un ticket de otro negocio responde igual que uno que no existe.
    if (!reg || !(await puedeSucursal(supabase, quien, reg.sucursal_id))) return json({ error: 'Ticket no encontrado' }, 404)

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
    if (catalog.negocio.fallo) {
      return json({ error: 'No se pudieron cargar las reglas del negocio; intenta de nuevo. No se cambio nada del ticket.', detalle: catalog.negocio.fallo }, 503)
    }
    // Lo propio del negocio (como se llama, sus reglas) viene de la BD por cuenta/sucursal, no del codigo compartido.
    const propias = palabrasDelNegocio(catalog.negocio.sucursales)
    // Referencia de fecha = dia (hora de Mexico) en que se SUBIO el ticket, no hoy: un ticket
    // subido el 6-ago no puede ser de septiembre, y si no trae fecha se asume la de subida.
    const fechaSubida = fechaMexico(new Date(String(reg.created_at ?? new Date().toISOString())))

    const inicio = Date.now()
    let lectura: LecturaIA
    if (desde_guardada && !solo_leer) {
      const raw = reg.gemini_raw as (GeminiResult & Record<string, unknown>) | null
      if (reg.estado !== 'pendiente' && !simular) return json({ omitido: true, motivo: 'Solo se rehacen tickets pendientes.' }, 409)
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
      const prompt = buildGeminiPrompt(buildCatalogPromptContext(catalog), fechaSubida, catalog.negocio)
      lectura = await leerTicketConGemini({
        imagenBase64: encodeBase64(imageBytes),
        mimeType: fileData.type || 'image/jpeg',
        prompt,
        modelos: modelo ? [modelo] : undefined,
      })
      // Igual que al subir: si los renglones no suman el total, una segunda lectura (no en las pruebas de modelo).
      if (!solo_leer && lectura.datos && lecturaNoCuadra(lectura.datos, catalog)) {
        const otra = await leerTicketConGemini({
          imagenBase64: encodeBase64(imageBytes), mimeType: fileData.type || 'image/jpeg', prompt: prompt + AVISO_NO_CUADRO,
          modelos: modelo ? [modelo] : undefined,
        })
        if (otra.datos && !lecturaNoCuadra(otra.datos, catalog)) lectura = { ...otra, intentos: [...lectura.intentos, ...otra.intentos] }
      }
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
    if (!desde_guardada) (datos as Record<string, unknown>)._reglas_negocio = catalog.negocio.reglas.length
    const paraIA = detectarTextoParaIA(datos)
    if (paraIA) (datos as Record<string, unknown>)._texto_para_ia = paraIA

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
    const resFecha = resolverFecha(datos.fecha, fechaSubida)
    const fechaTicket = resFecha.fecha
    if (resFecha.asumida) (datos as Record<string, unknown>)._fecha_asumida = true
    if ((resFecha.asumida || resFecha.corregida) && datos.fecha) (datos as Record<string, unknown>)._fecha_leida = datos.fecha
    const asumida = fechaPideRevision(resFecha)
    const porPapel = papelPideRevision(datos.tipo_documento, resFecha.sinFecha)
    const cuentaMano = motivoCuentaAMano(datos.resumen_mano)

    const armados = construirRenglones(registro_id, rawItems, catalog, datos as typeof datos & Record<string, unknown>, montoTotal)
    const { anySinCategoria, anySinUnidad, anyProductoNuevo } = armados
    const items = armados.items.map(({ categoria_nombre: _omit, ...resto }) => resto)

    if (simular) {
      // Lo mismo que se haria abajo, sin escribir nada.
      const alertasSim: string[] = []
      const dupSim = await detectSmartDuplicate(
        supabase, reg.sucursal_id, datos.folio_ticket ?? null, datos.comercio ?? null, montoTotal, fechaTicket, registro_id,
        datos.tipo_documento ?? null, propias,
      )
      if (dupSim) alertasSim.push('posible_duplicado')
      if (asumida) alertasSim.push('sin_fecha')
      if (datos.confianza === 'baja') alertasSim.push('ilegible')
      if (anySinCategoria || anyProductoNuevo) alertasSim.push('producto_no_reconocido')
      if (anySinUnidad) alertasSim.push('sin_unidad')
      const precioSim = await hayPrecioAnomalo(supabase, items, catalog.products, registro_id)
      if (precioSim) alertasSim.push('precio_anomalo')
      if (await envioMuyAlto(supabase, items, catalog.products, reg.sucursal_id, datos.comercio ?? null, registro_id, propias)) alertasSim.push('envio_alto')
      if (sinTotal(items, montoTotal) || noCuadra(items, montoTotal, datos.tipo_documento)) alertasSim.push('monto_anomalo')
      if (await revisarPagos(supabase, registro_id, montoTotal)) alertasSim.push('pagos_no_cuadran')
      if (await pagoDistinto(supabase, registro_id, datos.pago_leido)) alertasSim.push('pago_distinto')
      if (paraIA || datos.sospecha) alertasSim.push('sospecha')
      if (porPapel) alertasSim.push('nota_a_mano')
      if (cuentaMano) alertasSim.push('cuenta_a_mano')
      return json({
        ok: true, simulado: true, modelo: lectura.modelo, fecha: fechaTicket, comercio: datos.comercio ?? null, folio: datos.folio_ticket ?? null,
        total: montoTotal, tipo_documento: datos.tipo_documento ?? null, sospecha: datos.sospecha ?? null, pago_leido: datos.pago_leido ?? null,
        resumen_mano: datos.resumen_mano ?? null, confianza: datos.confianza ?? null, alertas: alertasSim, ids_duplicado: dupSim, precio: precioSim,
        renglones: armados.items.map(it => {
          const p = it.producto_catalogo_id ? catalog.products.find(x => x.id === it.producto_catalogo_id) : null
          return { descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad, monto: it.monto, categoria: it.categoria_nombre, articulo: p?.nombre ?? null }
        }),
      })
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
      datos.tipo_documento ?? null, propias,
    )
    if (dupId) { await createAlert(supabase, registro_id, 'posible_duplicado', dupId); alertas.push('posible_duplicado') }
    if (asumida) { await createAlert(supabase, registro_id, 'sin_fecha'); alertas.push('sin_fecha') }
    if (datos.confianza === 'baja') { await createAlert(supabase, registro_id, 'ilegible'); alertas.push('ilegible') }
    if (anySinCategoria || anyProductoNuevo) { await createAlert(supabase, registro_id, 'producto_no_reconocido'); alertas.push('producto_no_reconocido') }
    if (anySinUnidad) { await createAlert(supabase, registro_id, 'sin_unidad'); alertas.push('sin_unidad') }
    // Misma revision de precios que la subida normal (solo lectura; el historial se guarda al confirmar).
    const precioRaro = await hayPrecioAnomalo(supabase, items, catalog.products, registro_id)
    if (precioRaro) { await createAlert(supabase, registro_id, 'precio_anomalo', undefined, { motivo: precioRaro }); alertas.push('precio_anomalo') }
    const envioAlto = await envioMuyAlto(supabase, items, catalog.products, reg.sucursal_id, datos.comercio ?? null, registro_id, propias)
    if (envioAlto) { await createAlert(supabase, registro_id, 'envio_alto', undefined, { motivo: envioAlto }); alertas.push('envio_alto') }
    // Sin total, o renglones que no suman el total (y no es impuesto): probable lectura incompleta.
    if (sinTotal(items, montoTotal) || noCuadra(items, montoTotal, datos.tipo_documento)) { await createAlert(supabase, registro_id, 'monto_anomalo'); alertas.push('monto_anomalo') }
    // Pago mixto declarado por el gerente que no suma el total releido.
    if (await revisarPagos(supabase, registro_id, montoTotal)) { await createAlert(supabase, registro_id, 'pagos_no_cuadran'); alertas.push('pagos_no_cuadran') }
    // El papel dice tarjeta y se declaro efectivo de caja: el dueno debe saberlo.
    const distinto = await pagoDistinto(supabase, registro_id, datos.pago_leido)
    if (distinto) { await createAlert(supabase, registro_id, 'pago_distinto', undefined, { motivo: distinto }); alertas.push('pago_distinto') }
    if (cuentaMano) { await createAlert(supabase, registro_id, 'cuenta_a_mano', undefined, { motivo: cuentaMano, resumen: datos.resumen_mano }); alertas.push('cuenta_a_mano') }
    // Nota a mano o remision: siempre la ve una persona, aunque se vea bien.
    if (porPapel) { await createAlert(supabase, registro_id, 'nota_a_mano', undefined, { motivo: porPapel }); alertas.push('nota_a_mano') }
    // Texto en el papel dirigido a la IA: a la revision de Fraude (no se quita solo al releer).
    if (paraIA) {
      const { error: sospErr } = await supabase.from('registros_tickets').update({
        sospechoso: true, sospecha_origen: 'auto', sospecha_estado: 'abierta', sospecha_motivo: motivoTextoParaIA(paraIA),
      }).eq('id', registro_id)
      if (sospErr) console.error('marcar sospecha fallo:', sospErr.message)
      alertas.push('texto_para_ia')
    }
    // Lo raro que ve la IA en el papel va a Fraude, igual que al subir; lo que una persona ya decidio no se vuelve a abrir.
    const sospecha = typeof datos.sospecha === 'string' ? datos.sospecha.trim().slice(0, 400) : ''
    if (sospecha && !paraIA && reg.sospecha_estado !== 'descartada' && reg.sospecha_estado !== 'confirmada') {
      const { error: sospErr } = await supabase.from('registros_tickets').update({
        sospechoso: true, sospecha_origen: 'auto', sospecha_estado: 'abierta', sospecha_motivo: `IA: ${sospecha}`,
      }).eq('id', registro_id)
      if (sospErr) console.error('marcar sospecha fallo:', sospErr.message)
      alertas.push('sospecha')
    }
    // Articulos no autorizados (a Fraude) u ocasionales (a Por revisar), igual que la subida normal.
    if (!rechazado) alertas.push(...await revisarUsoArticulos(supabase, registro_id))
    if (rechazado) alertas.push('rechazado')

    return json({ ok: true, items: items.length, modelo: lectura.modelo, fecha: fechaTicket, posible_duplicado: dupId, alertas })
  } catch (err) {
    console.error('Error reprocesar-ticket:', err)
    return json({ error: 'Error interno' }, 500)
  }
})
