'use client'

// RETIRADA 04-nov-2026 (Alejandro): la carpeta con _ no es ruta de Next. Solo tiene sentido cuando se conecte a la caja de la app propia. No exponer por API.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { cotejarPorSucursal, cuentasIncompletasPorSucursal, leerCsv, normalizarConcepto, salidasDeReporte } from '@/lib/faltantes.mjs'
import type { Cotejo, CuentaIncompleta, SalidaConTicket, SalidaGuardada, SalidaLeida, TicketCotejo } from '@/lib/faltantes-tipos'
import { useConfirm, useToast } from '../ui'

// Tickets faltantes: lo que salio de la caja contra los tickets que subieron. El reporte sale del punto de venta; lo que el dueno aclara
// una vez ("no lleva ticket", "este es su ticket") se queda guardado. Tambien cierra el mes cuando ya quedo.

const pesos = (n: number | null | undefined) => n == null ? '—' : '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1] ?? ym
const fechaCorta = (f: string | null) => f ? `${Number(f.slice(8, 10))} ${(MESES[Number(f.slice(5, 7)) - 1] ?? '').slice(0, 3)}` : 'sin fecha'
const sumar = (l: { monto: number | null }[]) => l.reduce((s, x) => s + (Number(x.monto) || 0), 0)
const mesDe = (d: Date) => new Date(d.getTime() - 6 * 3600_000).toISOString().slice(0, 7)
function moverDias(iso: string, n: number) { return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10) }
function finDeMes(ym: string) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

