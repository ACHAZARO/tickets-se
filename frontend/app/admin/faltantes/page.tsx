'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { cotejar, cuentasIncompletas, leerCsv, normalizarConcepto, salidasDeReporte } from '@/lib/faltantes.mjs'
import type { Cotejo, CuentaIncompleta, SalidaGuardada, SalidaLeida, TicketCotejo } from '@/lib/faltantes-tipos'
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
  const [sucursalSubir, setSucursalSubir] = useState('')
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
        let q = supabase.from('salidas_caja').select('id, fecha, hora, concepto, monto, empleado, no_lleva, ticket_id').gte('fecha', ini).lte('fecha', fin).order('fecha').order('hora')
        if (sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      }),
      // Unos dias antes y despues: una salida del dia 1 puede pagar un ticket del dia 30.
      traerTodo(() => {
        let q = supabase.from('registros_tickets').select('id, fecha_ticket, monto, comercio, resumen:gemini_raw->resumen_mano, ticket_pagos(formas_pago(sale_de_caja))')
          .gte('fecha_ticket', moverDias(ini, -5)).lte('fecha_ticket', moverDias(fin, 5)).neq('estado', 'rechazado')
        if (sucursalId) q = q.eq('sucursal_id', sucursalId)
        return q
      }),
      cuenta ? supabase.from('cuenta_opciones').select('conceptos_sin_ticket').eq('cuenta_id', cuenta).maybeSingle() : Promise.resolve({ data: null }),
      cuenta ? supabase.from('meses_cerrados').select('mes').eq('cuenta_id', cuenta).eq('mes', ini).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setSalidas(((sal.data as unknown as SalidaGuardada[]) ?? []).map(s => ({ ...s, monto: Number(s.monto) })))
    type F = { id: string; fecha_ticket: string | null; monto: number | null; comercio: string | null; resumen: { compra_total?: number; envio?: number; total?: number } | null; ticket_pagos: { formas_pago: { sale_de_caja: boolean } | null }[] }
    setTickets(((tic.data as unknown as F[]) ?? []).map(t => ({
      id: t.id, fecha: t.fecha_ticket, monto: t.monto, comercio: t.comercio,
      deCaja: !!t.ticket_pagos?.length && t.ticket_pagos.every(p => p.formas_pago?.sale_de_caja),
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
  const r = useMemo(() => cotejar(salidas, tickets, conceptos) as Cotejo, [salidas, tickets, conceptos])
  const incompletas = useMemo(() => (cuentasIncompletas(tickets) as CuentaIncompleta[]).filter(c => dentroDelMes(c.fecha)), [tickets, dentroDelMes])
  const sinSalida = useMemo(() => r.ticketsSinSalida.filter(t => dentroDelMes(t.fecha)), [r.ticketsSinSalida, dentroDelMes])
  const usados = useMemo(() => new Set(r.conTicket.flatMap(c => c.tickets.map(t => t.id))), [r.conTicket])

  async function subirArchivo(archivo: File | undefined) {
    if (!archivo) return
    const sucursal = sucursalSubir || sucursalId || (sucursales.length === 1 ? sucursales[0].id : '')
    if (!sucursal) { toast('Primero elige de qué sucursal es el reporte', 'error'); return }
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
      await ensureFreshSession()
      const filasBd = nuevas.map(s => ({ ...s, sucursal_id: sucursal }))
      let insertadas = 0
      for (let i = 0; i < filasBd.length; i += 300) {
        const { data, error: e } = await supabase.from('salidas_caja').upsert(filasBd.slice(i, i + 300), { onConflict: 'cuenta_id,huella', ignoreDuplicates: true }).select('id')
        if (e) { toast('No se pudo guardar: ' + e.message, 'error'); return }
        insertadas += data?.length ?? 0
      }
      const meses = [...new Set(nuevas.map(s => s.fecha.slice(0, 7)))].sort()
      toast(insertadas ? `Listo: ${insertadas} salidas de caja de ${meses.map(nombreMes).join(' y ')}` : 'Ese reporte ya estaba subido')
      const ultimo = meses[meses.length - 1]
      if (ultimo === mes) cargar(mes); else setMes(ultimo)
    } catch {
      toast('No pude leer ese archivo. Súbelo como CSV o Excel.', 'error')
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ''
    }
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
      await supabase.from('cuenta_opciones').upsert({ cuenta_id: cuentaId, conceptos_sin_ticket: nuevos }, { onConflict: 'cuenta_id' })
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

  async function ligar(s: SalidaGuardada, ticketId: string) {
    setEligiendo(null)
    setSalidas(prev => prev.map(x => x.id === s.id ? { ...x, ticket_id: ticketId } : x))
    const { error } = await supabase.from('salidas_caja').update({ ticket_id: ticketId }).eq('id', s.id)
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

  const candidatos = (s: SalidaGuardada) => tickets.filter(t => !usados.has(t.id) && t.fecha && Math.abs(Date.parse(t.fecha) - Date.parse(s.fecha)) <= 5 * 864e5)
    .sort((a, b) => Math.abs(Number(a.monto) - s.monto) - Math.abs(Number(b.monto) - s.monto)).slice(0, 8)

  const textoWhats = `Me faltan estos tickets de ${nombreMes(mes)}:\n` + r.faltan.map(s => `- ${fechaCorta(s.fecha)}: ${s.concepto || 'sin concepto'} ${pesos(s.monto)}`).join('\n') + '\n¿Me los puedes subir, por favor?'
  const hayReporte = salidas.length > 0

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
        {sucursales.length > 1 && !sucursalId && (
          <label className="space-y-1">
            <span className="etiqueta block">Sucursal del reporte</span>
            <select value={sucursalSubir} onChange={e => setSucursalSubir(e.target.value)} className="campo">
              <option value="">Elige…</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={e => subirArchivo(e.target.files?.[0])} />
        <button onClick={() => inputRef.current?.click()} disabled={subiendo} className={hayReporte ? 'btn-secundario' : 'btn-primario'}>{subiendo ? 'Leyendo…' : 'Subir reporte de caja'}</button>
      </div>

      {cargando ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      ) : !hayReporte ? (
        <div className="tarjeta space-y-2 p-4">
          <p className="text-[15px] font-medium text-zinc-100">Falta el reporte de caja de {nombreMes(mes)}</p>
          <p className="text-[13px] leading-relaxed text-zinc-400">En tu punto de venta busca el reporte de <b className="font-medium">pagos de entrada y salida</b> de caja, descárgalo (CSV o Excel) y súbelo aquí. Lo demás lo hago yo.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { t: 'Salió de caja', v: sumar(r.conTicket) + sumar(r.faltan), c: 'text-zinc-100' },
              { t: 'Con ticket', v: sumar(r.conTicket), c: 'text-emerald-400' },
              { t: `Faltan ${r.faltan.length}`, v: sumar(r.faltan), c: r.faltan.length ? 'text-amber-400' : 'text-emerald-400' },
            ].map(x => (
              <div key={x.t} className="tarjeta p-3">
                <p className="etiqueta">{x.t}</p>
                <p className={`text-base font-semibold sm:text-xl ${x.c}`}>{pesos(x.v)}</p>
              </div>
            ))}
          </div>

          {r.faltan.length === 0 ? (
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
                <a href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer" className="btn-secundario btn-sm">Pedirlos por WhatsApp</a>
              </div>
              <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
                {r.faltan.map(s => (
                  <li key={s.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm text-zinc-100 break-words">{s.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(s.fecha)}</span></span>
                      <span className="whitespace-nowrap text-sm font-medium text-zinc-200">{pesos(s.monto)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setEligiendo(e => e === s.id ? null : s.id)} className="btn-quieto btn-sm">Sí tiene ticket</button>
                      <button onClick={() => noLleva(s)} className="btn-quieto btn-sm">No lleva ticket</button>
                    </div>
                    {eligiendo === s.id && (
                      <div className="space-y-1 rounded-lg bg-zinc-800/50 p-2">
                        <p className="etiqueta">¿Cuál es?</p>
                        {candidatos(s).length === 0 && <p className="nota">No hay tickets sueltos cerca de esa fecha.</p>}
                        {candidatos(s).map(t => (
                          <button key={t.id} onClick={() => ligar(s, t.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-700">
                            <span className="min-w-0 truncate">{t.comercio ?? 'Nota a mano'} <span className="text-xs text-zinc-500">· {fechaCorta(t.fecha)}</span></span>
                            <span className="whitespace-nowrap">{pesos(t.monto)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sinSalida.length > 0 && (
            <details className="rounded-xl border border-zinc-800 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-300">Dicen que se pagó de la caja, pero no salió · {sinSalida.length} · {pesos(sumar(sinSalida))}</summary>
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
            <summary className="cursor-pointer text-sm font-medium text-zinc-300">Con ticket · {r.conTicket.length} · {pesos(sumar(r.conTicket))}</summary>
            <ul className="mt-2 space-y-1 text-sm text-zinc-300">
              {r.conTicket.map(c => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{c.concepto || 'Sin concepto'} <span className="text-xs text-zinc-500">· {fechaCorta(c.fecha)} → {c.tickets.map(t => t.comercio ?? 'nota').join(' + ')}</span></span>
                  <span>{pesos(c.monto)}</span>
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
