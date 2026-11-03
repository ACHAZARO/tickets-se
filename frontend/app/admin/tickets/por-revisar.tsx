'use client'

import { useEffect, useMemo, useState } from 'react'

// Por revisar: lo minimo que el dueno tiene que ver, sin importar de que mes sea el ticket. Dos grupos:
// - "Necesitan tu decision": cada ticket dice en palabras claras que hay que resolver; se abren uno por uno.
// - "Se ven bien": notas a mano y remisiones (siempre las ve una persona, decision del 07-oct) y tickets que solo traen articulos
//   nuevos con categoria y unidad; la IA no encontro nada raro. Se aprueban juntos con un solo toque y los nuevos se aprenden ahi.

export interface AlertaRevisar { tipo: string; correccion: Record<string, unknown> | null }
export interface RenglonRevisar {
  id: string
  descripcion: string
  monto: number | null
  unidad: string | null
  categoria_id: string | null
  producto_catalogo_id: string | null
}
export interface TicketRevisar {
  id: string
  tipo: string | null
  comercio: string | null
  monto: number | null
  fecha: string | null
  sucursal: string | null
  subio: string | null
  url: string | null
  nota: string | null
  alertas: AlertaRevisar[]
  renglones: RenglonRevisar[]
  leyendo: boolean
}

// Una alerta suave no pide decidir nada: ese tipo de papel siempre lo ve una persona, o trae articulos nuevos que la IA ya acomodo.
export const SUAVES = new Set(['nota_a_mano', 'producto_no_reconocido', 'sin_unidad'])
const PAPELES = ['ticket', 'factura', 'nota_a_mano', 'remision']

export function seVeBien(t: TicketRevisar): boolean {
  if (t.leyendo || !t.fecha || !PAPELES.includes(t.tipo ?? '') || !t.renglones.length) return false
  return t.alertas.every(a => SUAVES.has(a.tipo)) && t.renglones.every(r => r.producto_catalogo_id || r.categoria_id)
}

const nuevosDe = (t: TicketRevisar) => t.renglones.filter(r => !r.producto_catalogo_id)
const terminacionDe = (a: AlertaRevisar) => a.tipo === 'pago_distinto' && typeof a.correccion?.motivo === 'string'
  ? /terminaci[oó]n (\d+)/.exec(a.correccion.motivo)?.[1] ?? null : null

const PREGUNTAS: Record<string, string> = {
  posible_duplicado: 'Puede ser el mismo gasto que otro ticket.',
  duplicado: 'Esta foto ya se había subido.',
  cuenta_a_mano: 'Trae una cuenta a mano de varios tickets: revisa que estén todos.',
  ilegible: 'La foto no se lee bien: compara los datos con la foto.',
  ia_sin_leer: 'La IA no pudo leerlo: vuelve a intentarlo o captúralo.',
  producto_no_reconocido: 'Trae artículos que la IA todavía no conoce: dile cuáles son.',
  sin_fecha: 'La fecha escrita no tiene sentido: revísala para que caiga en el mes correcto.',
  monto_anomalo: 'Los artículos no suman el total: revisa los montos.',
  precio_anomalo: 'Un precio salió muy distinto a lo normal.',
  envio_alto: 'El envío salió muy caro.',
  pagos_no_cuadran: 'Las formas de pago no suman el total.',
  pago_distinto: 'El papel dice una forma de pago y se declaró otra.',
  articulo_no_autorizado: 'Trae un artículo no autorizado: decide si cuenta.',
  articulo_ocasional: 'Trae una compra ocasional: confirma que estuvo bien.',
  articulo_vigilado: 'Trae un artículo que pediste vigilar.',
  revisar_gerente: 'Hay algo que preguntar.',
}

