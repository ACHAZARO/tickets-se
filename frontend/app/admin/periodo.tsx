'use client'

import { useMemo, useState } from 'react'
import { rangoDeMes } from '@/lib/arqueo'

// Selector de periodo compartido (Tickets, Entradas): "Por mes" (elige el mes y salta con las flechas) o "Rango"
// (dos fechas). Mismo look que el de Gasto. Es controlado: la pagina guarda desde/hasta (AAAA-MM-DD).

const hoyMx = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10) // Mexico, UTC-6 fijo
export const mesActualMx = () => hoyMx().slice(0, 7)
/** Primer y ultimo dia del mes actual (hora de Mexico): periodo con el que abren las pantallas. */
export const rangoMesActual = () => rangoDeMes(mesActualMx())

function moverMes(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function mesesRecientes(n: number): string[] {
  const actual = mesActualMx()
  return Array.from({ length: n }, (_, i) => moverMes(actual, -i))
}
const nombreMesLargo = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return t.charAt(0).toUpperCase() + t.slice(1) // "Julio de 2026" (solo la primera letra)
}
/** 'AAAA-MM' si [desde, hasta] es exactamente un mes completo; si no, null. */
function mesCompleto(desde: string, hasta: string): string | null {
  if (desde.length < 7) return null
  const ym = desde.slice(0, 7)
  const r = rangoDeMes(ym)
  return desde === r.inicio && hasta === r.fin ? ym : null
}

const controlCls = 'rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100'
const flechaCls = 'rounded-lg bg-zinc-900 border border-zinc-800 w-9 h-9 flex items-center justify-center text-zinc-300 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-300'
// Flechas dibujadas: los caracteres ◀ ▶ salen como emoji azul en Windows.
const Chevron = ({ dir }: { dir: 'izq' | 'der' }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'izq' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
  </svg>
)

export function SelectorPeriodo({ desde, hasta, onChange }: {
  desde: string
  hasta: string
  onChange: (desde: string, hasta: string) => void
}) {
  const [modo, setModo] = useState<'mes' | 'rango'>(mesCompleto(desde, hasta) ? 'mes' : 'rango')
  const recientes = useMemo(() => mesesRecientes(12), [])
  const actual = mesActualMx()
  const mes = desde.slice(0, 7)
  // Si el mes elegido (con las flechas) ya no esta en la lista de 12, se agrega para que el select lo muestre.
  const meses = recientes.includes(mes) ? recientes : [...recientes, mes].sort().reverse()

  const irAMes = (ym: string) => { const r = rangoDeMes(ym); onChange(r.inicio, r.fin) }
  const cambiarModo = (m: 'mes' | 'rango') => {
    setModo(m)
    if (m === 'mes' && !mesCompleto(desde, hasta)) irAMes(desde.length >= 7 ? mes : actual)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg bg-zinc-900 p-1">
        {(['mes', 'rango'] as const).map(m => (
          <button key={m} type="button" onClick={() => cambiarModo(m)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${modo === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}>
            {m === 'mes' ? 'Por mes' : 'Rango'}
          </button>
        ))}
      </div>
      {modo === 'mes' ? (
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Mes anterior" onClick={() => irAMes(moverMes(mes, -1))} className={flechaCls}><Chevron dir="izq" /></button>
          <select value={mes} onChange={e => irAMes(e.target.value)} className={controlCls}>
            {meses.map(m => <option key={m} value={m}>{nombreMesLargo(m)}</option>)}
          </select>
          <button type="button" aria-label="Mes siguiente" onClick={() => irAMes(moverMes(mes, 1))} disabled={mes >= actual} className={flechaCls}><Chevron dir="der" /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="date" aria-label="Desde" value={desde} onChange={e => e.target.value && onChange(e.target.value, hasta)} className={controlCls} />
          <span className="text-zinc-600">→</span>
          <input type="date" aria-label="Hasta" value={hasta} onChange={e => e.target.value && onChange(desde, e.target.value)} className={controlCls} />
        </div>
      )}
    </div>
  )
}
