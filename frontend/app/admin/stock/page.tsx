'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { computeBaseUnits } from '@/lib/units.mjs'
import { useToast } from '../ui'

interface Fila {
  id: string            // producto_catalogo_id
  nombre: string
  entradas: number      // unidades base compradas (confirmadas)
  consumo: number       // unidades base consumidas
  disponible: number
  baseUnidad: string | null
}

const hoyISO = () => new Date().toISOString().slice(0, 10)
const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

export default function StockPage() {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [reg, setReg] = useState<null | { id: string; nombre: string; baseUnidad: string | null; cantidad: string; fecha: string; nota: string }>(null)
  const [guardando, setGuardando] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Entradas: renglones CONFIRMADOS ligados a un producto del catalogo, en unidades base.
    let q = supabase.from('ticket_items')
      .select('cantidad, unidad, producto_catalogo_id, catalogo_productos:producto_catalogo_id(id, nombre, unidad_default, contiene_cantidad, contiene_unidad), registros_tickets!inner(estado, sucursal_id)')
      .eq('registros_tickets.estado', 'confirmado').not('producto_catalogo_id', 'is', null).limit(8000)
    if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)

    let cq = supabase.from('consumo_inventario').select('producto_catalogo_id, cantidad_base')
    if (sucursalId) cq = cq.eq('sucursal_id', sucursalId)

    const [{ data, error }, { data: consumoData }] = await Promise.all([q, cq])
    if (error) { toast('No se pudo cargar el stock: ' + error.message, 'error'); setLoading(false); return }

    const consumoMap = new Map<string, number>()
    for (const c of (consumoData as { producto_catalogo_id: string; cantidad_base: number }[] | null) ?? []) {
      consumoMap.set(c.producto_catalogo_id, (consumoMap.get(c.producto_catalogo_id) ?? 0) + Number(c.cantidad_base || 0))
    }

    const map = new Map<string, Fila>()
    for (const row of (data as unknown as Array<{ cantidad: number | null; unidad: string | null; producto_catalogo_id: string; catalogo_productos: { id: string; nombre: string; unidad_default: string | null; contiene_cantidad: number | null; contiene_unidad: string | null } | null }>) ?? []) {
      const prod = row.catalogo_productos
      if (!prod) continue
      const base = computeBaseUnits({
        productName: prod.nombre,
        quantity: Number(row.cantidad ?? 0),
        purchaseUnit: (prod.unidad_default ?? row.unidad) || null,
        containsQuantity: prod.contiene_cantidad,
        containsUnit: prod.contiene_unidad,
      })
      if (!base) continue
      // Unidad real: si hay equivalencia, la unidad contenida (ej. pz); si no, la unidad de compra (kg/lt).
      // El fallback "identity" de computeBaseUnits usa el nombre del producto: lo ignoramos como etiqueta.
      const unidad = base.source === 'equivalence' ? base.unit : ((prod.unidad_default ?? row.unidad)?.trim() || null)
      const f = map.get(prod.id) ?? { id: prod.id, nombre: prod.nombre, entradas: 0, consumo: 0, disponible: 0, baseUnidad: unidad }
      f.entradas += base.quantity
      if (unidad && f.baseUnidad && f.baseUnidad !== unidad) f.baseUnidad = 'mixta'
      else if (!f.baseUnidad) f.baseUnidad = unidad
      map.set(prod.id, f)
    }
    const list: Fila[] = []
    for (const f of map.values()) {
      f.consumo = consumoMap.get(f.id) ?? 0
      f.disponible = f.entradas - f.consumo
      list.push(f)
    }
    list.sort((a, b) => b.entradas - a.entradas)
    setFilas(list)
    setLoading(false)
  }, [sucursalId, toast])

  useEffect(() => { fetchData() }, [fetchData])

  async function guardarConsumo() {
    if (!reg) return
    const cant = Number(reg.cantidad)
    if (!Number.isFinite(cant) || cant <= 0) { toast('Cantidad invalida', 'error'); return }
    if (!sucursalId) { toast('Selecciona una sucursal para registrar consumo', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.from('consumo_inventario').insert({
      producto_catalogo_id: reg.id, sucursal_id: sucursalId,
      cantidad_base: cant, fecha: reg.fecha || hoyISO(), nota: reg.nota.trim() || null,
    })
    setGuardando(false)
    if (error) { toast('No se pudo registrar: ' + error.message, 'error'); return }
    toast('Consumo registrado')
    setReg(null)
    fetchData()
  }

  const filtradas = filas.filter(f => !filtro || f.nombre.toLowerCase().includes(filtro.toLowerCase()))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Stock</h2>
        <p className="text-sm text-zinc-500 mt-1">{nombreSucursal} · existencias estimadas: lo comprado (confirmado) menos lo consumido. Las cajas/bultos se convierten a su unidad contenida si configuras la equivalencia en el Catalogo (ej. 1 caja = 24 pz).</p>
      </div>

      <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar producto…"
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : filtradas.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">
          {filas.length === 0 ? 'Aun no hay stock: confirma tickets con productos ligados al catalogo.' : 'Sin coincidencias'}
        </p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px] md:min-w-0">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left font-medium px-4 py-3">Producto</th>
                <th className="text-right font-medium px-4 py-3">Entradas</th>
                <th className="text-right font-medium px-4 py-3">Consumo</th>
                <th className="text-right font-medium px-4 py-3">Disponible</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(f => (
                <tr key={f.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-2.5 text-zinc-200">{f.nombre}{f.baseUnidad ? <span className="text-zinc-600"> /{f.baseUnidad}</span> : ''}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{num(f.entradas)}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">{num(f.consumo)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${f.disponible <= 0 ? 'text-red-400' : f.disponible < f.entradas * 0.2 ? 'text-amber-400' : 'text-emerald-400'}`}>{num(f.disponible)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setReg({ id: f.id, nombre: f.nombre, baseUnidad: f.baseUnidad, cantidad: '', fecha: hoyISO(), nota: '' })}
                      className="text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1.5 whitespace-nowrap cursor-pointer">Registrar consumo</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {reg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setReg(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">Registrar consumo</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{reg.nombre}{reg.baseUnidad ? ` · en ${reg.baseUnidad}` : ''}</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Cantidad consumida{reg.baseUnidad ? ` (${reg.baseUnidad})` : ''}</label>
                <input type="number" inputMode="decimal" autoFocus value={reg.cantidad} onChange={e => setReg({ ...reg, cantidad: e.target.value })}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Fecha</label>
                <input type="date" value={reg.fecha} onChange={e => setReg({ ...reg, fecha: e.target.value })}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Nota (opcional)</label>
                <input value={reg.nota} onChange={e => setReg({ ...reg, nota: e.target.value })} placeholder="ej. merma, traspaso..."
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReg(null)} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Cancelar</button>
              <button onClick={guardarConsumo} disabled={guardando}
                className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">{guardando ? 'Guardando...' : 'Registrar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
