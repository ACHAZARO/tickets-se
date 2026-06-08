'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { computeBaseUnits, formatBaseUnits } from '@/lib/units.mjs'

interface Fila {
  nombre: string
  categoria: string | null
  veces: number
  cantidad: number
  unidad: string | null
  unidadMixta: boolean
  base: number
  baseUnidad: string | null
  gasto: number
}

function primerDiaMesISO(): string {
  const n = new Date()
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`
}
const hoyISO = () => new Date().toISOString().slice(0, 10)
const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })
const money = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

export default function EntradasPage() {
  const { sucursalId, sucursales } = useSucursal()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [desde, setDesde] = useState(primerDiaMesISO())
  const [hasta, setHasta] = useState(hoyISO())
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('ticket_items')
      .select('descripcion, cantidad, unidad, monto, categorias_gasto:categoria_id(nombre), catalogo_productos:producto_catalogo_id(nombre, unidad_default, contiene_cantidad, contiene_unidad), registros_tickets!inner(fecha_ticket, estado, sucursal_id)')
      .eq('registros_tickets.estado', 'confirmado')
      .gte('registros_tickets.fecha_ticket', desde).lte('registros_tickets.fecha_ticket', hasta)
      .limit(8000)
    if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
    const { data } = await q

    const map = new Map<string, Fila>()
    for (const row of (data as unknown as Array<{ descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null; categorias_gasto: { nombre: string } | null; catalogo_productos: { nombre: string; unidad_default: string | null; contiene_cantidad: number | null; contiene_unidad: string | null } | null }>) ?? []) {
      const nombre = (row.catalogo_productos?.nombre ?? row.descripcion ?? 'Sin nombre').trim()
      const key = nombre.toLowerCase()
      const f = map.get(key) ?? { nombre, categoria: null as string | null, veces: 0, cantidad: 0, unidad: null as string | null, unidadMixta: false, base: 0, baseUnidad: null as string | null, gasto: 0 }
      if (!f.categoria && row.categorias_gasto?.nombre) f.categoria = row.categorias_gasto.nombre
      f.veces += 1
      const cant = Number(row.cantidad ?? 0)
      f.cantidad += cant
      f.gasto += Number(row.monto ?? 0)
      const u = (row.catalogo_productos?.unidad_default ?? row.unidad)?.trim() || null
      if (u) { if (f.unidad && f.unidad !== u) f.unidadMixta = true; else if (!f.unidad) f.unidad = u }
      const base = computeBaseUnits({
        productName: nombre,
        quantity: cant,
        purchaseUnit: u,
        containsQuantity: row.catalogo_productos?.contiene_cantidad,
        containsUnit: row.catalogo_productos?.contiene_unidad,
      })
      if (base) {
        f.base += base.quantity
        if (f.baseUnidad && f.baseUnidad !== base.unit) f.baseUnidad = 'mixta'
        else if (!f.baseUnidad) f.baseUnidad = base.unit
      }
      map.set(key, f)
    }
    setFilas([...map.values()].sort((a, b) => b.gasto - a.gasto))
    setLoading(false)
  }, [desde, hasta, sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  const filtradas = filas.filter(f => !filtro || f.nombre.toLowerCase().includes(filtro.toLowerCase()))
  const totGasto = filtradas.reduce((s, f) => s + f.gasto, 0)
  const totVeces = filtradas.reduce((s, f) => s + f.veces, 0)

  function exportarCSV() {
    const head = ['Producto', 'Categoria', 'Veces', 'Cantidad', 'Unidad', 'Unidades base', 'Unidad base', 'Gasto']
    const rows = filtradas.map(f => [f.nombre, f.categoria ?? '', f.veces, f.cantidad, f.unidadMixta ? 'mixta' : (f.unidad ?? ''), f.base || '', f.baseUnidad ?? 'Revisar', f.gasto])
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `entradas_${nombreSucursal}_${desde}_a_${hasta}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Entradas</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{nombreSucursal} · qué y cuánto se compró (por fecha del ticket). Las unidades base salen de las equivalencias del catálogo (ej. 1 caja = 24 pz).</p>
        </div>
        <button onClick={exportarCSV} disabled={filtradas.length === 0}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50">Descargar CSV</button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-zinc-500 block mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" /></div>
        <div><label className="text-xs text-zinc-500 block mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" /></div>
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar producto…"
          className="flex-1 min-w-[160px] rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl bg-zinc-900 p-4"><p className="text-xs text-zinc-500 mb-1">Gasto del periodo</p><p className="text-2xl font-bold text-blue-400">{money(totGasto)}</p></div>
        <div className="rounded-xl bg-zinc-900 p-4"><p className="text-xs text-zinc-500 mb-1">Productos distintos</p><p className="text-2xl font-bold text-zinc-100">{filtradas.length}</p></div>
        <div className="rounded-xl bg-zinc-900 p-4"><p className="text-xs text-zinc-500 mb-1">Renglones</p><p className="text-2xl font-bold text-zinc-100">{totVeces}</p></div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : filtradas.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">Sin compras confirmadas en el periodo</p>
      ) : (
        <div className="rounded-2xl bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left font-medium px-4 py-3">Producto</th>
                <th className="text-left font-medium px-4 py-3">Categoría</th>
                <th className="text-right font-medium px-4 py-3">Veces</th>
                <th className="text-right font-medium px-4 py-3">Cantidad</th>
                <th className="text-right font-medium px-4 py-3">Unidades base</th>
                <th className="text-right font-medium px-4 py-3">Gasto</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(f => (
                <tr key={f.nombre} className="border-t border-zinc-800/50">
                  <td className="px-4 py-2.5 text-zinc-200">{f.nombre}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{f.categoria ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">{f.veces}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-400">{f.cantidad > 0 ? `${num(f.cantidad)}${f.unidadMixta ? '' : f.unidad ? ' ' + f.unidad : ''}` : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{f.base > 0 && f.baseUnidad ? formatBaseUnits({ quantity: f.base, unit: f.baseUnidad, source: 'identity' }) : 'Revisar'}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{money(f.gasto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-700 font-semibold">
                <td className="px-4 py-2.5 text-zinc-300" colSpan={2}>Total</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">{totVeces}</td>
                <td></td><td></td>
                <td className="px-4 py-2.5 text-right text-zinc-100">{money(totGasto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