/** Lo que hay que resolver en cada ticket, en palabras claras. El motivo especifico manda sobre el texto general. */
export function preguntasDe(t: { alertas: AlertaRevisar[]; fecha: string | null; tipo?: string | null }): string[] {
  const vistas = new Set<string>()
  for (const a of t.alertas) {
    if (a.tipo === 'nota_a_mano' || a.tipo === 'sin_unidad') continue
    const motivo = typeof a.correccion?.motivo === 'string' ? a.correccion.motivo.trim() : ''
    vistas.add(motivo || PREGUNTAS[a.tipo] || 'Revisa este ticket.')
  }
  if (!t.fecha) vistas.add('Falta la fecha del ticket.')
  if (t.tipo !== undefined && !PAPELES.includes(t.tipo ?? '')) vistas.add('Este papel no parece ticket ni factura: revisa qué es.')
  return [...vistas]
}

const nombreDe = (t: TicketRevisar) => t.comercio ?? (t.tipo === 'nota_a_mano' ? 'Nota a mano' : t.tipo === 'remision' ? 'Remisión' : 'Sin comercio')
const fmt = (n: number | null) => n == null ? '—' : '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Foto({ url, onClick, etiqueta }: { url: string | null; onClick: () => void; etiqueta: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={etiqueta} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
    </button>
  )
}

