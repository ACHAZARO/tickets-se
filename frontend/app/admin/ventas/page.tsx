'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Sucursal {
  id: string
  nombre: string
}

// 'YYYY-MM-01' de los ultimos N meses, mas reciente primero
function mesesRecientes(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() // 0-based
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}-01`)
    m--
    if (m < 0) { m = 11; y-- }
  }
  return out
}

function nombreMes(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-MX', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

const MESES = mesesRecientes(6)

export default function VentasPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  // clave 'sucursalId|mes' -> monto string
  const [valores, setValores] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [sucRes, ventasRes] = await Promise.all([
      supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
      supabase.from('ventas').select('sucursal_id, mes, monto').gte('mes', MESES[MESES.length - 1]),
    ])
    setSucursales(sucRes.data ?? [])
    const map: Record<string, string> = {}
    for (const v of ventasRes.data ?? []) {
      map[`${v.sucursal_id}|${v.mes}`] = String(v.monto)
    }
    setValores(map)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function guardar(sucursalId: string, mes: string, montoStr: string) {
    const key = `${sucursalId}|${mes}`
    const monto = parseFloat(montoStr)
    if (montoStr === '' || isNaN(monto)) return
    setSavingKey(key)
    await supabase
      .from('ventas')
      .upsert({ sucursal_id: sucursalId, mes, monto }, { onConflict: 'sucursal_id,mes' })
    setSavingKey(null)
  }

  function copiarMesAnterior(mes: string) {
    const idx = MESES.indexOf(mes)
    const anterior = MESES[idx + 1]
    if (!anterior) return
    setValores(prev => {
      const next = { ...prev }
      for (const s of sucursales) {
        const prevVal = prev[`${s.id}|${anterior}`]
        if (prevVal && !next[`${s.id}|${mes}`]) {
          next[`${s.id}|${mes}`] = prevVal
          guardar(s.id, mes, prevVal)
        }
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Captura de ventas</h2>
        <p className="text-sm text-zinc-500 mt-1">Venta total por sucursal y mes. Se usa para el arqueo de costos.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left font-medium text-zinc-500 px-4 py-3">Mes</th>
              {sucursales.map(s => (
                <th key={s.id} className="text-right font-medium text-zinc-400 px-4 py-3">{s.nombre}</th>
              ))}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {MESES.map(mes => (
              <tr key={mes} className="border-b border-zinc-800/50 last:border-0">
                <td className="px-4 py-2.5 text-zinc-300 capitalize whitespace-nowrap">{nombreMes(mes)}</td>
                {sucursales.map(s => {
                  const key = `${s.id}|${mes}`
                  return (
                    <td key={s.id} className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <span className="text-zinc-600">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={valores[key] ?? ''}
                          onChange={e => setValores(prev => ({ ...prev, [key]: e.target.value }))}
                          onBlur={e => guardar(s.id, mes, e.target.value)}
                          placeholder="0"
                          className="w-28 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-right text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 outline-none"
                        />
                        {savingKey === key && (
                          <span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
                        )}
                      </div>
                    </td>
                  )
                })}
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => copiarMesAnterior(mes)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 whitespace-nowrap"
                    title="Copiar montos del mes anterior"
                  >
                    ↑ copiar anterior
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">Los cambios se guardan al salir de cada celda.</p>
    </div>
  )
}
