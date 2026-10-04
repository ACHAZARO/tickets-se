'use client'

import { useEffect, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useToast } from '../ui'

// Como se pago un ticket segun el gerente (ticket_pagos, migracion 085). Una sola forma = todo el ticket (monto null);
// varias = monto por cada una. Sin filas = "No registrado" (todo lo anterior al 03-oct-2026; no se infiere).
export interface PagoTicket {
  forma_pago_id: string
  monto: number | null
  formas_pago: { nombre: string; sale_de_caja: boolean; orden: number } | null
}
interface Forma { id: string; nombre: string; sale_de_caja: boolean; activa: boolean; orden: number }

// Mismo criterio que el servidor (_shared/pagos.ts): centavos de redondeo no cuentan.
const TOLERANCIA = 1
const pesos = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ordenados = (p: PagoTicket[]) => [...p].sort((a, b) => (a.formas_pago?.orden ?? 0) - (b.formas_pago?.orden ?? 0))

export function textoPagos(pagos?: PagoTicket[] | null): string | null {
  if (!pagos?.length) return null
  return ordenados(pagos).map(p => (p.monto === null ? p.formas_pago?.nombre ?? '?' : `${p.formas_pago?.nombre ?? '?'} ${pesos(Number(p.monto))}`)).join(' + ')
}
export function pagosNoCuadran(pagos: PagoTicket[] | null | undefined, total: number | null): boolean {
  const conMonto = (pagos ?? []).filter(p => p.monto !== null)
  if (!conMonto.length) return false
  if (total == null) return true
  return Math.abs(conMonto.reduce((s, p) => s + Number(p.monto), 0) - Number(total)) >= TOLERANCIA
}
function leerMonto(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(limpio)
  return limpio && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export default function PagosTicket({ ticketId, total, pagos, onGuardado }: {
  ticketId: string
  total: number | null
  pagos: PagoTicket[]
  onGuardado: (pagos: PagoTicket[]) => void
}) {
  const toast = useToast()
  const [editando, setEditando] = useState(false)
  const [formas, setFormas] = useState<Forma[]>([])
  const [elegidas, setElegidas] = useState<string[]>([])
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!editando) return
    supabase.from('formas_pago').select('id, nombre, sale_de_caja, activa, orden').order('orden').order('nombre')
      .then(({ data }) => setFormas((data ?? []) as Forma[]))
    setElegidas(ordenados(pagos).map(p => p.forma_pago_id))
    setMontos(Object.fromEntries(pagos.map(p => [p.forma_pago_id, p.monto === null ? '' : String(p.monto)])))
  }, [editando, pagos])

  const texto = textoPagos(pagos)
  const caja = pagos.length
    ? pagos.filter(p => p.formas_pago?.sale_de_caja).reduce((s, p) => s + Number(p.monto ?? total ?? 0), 0)
    : null
  const noCuadra = pagosNoCuadran(pagos, total)
  const esMixto = elegidas.length > 1
  const faltaMonto = esMixto && elegidas.some(id => leerMonto(montos[id] ?? '') === null)
  const suma = esMixto ? elegidas.reduce((s, id) => s + (leerMonto(montos[id] ?? '') ?? 0), 0) : 0

  async function guardar() {
    if (faltaMonto) return
    setGuardando(true)
    try {
      await ensureFreshSession()
      const filas = elegidas.map(id => ({ registro_ticket_id: ticketId, forma_pago_id: id, monto: esMixto ? leerMonto(montos[id] ?? '') : null }))
      const { error: delErr } = await supabase.from('ticket_pagos').delete().eq('registro_ticket_id', ticketId)
      if (delErr) { toast('No se pudo guardar: ' + delErr.message, 'error'); return }
      if (filas.length) {
        const { error: insErr } = await supabase.from('ticket_pagos').insert(filas)
        if (insErr) { toast('No se pudo guardar (el ticket quedo sin pagos, vuelve a intentar): ' + insErr.message, 'error'); return }
      }
      const nuevos: PagoTicket[] = filas.map(f => {
        const fo = formas.find(x => x.id === f.forma_pago_id)
        return { forma_pago_id: f.forma_pago_id, monto: f.monto, formas_pago: fo ? { nombre: fo.nombre, sale_de_caja: fo.sale_de_caja, orden: fo.orden } : null }
      })
      // Ya cuadra (o ya no es mixto): se cierra la alerta.
      if (!pagosNoCuadran(nuevos, total)) {
        await supabase.from('alertas_tickets').update({ resuelta: true })
          .eq('registro_ticket_id', ticketId).eq('tipo', 'pagos_no_cuadran').eq('resuelta', false)
      }
      onGuardado(nuevos)
      setEditando(false)
    } finally {
      setGuardando(false)
    }
  }

  if (!editando) {
    return (
      <div className="mt-1 text-xs text-zinc-400">
        Pagado con:{' '}
        {texto ? <span className="font-medium text-zinc-100">{texto}</span> : <span className="text-zinc-500">No registrado</span>}
        {caja !== null && <span className="text-zinc-500"> · salió de Caja {pesos(caja)}</span>}
        <button onClick={() => setEditando(true)} className="ml-2 text-blue-400 hover:text-blue-300">corregir</button>
        {noCuadra && <p className="mt-0.5 text-red-300">Los pagos no suman el total del ticket ({total != null ? pesos(Number(total)) : 'sin total'}).</p>}
      </div>
    )
  }

  // Formas activas + las apagadas que este ticket ya usa (para no perderlas al corregir).
  const visibles = formas.filter(f => f.activa || elegidas.includes(f.id))
  return (
    <div className="mt-2 max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2">
      <p className="text-xs font-medium text-zinc-300">¿Cómo se pagó? {esMixto && <span className="font-normal text-zinc-500">(monto de cada una)</span>}</p>
      {visibles.map(f => {
        const activo = elegidas.includes(f.id)
        return (
          <div key={f.id} className="flex items-center gap-2">
            <button
              onClick={() => setElegidas(prev => (prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]))}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-left text-xs ${activo ? 'border-zinc-100 bg-zinc-100 text-zinc-900' : 'border-zinc-800 bg-zinc-900 text-zinc-300'}`}
            >{f.nombre}{!f.activa && ' (apagada)'}</button>
            {activo && esMixto && (
              <input
                inputMode="decimal"
                value={montos[f.id] ?? ''}
                placeholder="$ monto"
                onChange={e => setMontos(m => ({ ...m, [f.id]: e.target.value }))}
                className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-xs text-zinc-100"
              />
            )}
          </div>
        )
      })}
      {esMixto && !faltaMonto && (
        <p className={`text-right text-xs ${total != null && Math.abs(suma - Number(total)) < TOLERANCIA ? 'text-emerald-400' : 'text-amber-400'}`}>
          Suma {pesos(suma)} · total {total != null ? pesos(Number(total)) : 'sin total'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditando(false)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">Cancelar</button>
        <button onClick={guardar} disabled={guardando || faltaMonto} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40">
          {elegidas.length ? 'Guardar' : 'Dejar como No registrado'}
        </button>
      </div>
    </div>
  )
}
