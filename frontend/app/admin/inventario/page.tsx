'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'

interface Prod {
  id: string
  nombre: string
  unidad_base: string
  factor: number // contiene_cantidad
  comprado: number // unidades base compradas (confirmadas)
  consumido: number // unidades base consumidas
}

const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

export default function InventarioPage() {
  const { sucursalId, sucursales } = useSucursal()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [prods, setProds] = useState<Prod[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [consumoDe, setConsumoDe] = useState<null | { prod: Prod; cantidad: string; nota: string }>(null)
  const [guardando, setGuardando] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    // productos con equivalencia (factor)
    let prodQ = supabase.from('catalogo_productos')
      .select('id, nombre, unidad_default, contiene_cantidad, contiene_unidad, sucursal_id')
      .eq('activo', true).not('contiene_cantidad', 'is', null)
    prodQ = sucursalId ? prodQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : prodQ.is('sucursal_id', null)

    // compras confirmadas (cantidad por producto)
    let compQ = supabase.from('ticket_items')
      .select('cantidad, producto_catalogo_id, registros_tickets!inner(estado, sucursal_id)')
      .eq('registros_tickets.estado', 'confirmado').not('producto_catalogo_id', 'is', null).limit(8000)
    if (sucursalId) compQ = compQ.eq('registros_tickets.sucursal_id', sucursalId)

    // consumos
    let consQ = supabase.from('consumo_inventario').select('producto_catalogo_id, cantidad_base, sucursal_id').limit(8000)
    if (sucursalId) consQ = consQ.eq('sucursal_id', sucursalId)

    const [prodRes, compRes, consRes] = await Promise.all([prodQ, compQ, consQ])
    const prodRows = (prodRes.data as unknown as Array<{ id: string; nombre: string; unidad_default: string | null; contiene_cantidad: number; contiene_unidad: string }>) ?? []

    const compradoPorProd = new Map<string, number>() // en cantidad de compra (no base aún)
    for (const r of (compRes.data as unknown as Array<{ cantidad: number | null; producto_catalogo_id: string }>) ?? []) {
      compradoPorProd.set(r.producto_catalogo_id, (compradoPorProd.get(r.producto_catalogo_id) ?? 0) + Number(r.cantidad ?? 0))
    }
    const consumidoPorProd = new Map<string, number>()
    for (const r of (consRes.data as unknown as Array<{ producto_catalogo_id: string; cantidad_base: number }>) ?? []) {
      consumidoPorProd.set(r.producto_catalogo_id, (consumidoPorProd.get(r.producto_catalogo_id) ?? 0) + Number(r.cantidad_base ?? 0))
    }

    const list: Prod[] = prodRows.map(p => ({
      id: p.id, nombre: p.nombre, unidad_base: p.contiene_unidad, factor: Number(p.contiene_cantidad),
      comprado: (compradoPorProd.get(p.id) ?? 0) * Number(p.contiene_cantidad),
      consumido: consumidoPorProd.get(p.id) ?? 0,
    })).sort((a, b) => (b.comprado - b.consumido) - (a.comprado - a.consumido))
    setProds(list)
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  async function registrarConsumo() {
    if (!consumoDe) return
    const cant = Number(consumoDe.cantidad)
    if (!Number.isFinite(cant) || cant <= 0) return
    setGuardando(true)
    const { error } = await supabase.from('consumo_inventario').insert({
      producto_catalogo_id: consumoDe.prod.id,
      sucursal_id: sucursalId || null,
      cantidad_base: cant,
      nota: consumoDe.nota || null,
    })
    setGuardando(false)
    if (error) { alert('No se pudo registrar: ' + error.message); return }
    setProds(prev => prev.map(p => p.id === consumoDe.prod.id ? { ...p, consumido: p.consumido + cant } : p))
    setConsumoDe(null)
  }

  const filtrados = prods.filter(p => !filtro || p.nombre.toLowerCase().includes(filtro.toLowerCase()))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Inventario</h2>
        <p className="text-sm text-zinc-500 mt-1">{nombreSucursal} · unidades base compradas (por equivalencia) menos consumo. Define equivalencias en el Catálogo (ej. 1 cono = 30 huevos).</p>
      </div>

      <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar producto…"
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600" />

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : filtrados.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">
          {prods.length === 0 ? 'Ningún producto tiene equivalencia aún. Agrégala en el Catálogo (editar producto → "1 unidad contiene…").' : 'Sin coincidencias'}
        </p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left font-medium px-4 py-3">Producto</th>
                <th className="text-right font-medium px-4 py-3">Comprado</th>
                <th className="text-right font-medium px-4 py-3">Consumido</th>
                <th className="text-right font-medium px-4 py-3">Disponible</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const disp = p.comprado - p.consumido
                return (
                  <tr key={p.id} className="border-t border-zinc-800/50">
                    <td className="px-4 py-2.5 text-zinc-200">{p.nombre} <span className="text-zinc-600 text-xs">en {p.unidad_base}</span></td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">{num(p.comprado)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">{num(p.consumido)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${disp <= 0 ? 'text-red-400' : 'text-zinc-100'}`}>{num(disp)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setConsumoDe({ prod: p, cantidad: '', nota: '' })}
                        className="text-xs text-blue-400 hover:text-blue-300">- consumo</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {consumoDe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !guardando && setConsumoDe(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100">Registrar consumo</h3>
            <p className="text-xs text-zinc-500">{consumoDe.prod.nombre} · en {consumoDe.prod.unidad_base}</p>
            <input type="number" inputMode="decimal" autoFocus value={consumoDe.cantidad} onChange={e => setConsumoDe({ ...consumoDe, cantidad: e.target.value })}
              placeholder={`Cantidad consumida (${consumoDe.prod.unidad_base})`}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100" />
            <input value={consumoDe.nota} onChange={e => setConsumoDe({ ...consumoDe, nota: e.target.value })}
              placeholder="Nota (opcional)" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100" />
            <div className="flex gap-2 pt-1">
              <button onClick={registrarConsumo} disabled={guardando || !consumoDe.cantidad}
                className="flex-1 rounded-xl bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Descontar'}
              </button>
              <button onClick={() => setConsumoDe(null)} disabled={guardando} className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-300">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