export function PorRevisar({ tickets, cargando, abrir, aprobar, conocerTarjeta, irAFraude, enFraude }: {
  tickets: TicketRevisar[]
  cargando: boolean
  abrir: (id: string) => void
  /** Aprueba esos tickets; llama al avance con cuantos van. Devuelve cuantos fallaron. */
  aprobar: (ids: string[], avance: (hechos: number) => void) => Promise<number>
  conocerTarjeta: (terminacion: string) => void
  irAFraude: () => void
  enFraude: number
}) {
  const leyendo = tickets.filter(t => t.leyendo)
  const bien = useMemo(() => tickets.filter(seVeBien), [tickets])
  const decidir = useMemo(() => tickets.filter(t => !t.leyendo && !seVeBien(t)), [tickets])
  // Quitados a mano del lote: todos los demas van marcados.
  const [quitados, setQuitados] = useState<Set<string>>(new Set())
  const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null)
  useEffect(() => { setQuitados(prev => new Set([...prev].filter(id => bien.some(t => t.id === id)))) }, [bien])

  const marcados = bien.filter(t => !quitados.has(t.id))
  const sumaMarcados = marcados.reduce((s, t) => s + (Number(t.monto) || 0), 0)

  async function aprobarMarcados() {
    const ids = marcados.map(t => t.id)
    setAvance({ hechos: 0, total: ids.length })
    await aprobar(ids, hechos => setAvance({ hechos, total: ids.length }))
    setAvance(null)
  }

  if (cargando && !tickets.length) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
  }

  if (!tickets.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900">
          <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
        </span>
        <p className="text-base font-semibold text-zinc-100">Nada por revisar</p>
        <p className="nota max-w-sm">Cuando la IA tenga una duda sobre un ticket, aparece aquí con la pregunta.</p>
        {enFraude > 0 && <button onClick={irAFraude} className="btn-texto btn-sm">Ver {enFraude} en Fraude</button>}
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {leyendo.length > 0 && (
        <p className="rounded-lg bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300">
          La IA está leyendo {leyendo.length === 1 ? '1 ticket' : `${leyendo.length} tickets`}. Aparecen aquí en cuanto termine, si hay algo que ver.
        </p>
      )}

      {decidir.length > 0 && (
        <section aria-labelledby="decidir" className="space-y-2">
          <h3 id="decidir" className="text-base font-semibold text-zinc-100">Necesitan tu decisión <span className="font-normal text-zinc-500">· {decidir.length}</span></h3>
          {decidir.map(t => (
            <div key={t.id} className="tarjeta flex gap-3 p-3">
              <Foto url={t.url} onClick={() => abrir(t.id)} etiqueta={`Ver ${t.comercio ?? 'ticket'}`} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => abrir(t.id)} className="w-full text-left">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{nombreDe(t)}</span>
                    <span className="whitespace-nowrap text-sm font-medium text-zinc-200">{fmt(t.monto)}</span>
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{[t.sucursal, t.fecha, t.subio && `subió ${t.subio}`].filter(Boolean).join(' · ')}</span>
                  {(preguntasDe(t).length ? preguntasDe(t) : ['Revisa este ticket.']).map(p => <span key={p} className="mt-1 block text-[13px] leading-snug text-amber-300">{p}</span>)}
                  {t.nota && <span className="mt-1 block truncate text-xs text-blue-400">Nota: {t.nota}</span>}
                  <span className="mt-1.5 block text-[13px] font-medium text-emerald-500">Ver y decidir ›</span>
                </button>
                {t.alertas.map(terminacionDe).filter(Boolean).slice(0, 1).map(term => (
                  <button key={term} type="button" onClick={() => conocerTarjeta(term as string)} className="btn-texto btn-sm -ml-2 mt-1">
                    Conozco la tarjeta {term}: ya no preguntar
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {bien.length > 0 && (
        <section aria-labelledby="bien" className="space-y-2">
          <div>
            <h3 id="bien" className="text-base font-semibold text-zinc-100">Se ven bien <span className="font-normal text-zinc-500">· {bien.length}</span></h3>
            <p className="nota max-w-2xl">La IA los leyó y no encontró nada raro: son papeles a mano o traen artículos nuevos, por eso te los enseña. Échales un ojo y apruébalos juntos. Toca la foto para verla grande; quita la palomita del que quieras revisar con calma.</p>
          </div>
          {bien.map(t => {
            const marcado = !quitados.has(t.id)
            return (
              <div key={t.id} className={`tarjeta flex items-center gap-3 p-3 ${marcado ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={marcado} aria-label={`Aprobar ${t.comercio ?? 'ticket'} ${fmt(t.monto)}`}
                  onChange={() => setQuitados(q => { const n = new Set(q); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })}
                  className="h-5 w-5 shrink-0 accent-emerald-600" />
                <Foto url={t.url} onClick={() => abrir(t.id)} etiqueta={`Ver ${t.comercio ?? 'ticket'}`} />
                <button type="button" onClick={() => abrir(t.id)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{nombreDe(t)}</span>
                    <span className="whitespace-nowrap text-sm font-medium text-zinc-200">{fmt(t.monto)}</span>
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{[t.sucursal, t.fecha].filter(Boolean).join(' · ')}</span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-400">
                    {t.renglones.slice(0, 3).map(r => r.descripcion).join(' · ')}{t.renglones.length > 3 ? ` y ${t.renglones.length - 3} más` : ''}
                  </span>
                  {t.alertas.some(a => typeof a.correccion?.motivo === 'string' && a.correccion.motivo.includes('sin fecha')) && (
                    <span className="mt-0.5 block text-xs text-amber-400">No trae fecha: se usó el día en que se subió.</span>
                  )}
                  {nuevosDe(t).length > 0 && (
                    <span className="mt-0.5 block truncate text-xs text-emerald-400">Aprenderá: {nuevosDe(t).map(r => r.descripcion).join(', ')}</span>
                  )}
                  {t.nota && <span className="mt-0.5 block truncate text-xs text-blue-400">Nota: {t.nota}</span>}
                </button>
              </div>
            )
          })}
          <div className="sticky bottom-3 z-10 pt-1">
            <button onClick={aprobarMarcados} disabled={!marcados.length || !!avance} className="btn-primario w-full py-3 text-base shadow-lg">
              {avance ? `Aprobando ${avance.hechos} de ${avance.total}…`
                : !marcados.length ? 'Marca al menos uno'
                : `Aprobar ${marcados.length === 1 ? 'el marcado' : `los ${marcados.length} marcados`} · ${fmt(sumaMarcados)}`}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