export default function FaltantesPage() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { sucursalId, sucursales } = useSucursal()
  const [mes, setMes] = useState(() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return mesDe(d) })
  const [salidas, setSalidas] = useState<SalidaGuardada[]>([])
  const [tickets, setTickets] = useState<TicketCotejo[]>([])
  const [conceptos, setConceptos] = useState<string[]>([])
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [cerrado, setCerrado] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [porSubir, setPorSubir] = useState<{ filas: SalidaLeida[]; dudas: string[]; elegidas: Record<string, string> } | null>(null)
  const [fallo, setFallo] = useState(false)
  const [abiertos, setAbiertos] = useState<string[]>([])
  const [marcados, setMarcados] = useState<string[]>([])
  const [eligiendo, setEligiendo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const primera = useRef(true)

  const cargar = useCallback(async (ym: string) => {
    setCargando(true)
    const ini = `${ym}-01`, fin = finDeMes(ym)
    const { data: cu } = await supabase.from('cuentas').select('id').limit(1).maybeSingle()
    const cuenta = (cu as { id: string } | null)?.id ?? null
    setCuentaId(cuenta)
    const [sal, tic, op, ce] = await Promise.all([
      traerTodo(() => {
        let q = supabase.from('salidas_caja').select('id, sucursal_id, fecha, hora, concepto, monto, empleado, no_lleva, ticket_id, tickets_extra, no_es').gte('fecha', ini).lte('fecha', fin).order('fecha').order('hora')
        if (sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      }),
      // Unos dias antes y despues: una salida del dia 1 puede pagar un ticket del dia 30.
      traerTodo(() => {
        let q = supabase.from('registros_tickets').select('id, sucursal_id, fecha_ticket, monto, comercio, resumen:gemini_raw->resumen_mano, ticket_pagos(formas_pago(sale_de_caja))')
          .gte('fecha_ticket', moverDias(ini, -5)).lte('fecha_ticket', moverDias(fin, 5)).neq('estado', 'rechazado')
        if (sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      }),
      cuenta ? supabase.from('cuenta_opciones').select('conceptos_sin_ticket').eq('cuenta_id', cuenta).maybeSingle() : Promise.resolve({ data: null }),
      cuenta ? supabase.from('meses_cerrados').select('mes').eq('cuenta_id', cuenta).eq('mes', ini).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setFallo(!!sal.error || !!tic.error)
    setSalidas(((sal.data as unknown as SalidaGuardada[]) ?? []).map(s => ({ ...s, monto: Number(s.monto) })))
    type F = { id: string; sucursal_id: string | null; fecha_ticket: string | null; monto: number | null; comercio: string | null; resumen: { compra_total?: number; envio?: number; total?: number } | null; ticket_pagos: { formas_pago: { sale_de_caja: boolean } | null }[] }
    setTickets(((tic.data as unknown as F[]) ?? []).map(t => ({
      id: t.id, sucursal_id: t.sucursal_id, fecha: t.fecha_ticket, monto: t.monto, comercio: t.comercio,
      deCaja: !!t.ticket_pagos?.length && t.ticket_pagos.every(p => p.formas_pago?.sale_de_caja),
      otroPago: !!t.ticket_pagos?.length && !t.ticket_pagos.some(p => p.formas_pago?.sale_de_caja),
      cuentaMano: t.resumen?.total ?? null, compraMano: t.resumen?.compra_total ?? null, envioMano: t.resumen?.envio ?? null,
    })))
    setConceptos(((op.data as { conceptos_sin_ticket?: string[] } | null)?.conceptos_sin_ticket) ?? [])
    setCerrado(!!ce.data)
    setCargando(false)
  }, [sucursalId])

  useEffect(() => { cargar(mes) }, [cargar, mes])

  // La primera vez abre en el ultimo mes que ya tiene reporte de caja.
  useEffect(() => {
    if (!primera.current) return
    primera.current = false
    supabase.from('salidas_caja').select('fecha').order('fecha', { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      const f = (data as { fecha: string } | null)?.fecha
      if (f) setMes(f.slice(0, 7))
    })
  }, [])

  const dentroDelMes = useCallback((f: string | null) => !!f && f.slice(0, 7) === mes, [mes])
  const r = useMemo(() => cotejarPorSucursal(salidas, tickets, conceptos) as Cotejo, [salidas, tickets, conceptos])
  const incompletas = useMemo(() => (cuentasIncompletasPorSucursal(tickets) as CuentaIncompleta[]).filter(c => dentroDelMes(c.fecha)), [tickets, dentroDelMes])
  const sinSalida = useMemo(() => r.ticketsSinSalida.filter(t => dentroDelMes(t.fecha)), [r.ticketsSinSalida, dentroDelMes])
  // Lo que el dueno ligo no se ofrece otra vez; lo que se empato solo si, porque pudo tomarlo la salida equivocada.
  const ligados = useMemo(() => new Set(r.conTicket.filter(c => c.como === 'manual').flatMap(c => c.tickets.map(t => t.id))), [r.conTicket])
  const empatados = useMemo(() => new Set(r.conTicket.filter(c => c.como !== 'manual').flatMap(c => c.tickets.map(t => t.id))), [r.conTicket])
  const parciales = useMemo(() => r.conTicket.filter(c => (c.resto ?? 0) > 0), [r.conTicket])
  const sinComprobar = parciales.reduce((n, c) => n + (c.resto ?? 0), 0)
  const cuantosFaltan = r.faltan.length + parciales.length

  // Lo mismo escrito igual va junto y lo mas grande primero: "Comida personal, 18 veces" se aclara de un toque.
  const grupos = useMemo(() => {
    const m = new Map<string, SalidaGuardada[]>()
    for (const s of r.faltan) {
      const c = normalizarConcepto(s.concepto)
      const k = c ? `${s.sucursal_id ?? ''}|${c}` : s.id
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()].map(([clave, lista]) => ({ clave, lista })).sort((a, b) => sumar(b.lista) - sumar(a.lista))
  }, [r.faltan])
  const idPorNombre = useMemo(() => new Map(sucursales.map(x => [normalizarConcepto(x.nombre) as string, x.id])), [sucursales])
  const unaSucursal = !!sucursalId || sucursales.length === 1
  const nombreSucursal = (id: string | null | undefined) => sucursales.find(x => x.id === id)?.nombre ?? ''
  // En la vista de todas las sucursales cada renglon dice de cual es.
  const deCual = (id: string | null | undefined) => !unaSucursal && nombreSucursal(id) ? ` · ${nombreSucursal(id)}` : ''

  async function guardarSalidas(nuevas: SalidaLeida[], elegida: string, contestadas: Record<string, string> = {}) {
    setSubiendo(true)
    try {
      await ensureFreshSession()
      // El reporte dice de que tienda es cada renglon; si no lo dice, la que se eligio.
      const filasBd = nuevas.map(({ tienda, ...s }) => ({ ...s, sucursal_id: idPorNombre.get(normalizarConcepto(tienda)) ?? contestadas[(tienda ?? '').trim()] ?? elegida }))
      let insertadas = 0
      for (let i = 0; i < filasBd.length; i += 300) {
        const { data, error: e } = await supabase.from('salidas_caja').upsert(filasBd.slice(i, i + 300), { onConflict: 'cuenta_id,huella', ignoreDuplicates: true }).select('id')
        if (e) { toast('No se pudo guardar: ' + e.message, 'error'); return }
        insertadas += data?.length ?? 0
      }
      const meses = [...new Set(nuevas.map(s => s.fecha.slice(0, 7)))].sort()
      const tiendas = [...new Set(filasBd.map(f => nombreSucursal(f.sucursal_id)))].filter(Boolean).join(' y ')
      toast(insertadas ? `Listo: ${insertadas} ${insertadas === 1 ? 'salida' : 'salidas'} de caja${tiendas ? ` de ${tiendas}` : ''}, ${meses.map(nombreMes).join(' y ')}` : 'Ese reporte ya estaba subido')
      const ultimo = meses[meses.length - 1]
      if (ultimo === mes) cargar(mes); else setMes(ultimo)
    } finally {
      setSubiendo(false)
    }
  }

  async function subirArchivo(archivo: File | undefined) {
    if (!archivo) return
    setSubiendo(true)
    try {
      let filas: string[][]
      if (/\.xlsx?$/i.test(archivo.name)) {
        const XLSX = await import('xlsx')
        const libro = XLSX.read(await archivo.arrayBuffer(), { cellDates: false })
        filas = leerCsv(XLSX.utils.sheet_to_csv(libro.Sheets[libro.SheetNames[0]]))
      } else {
        filas = leerCsv(await archivo.text())
      }
      const { salidas: nuevas, error } = salidasDeReporte(filas) as { salidas: SalidaLeida[]; error: string | null }
      if (error) { toast(error, 'error'); return }
      const elegida = sucursalId || (sucursales.length === 1 ? sucursales[0].id : '')
      // Solo se pregunta lo que el reporte no dice, una vez por cada tienda que no se reconoce. Si ya hay sucursal elegida y el reporte trae una sola tienda, es esa.
      const desconocidas = [...new Set(nuevas.map(s => (s.tienda ?? '').trim()).filter(x => !idPorNombre.has(normalizarConcepto(x))))]
      const dudas = sucursales.length === 1 || (elegida && desconocidas.length <= 1) ? [] : desconocidas
      if (dudas.length) { setPorSubir({ filas: nuevas, dudas, elegidas: {} }); return }
      await guardarSalidas(nuevas, elegida)
    } catch {
      toast('No pude leer ese archivo. Súbelo como CSV o Excel.', 'error')
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function contestarSucursal(id: string) {
    if (!porSubir) return
    const [duda, ...dudas] = porSubir.dudas
    const elegidas = { ...porSubir.elegidas, [duda]: id }
    if (dudas.length) { setPorSubir({ ...porSubir, dudas, elegidas }); return }
    setPorSubir(null)
    guardarSalidas(porSubir.filas, sucursalId || '', elegidas)
  }

  async function noLleva(s: SalidaGuardada) {
    const concepto = normalizarConcepto(s.concepto)
    setSalidas(prev => prev.map(x => x.id === s.id ? { ...x, no_lleva: true } : x))
    const { error } = await supabase.from('salidas_caja').update({ no_lleva: true }).eq('id', s.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); cargar(mes); return }
    // Lo mismo escrito igual ya no se pregunta otra vez.
    if (concepto && cuentaId && !conceptos.includes(concepto)) {
      const nuevos = [...conceptos, concepto]
      setConceptos(nuevos)
      const { error: e } = await supabase.from('cuenta_opciones').upsert({ cuenta_id: cuentaId, conceptos_sin_ticket: nuevos }, { onConflict: 'cuenta_id' })
      if (e) { toast('No se pudo guardar: ' + e.message, 'error'); cargar(mes); return }
      toast(`"${(s.concepto ?? '').trim()}" ya no te lo pregunto`)
    }
  }

  async function siLleva(s: SalidaGuardada) {
    const concepto = normalizarConcepto(s.concepto)
    setSalidas(prev => prev.map(x => x.id === s.id ? { ...x, no_lleva: false } : x))
    await supabase.from('salidas_caja').update({ no_lleva: false }).eq('id', s.id)
    if (concepto && cuentaId && conceptos.includes(concepto)) {
      const nuevos = conceptos.filter(c => c !== concepto)
      setConceptos(nuevos)
      await supabase.from('cuenta_opciones').upsert({ cuenta_id: cuentaId, conceptos_sin_ticket: nuevos }, { onConflict: 'cuenta_id' })
    }
  }

  // ids vacio: se quita lo que se habia ligado y vuelve a buscarse solo.
  async function ligar(s: SalidaGuardada, ids: string[]) {
    setEligiendo(null)
    setMarcados([])
    const cambio = { ticket_id: ids[0] ?? null, tickets_extra: ids.slice(1), no_lleva: false }
    setSalidas(prev => prev.map(x => x.id === s.id ? { ...x, ...cambio } : x))
    const { error } = await supabase.from('salidas_caja').update(cambio).eq('id', s.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); cargar(mes) }
  }

  // Lo que los tickets no alcanzaron a comprobar de esa salida no lleva ticket. Solo esa salida, no el concepto.
  async function restoNoLleva(s: SalidaGuardada) {
    setSalidas(prev => prev.map(x => x.id === s.id ? { ...x, no_lleva: true } : x))
    const { error } = await supabase.from('salidas_caja').update({ no_lleva: true }).eq('id', s.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); cargar(mes) }
  }

  // Se empato solo con un ticket que no es: no se vuelve a proponer para esa salida.
  async function noEs(c: SalidaConTicket) {
    const no_es = [...(c.no_es ?? []), ...c.tickets.map(t => t.id)]
    setSalidas(prev => prev.map(x => x.id === c.id ? { ...x, no_es } : x))
    const { error } = await supabase.from('salidas_caja').update({ no_es }).eq('id', c.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); cargar(mes) }
  }

  async function cerrarMes() {
    if (!cuentaId) return
    if (cerrado) {
      const { error } = await supabase.from('meses_cerrados').delete().eq('cuenta_id', cuentaId).eq('mes', `${mes}-01`)
      if (error) { toast('No se pudo: ' + error.message, 'error'); return }
      setCerrado(false); toast(`${nombreMes(mes)} quedó abierto`)
      return
    }
    if (!(await confirmar(`¿Cerrar ${nombreMes(mes)}?\n\nSi después llega un ticket de ese mes no se suma solo: te pregunto primero.`, { si: 'Sí, cerrar', no: 'Todavía no' }))) return
    const { error } = await supabase.from('meses_cerrados').insert({ cuenta_id: cuentaId, mes: `${mes}-01` })
    if (error) { toast('No se pudo: ' + error.message, 'error'); return }
    setCerrado(true); toast(`${nombreMes(mes)} cerrado`)
  }

  // Los de ese monto primero, luego los mas cerca de la fecha: una vuelta de compras se comprueba con varios tickets de esos dias.
  const candidatos = (s: SalidaGuardada) => {
    const lejos = (t: TicketCotejo) => Math.abs(Date.parse(t.fecha ?? '') - Date.parse(s.fecha))
    const igual = (t: TicketCotejo) => Math.abs(Number(t.monto) - s.monto) <= 1.5 ? 0 : 1
    const ocupado = (t: TicketCotejo) => empatados.has(t.id) ? 1 : 0
    return tickets.filter(t => t.sucursal_id === s.sucursal_id && !ligados.has(t.id) && t.fecha && lejos(t) <= 5 * 864e5)
      .sort((a, b) => (igual(a) - igual(b)) || (ocupado(a) - ocupado(b)) || (lejos(a) - lejos(b))).slice(0, 12)
  }

  // Al gerente se le pide todo lo que sigue faltando: una sugerencia no es un ticket hasta que el dueno la confirma.
  const porPedir = [...r.faltan, ...parciales.map(c => ({ ...c, monto: c.resto ?? 0 }))].sort((a, b) => b.monto - a.monto)
  const conSugerencia = r.faltan.filter(s => s.sugeridos?.length).length
  const textoWhats = `Me faltan estos tickets de ${nombreMes(mes)}:\n` + porPedir.slice(0, 30).map(s => `- ${fechaCorta(s.fecha)}: ${s.concepto || 'sin concepto'} ${pesos(s.monto)}`).join('\n') + (porPedir.length > 30 ? `\ny ${porPedir.length - 30} más` : '') + '\n¿Me los puedes subir, por favor?'
  const hayReporte = salidas.length > 0
  const sinReporte = unaSucursal ? [] : sucursales.filter(x => !salidas.some(s => s.sucursal_id === x.id))

  const filaFaltante = (s: SalidaGuardada, conNoLleva: boolean) => {
    const opciones = eligiendo === s.id ? candidatos(s) : []
    const suma = opciones.filter(t => marcados.includes(t.id)).reduce((n, t) => n + Number(t.monto), 0)
    return (
      <li key={s.id} className="space-y-2 px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-sm text-zinc-100 break-words">{s.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(s.fecha)}{deCual(s.sucursal_id)}</span></span>
          <span className="whitespace-nowrap text-sm font-medium text-zinc-200">{pesos(s.monto)}</span>
        </div>
        {!!s.sugeridos?.length && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-800/50 p-2">
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-300">{s.sugeridos.length > 1 ? '¿Son estos tickets?' : '¿Es este ticket?'} {s.sugeridos.map(t => `${t.comercio ?? 'Nota a mano'} ${pesos(t.monto)} (${fechaCorta(t.fecha)})`).join(' + ')}</p>
            <button onClick={() => ligar(s, (s.sugeridos ?? []).map(t => t.id))} className="btn-primario btn-sm min-h-[40px] min-w-[52px]">Sí</button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <button onClick={() => { setMarcados([]); setEligiendo(e => e === s.id ? null : s.id) }} aria-expanded={eligiendo === s.id} className="btn-secundario btn-sm min-h-[40px]">{s.sugeridos?.length ? 'Es otro' : 'Sí tiene ticket'}</button>
          {conNoLleva && <button onClick={() => noLleva(s)} className="btn-secundario btn-sm min-h-[40px]">No lleva ticket</button>}
        </div>
        {eligiendo === s.id && (
          <div className="space-y-1 rounded-lg bg-zinc-800/50 p-2">
            {opciones.length > 0 && <p className="etiqueta">¿Cuál es? Toca uno o varios</p>}
            {opciones.length === 0 && <p className="nota">No hay tickets sueltos cerca de esa fecha.</p>}
            {opciones.map(t => {
              const marcado = marcados.includes(t.id)
              return (
                <button key={t.id} aria-pressed={marcado} onClick={() => setMarcados(l => marcado ? l.filter(x => x !== t.id) : [...l, t.id])} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-left text-sm text-zinc-200 ${marcado ? 'bg-emerald-900/60 ring-1 ring-emerald-600' : 'hover:bg-zinc-700'}`}>
                  <span className="min-w-0 truncate">{t.comercio ?? 'Nota a mano'} <span className="text-xs text-zinc-500">· {fechaCorta(t.fecha)}</span>{empatados.has(t.id) && <span className="text-xs text-amber-400"> · ya usado</span>}</span>
                  <span className="whitespace-nowrap">{pesos(t.monto)}</span>
                </button>
              )
            })}
            {marcados.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-zinc-400">Suman {pesos(suma)} de {pesos(s.monto)}</span>
                <button onClick={() => ligar(s, marcados)} className="btn-primario btn-sm min-h-[40px]">Guardar</button>
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Tickets faltantes</h2>
        <p className="nota">Compara lo que salió de tu caja contra los tickets que subieron, y te dice cuáles faltan.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="etiqueta block">Mes</span>
          <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} className="campo" />
        </label>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={e => subirArchivo(e.target.files?.[0])} />
        <button onClick={() => inputRef.current?.click()} disabled={subiendo} className={hayReporte ? 'btn-secundario' : 'btn-primario'}>{subiendo ? 'Leyendo…' : 'Subir reporte de caja'}</button>
      </div>

      {porSubir && (
        <div className="tarjeta space-y-2 p-4">
          <p className="text-[15px] font-medium text-zinc-100">{porSubir.dudas[0] ? `El reporte dice "${porSubir.dudas[0]}". ¿Qué sucursal es?` : '¿De qué sucursal es este reporte?'}</p>
          <div className="flex flex-wrap gap-2">
            {sucursales.map(x => <button key={x.id} disabled={subiendo} onClick={() => contestarSucursal(x.id)} className="btn-secundario">{x.nombre}</button>)}
            <button onClick={() => setPorSubir(null)} className="btn-quieto">Cancelar</button>
          </div>
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      ) : fallo ? (
        <div className="tarjeta space-y-2 p-4">
          <p className="text-[15px] font-medium text-zinc-100">No pude cargar los datos</p>
          <p className="text-[13px] leading-relaxed text-zinc-400">Revisa tu internet e intenta otra vez. Lo que ya subiste está guardado.</p>
          <button onClick={() => cargar(mes)} className="btn-secundario">Intentar otra vez</button>
        </div>
      ) : !hayReporte ? (
        <div className="tarjeta space-y-2 p-4">
          <p className="text-[15px] font-medium text-zinc-100">Falta el reporte de caja de {nombreMes(mes)}</p>
          <p className="text-[13px] leading-relaxed text-zinc-400">En tu punto de venta busca el reporte de <b className="font-medium">pagos de entrada y salida</b> de caja, descárgalo (CSV o Excel) y súbelo aquí. Lo demás lo hago yo.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { t: 'Debe llevar ticket', v: sumar(r.conTicket) + sumar(r.faltan), c: 'text-zinc-100' },
              { t: 'Con ticket', v: sumar(r.conTicket) - sinComprobar, c: 'text-emerald-400' },
              { t: `Faltan ${cuantosFaltan}`, v: sumar(r.faltan) + sinComprobar, c: cuantosFaltan ? 'text-amber-400' : 'text-emerald-400' },
            ].map(x => (
              <div key={x.t} className="tarjeta p-3">
                <p className="etiqueta">{x.t}</p>
                <p className={`text-base font-semibold sm:text-xl ${x.c}`}>{pesos(x.v)}</p>
              </div>
            ))}
          </div>

          {sinReporte.length > 0 && <p className="nota">Todavía sin reporte de {nombreMes(mes)}: {sinReporte.map(x => x.nombre).join(', ')}.</p>}

          {cuantosFaltan === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900">
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
              </span>
              <p className="text-base font-semibold text-zinc-100">No falta ninguno</p>
            </div>
          ) : (
            <section aria-labelledby="faltan" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="faltan" className="text-base font-semibold text-zinc-100">Salió dinero y no hay ticket</h3>
                {unaSucursal
                  ? porPedir.length > 0 && <a href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer" className="btn-secundario btn-sm">Pedirlos por WhatsApp</a>
                  : <span className="nota">Elige una sucursal arriba para pedirlos por WhatsApp</span>}
              </div>
              {conSugerencia > 0 && <p className="nota">En {conSugerencia} creo saber cuál es su ticket: con un toque quedan.</p>}
              <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
                {grupos.map(({ clave, lista }) => lista.length === 1 ? filaFaltante(lista[0], true) : (
                  <li key={clave} className="space-y-2 px-3 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm text-zinc-100 break-words">{lista[0].concepto} <span className="text-xs text-zinc-500">· {lista.length} veces{deCual(lista[0].sucursal_id)}{lista.some(s => s.sugeridos?.length) ? ' · con sugerencia' : ''}</span></span>
                      <span className="whitespace-nowrap text-sm font-medium text-zinc-200">{pesos(sumar(lista))}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setAbiertos(l => l.includes(clave) ? l.filter(x => x !== clave) : [...l, clave])} aria-expanded={abiertos.includes(clave)} className="btn-secundario btn-sm min-h-[40px]">{abiertos.includes(clave) ? 'Ocultar' : 'Ver cuáles'}</button>
                      <button onClick={() => noLleva(lista[0])} className="btn-secundario btn-sm min-h-[40px]">No lleva ticket</button>
                    </div>
                    {abiertos.includes(clave) && <ul className="divide-y divide-zinc-800 rounded-lg bg-zinc-900/40">{lista.map(s => filaFaltante(s, false))}</ul>}
                  </li>
                ))}
                {parciales.map(c => (
                  <li key={c.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm text-zinc-100 break-words">{c.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(c.fecha)}{deCual(c.sucursal_id)} · con tickets {pesos(sumar(c.tickets))} de {pesos(c.monto)}</span></span>
                      <span className="whitespace-nowrap text-sm font-medium text-amber-400">faltan {pesos(c.resto)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => restoNoLleva(c)} className="btn-secundario btn-sm min-h-[40px]">Lo demás no lleva ticket</button>
                      <button onClick={() => ligar(c, [])} className="btn-secundario btn-sm min-h-[40px]">Quitar tickets</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sinSalida.length > 0 && (
            <details className="rounded-xl border border-zinc-800 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-300">Se pagaron de la caja y no encontré su salida · {sinSalida.length} · {pesos(sumar(sinSalida))}</summary>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                {sinSalida.map(t => <li key={t.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{t.comercio ?? 'Nota a mano'} <span className="text-xs text-zinc-500">· {fechaCorta(t.fecha)}</span></span><span>{pesos(t.monto)}</span></li>)}
              </ul>
            </details>
          )}
          <details className="rounded-xl border border-zinc-800 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-zinc-300">No llevan ticket (propinas, bonos…) · {r.noLlevan.length} · {pesos(sumar(r.noLlevan))}</summary>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {r.noLlevan.map(s => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{s.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(s.fecha)}</span></span>
                  <span className="flex items-center gap-2 whitespace-nowrap">{pesos(s.monto)}{(s.no_lleva || conceptos.includes(normalizarConcepto(s.concepto))) && <button onClick={() => siLleva(s)} className="btn-quieto btn-sm">Sí lleva</button>}</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="rounded-xl border border-zinc-800 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-zinc-300">Con ticket · {r.conTicket.length} · {pesos(sumar(r.conTicket) - sinComprobar)}</summary>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {r.conTicket.map(c => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{c.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(c.fecha)} → {c.tickets.map(t => t.comercio ?? 'nota').join(' + ')}</span>{!!c.resto && <span className="text-xs text-amber-400"> · faltan {pesos(c.resto)}</span>}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap">{pesos(c.monto)}{c.como === 'manual' ? <button onClick={() => ligar(c, [])} className="btn-quieto btn-sm min-h-[40px]">Quitar</button> : <button onClick={() => noEs(c)} className="btn-quieto btn-sm min-h-[40px]">No es este</button>}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {incompletas.length > 0 && (
        <section aria-labelledby="cuentas" className="space-y-2">
          <div>
            <h3 id="cuentas" className="text-base font-semibold text-zinc-100">Cuentas a mano que no alcanzan</h3>
            <p className="nota">Escribieron cuánto se gastó en la vuelta, y los tickets de esos días no llegan a esa cantidad.</p>
          </div>
          <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
            {incompletas.map(c => (
              <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-3 text-sm">
                <span className="min-w-0 text-zinc-100">{c.comercio ?? 'Nota a mano'} <span className="text-xs text-zinc-500">· {fechaCorta(c.fecha)} · a mano {pesos(c.compra)}, con tickets {pesos(c.comprobado)}</span></span>
                <span className="whitespace-nowrap font-medium text-amber-400">faltan {pesos(c.falta)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <p className="min-w-[200px] flex-1 text-[13px] leading-relaxed text-zinc-400">
          {cerrado ? `${nombreMes(mes)} está cerrado: si llega un ticket de ese mes, te pregunto antes de sumarlo.` : `¿Ya quedó ${nombreMes(mes)}? Ciérralo y ningún ticket que llegue tarde te cambia las cuentas sin avisarte.`}
        </p>
        <button onClick={cerrarMes} className={cerrado ? 'btn-quieto' : 'btn-secundario'}>{cerrado ? `Reabrir ${nombreMes(mes)}` : `Cerrar ${nombreMes(mes)}`}</button>
      </section>
    </div>
  )
}
