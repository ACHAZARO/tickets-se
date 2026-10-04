'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import Link from 'next/link'
import { FotoTicket, type EjemploTicket } from '../unificar'

// Cada punto guarda de que ticket salio, para poder ver la foto y abrir el ticket (Ver tickets).
interface Punto {
  precio: number; fecha: string | null; created_at: string
  ticketId: string; descripcion: string | null; cantidad: number; unidad: string | null; monto: number
  comercio: string | null; bucket: string | null; path: string | null
}
interface ProdPrecio {
  nombre: string
  productoId: string | null // articulo del catalogo (para "Editar artículo")
  unidad: string | null
  puntos: Punto[]
  ultimo: number
  anterior: number | null
  variacion: number | null // % vs anterior
}

const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

function Sparkline({ puntos }: { puntos: Punto[] }) {
  if (puntos.length < 2) return <p className="nota">Solo hay un registro; aún no hay historial.</p>
  const W = 320, H = 60, pad = 6
  const precios = puntos.map(p => p.precio)
  const min = Math.min(...precios), max = Math.max(...precios)
  const span = max - min || 1
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (puntos.length - 1)
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const d = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.precio).toFixed(1)}`).join(' ')
  const ult = puntos[puntos.length - 1]
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 flex-1" preserveAspectRatio="none">
        <path d={d} fill="none" className="stroke-blue-400" strokeWidth="1.5" />
        {puntos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.precio)} r="1.8" className="fill-blue-400" />)}
      </svg>
      <div className="text-xs text-zinc-500 whitespace-nowrap">
        <div>min {fmt(min)}</div>
        <div>max {fmt(max)}</div>
        <div className="font-medium text-zinc-100">últ {fmt(ult.precio)}</div>
      </div>
    </div>
  )
}

export default function PreciosPage() {
  const { sucursalId, sucursales } = useSucursal()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas'
  const [prods, setProds] = useState<ProdPrecio[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [soloCambios, setSoloCambios] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [viendo, setViendo] = useState<string | null>(null) // producto con "Ver tickets" abierto

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Fuente real: renglones CONFIRMADOS con cantidad y monto -> precio unitario.
    // (No dependemos de precio_historial, asi aparecen TODOS los productos comprados.)
    const { data } = await traerTodo(() => {
      let q = supabase.from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, producto_catalogo_id, catalogo_productos:producto_catalogo_id(nombre, unidad_default), registros_tickets!inner(id, comercio, fecha_ticket, created_at, estado, sucursal_id, storage_path_original, storage_path_archivo)')
        .eq('registros_tickets.estado', 'confirmado')
      if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
      return q
    })

    const map = new Map<string, ProdPrecio>()
    for (const row of (data as unknown as Array<{ descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null; producto_catalogo_id: string | null; catalogo_productos: { nombre: string; unidad_default: string | null } | null; registros_tickets: { id: string; comercio: string | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null } | null }>) ?? []) {
      const monto = Number(row.monto); const cant = Number(row.cantidad)
      if (!Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
      const nombre = (row.catalogo_productos?.nombre ?? row.descripcion ?? '').trim()
      if (!nombre) continue
      const key = nombre.toLowerCase()
      const unidad = row.catalogo_productos?.unidad_default ?? row.unidad ?? null
      if (!map.has(key)) map.set(key, { nombre, productoId: row.producto_catalogo_id, unidad, puntos: [], ultimo: 0, anterior: null, variacion: null })
      const t = row.registros_tickets
      map.get(key)!.puntos.push({
        precio: monto / cant, fecha: t?.fecha_ticket ?? null, created_at: t?.created_at ?? '',
        ticketId: t?.id ?? '', descripcion: row.descripcion, cantidad: cant, unidad: row.unidad, monto, comercio: t?.comercio ?? null,
        bucket: t?.storage_path_archivo ? 'archivo' : t?.storage_path_original ? 'por-revisar' : null,
        path: t?.storage_path_archivo ?? t?.storage_path_original ?? null,
      })
    }
    const list: ProdPrecio[] = []
    for (const p of map.values()) {
      // ordena los puntos cronologicamente (por fecha del ticket, luego subida)
      p.puntos.sort((a, b) => (a.fecha ?? a.created_at).localeCompare(b.fecha ?? b.created_at) || a.created_at.localeCompare(b.created_at))
      const n = p.puntos.length
      p.ultimo = p.puntos[n - 1].precio
      p.anterior = n >= 2 ? p.puntos[n - 2].precio : null
      p.variacion = p.anterior && p.anterior > 0 ? ((p.ultimo - p.anterior) / p.anterior) * 100 : null
      list.push(p)
    }
    list.sort((a, b) => Math.abs(b.variacion ?? 0) - Math.abs(a.variacion ?? 0) || b.ultimo - a.ultimo)
    setProds(list)
    setLoading(false)
  }, [sucursalId])

  useEffect(() => { fetchData() }, [fetchData])

  const filtrados = prods.filter(p =>
    (!filtro || p.nombre.toLowerCase().includes(filtro.toLowerCase())) &&
    (!soloCambios || (p.variacion != null && Math.abs(p.variacion) >= 15))
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Precios</h2>
        <p className="nota mt-1">{nombreSucursal} · precio unitario y su variación. Un cambio de más de 40% genera alerta al procesar.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar producto…"
          className="campo flex-1 min-w-[180px]" />
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={soloCambios} onChange={e => setSoloCambios(e.target.checked)} className="accent-emerald-500" />
          Solo cambios ≥15%
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      ) : filtrados.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-12">{prods.length === 0 ? 'Aún no hay precios: aparecen cuando hay tickets confirmados con cantidad y monto por renglón.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="tarjeta overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px] md:min-w-0">
            <thead>
              <tr className="border-b border-zinc-800 text-[13px] font-medium text-zinc-500">
                <th className="text-left font-medium px-4 py-3">Producto</th>
                <th className="text-right font-medium px-4 py-3">Último</th>
                <th className="text-right font-medium px-4 py-3">Anterior</th>
                <th className="text-right font-medium px-4 py-3">Variación</th>
                <th className="text-right font-medium px-4 py-3">Registros</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const sube = (p.variacion ?? 0) > 0
                const fuerte = p.variacion != null && Math.abs(p.variacion) >= 40
                const exp = abierto === p.nombre
                return (
                  <Fragment key={p.nombre}>
                    <tr onClick={() => setAbierto(exp ? null : p.nombre)}
                      className="border-b border-zinc-800/60 cursor-pointer hover:bg-zinc-800/40">
                      <td className="px-4 py-2.5 text-zinc-100"><span className="text-zinc-500" aria-hidden="true">{exp ? '▾ ' : '▸ '}</span>{p.nombre}{p.unidad ? <span className="text-zinc-500"> /{p.unidad}</span> : ''}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-zinc-100">{fmt(p.ultimo)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{p.anterior != null ? fmt(p.anterior) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right ${p.variacion == null ? 'text-zinc-500' : fuerte ? (sube ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold') : sube ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {p.variacion == null ? '—' : `${sube ? '▲' : '▼'} ${Math.abs(p.variacion).toFixed(0)}%`}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{p.puntos.length}</td>
                    </tr>
                    {exp && (
                      <tr className="border-b border-zinc-800/60 bg-zinc-800/30">
                        <td colSpan={5} className="px-4 py-3">
                          {/* La tabla es mas ancha que el celular: este bloque se queda del ancho de la pantalla */}
                          <div className="sticky left-4 w-[calc(100vw-4rem)] space-y-3 md:static md:w-auto">
                          <Sparkline puntos={p.puntos} />
                          <div className="flex flex-wrap items-center gap-2">
                            {p.puntos.length >= 1 && (
                              <button type="button" onClick={() => setViendo(viendo === p.nombre ? null : p.nombre)} className="btn-texto btn-sm -ml-2">
                                {viendo === p.nombre ? 'Ocultar tickets' : p.puntos.length >= 2 ? 'Ver tickets (anterior y último)' : 'Ver ticket'}
                              </button>
                            )}
                            {p.productoId && (
                              <Link href={`/admin/catalogo?editar=${p.productoId}`} className="btn-secundario btn-sm"
                                title="Abrir el artículo para corregir nombre, categoría, unidad o equivalencia (ej. 1 caja = 12 pz)">
                                Editar artículo
                              </Link>
                            )}
                          </div>
                          {viendo === p.nombre && <CompararPrecios puntos={p.puntos} />}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}

const aEjemplo = (pt: Punto): EjemploTicket => ({
  descripcion: pt.descripcion, cantidad: pt.cantidad, unidad: pt.unidad, monto: pt.monto,
  comercio: pt.comercio, fecha: (pt.fecha ?? pt.created_at).slice(0, 10), bucket: pt.bucket, path: pt.path,
})

/** Anterior vs ultimo, foto con foto: se ve si es el mismo articulo, otro tamano o un renglon mal ligado. */
function CompararPrecios({ puntos }: { puntos: Punto[] }) {
  const n = puntos.length
  const lados = (n >= 2 ? [['Anterior', puntos[n - 2]], ['Último', puntos[n - 1]]] : [['Único', puntos[n - 1]]]) as [string, Punto][]
  return (
    <div className="space-y-2">
      <div className={`grid gap-3 rounded-lg bg-zinc-800/50 p-2 ${lados.length === 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>
        {lados.map(([titulo, pt]) => (
          <div key={titulo} className="min-w-0 space-y-1.5">
            <FotoTicket nombre={`${titulo} · ${fmt(pt.precio)} c/u`} ej={aEjemplo(pt)} />
            <p className="text-xs text-zinc-400 break-words">
              Dice &quot;{pt.descripcion ?? '—'}&quot; · {pt.cantidad} {pt.unidad ?? ''} · {fmt(pt.monto)}
            </p>
            <p className="text-xs text-zinc-500">{pt.comercio ?? 'sin comercio'} · {(pt.fecha ?? pt.created_at).slice(0, 10)}</p>
            {pt.ticketId && (
              <Link href={`/admin/tickets?abrir=${pt.ticketId}`} className="btn-texto btn-sm -ml-2"
                title="Abre el ticket para corregir este renglón (cantidad, unidad o artículo ligado)">
                Corregir en el ticket
              </Link>
            )}
          </div>
        ))}
      </div>
      <p className="nota">
        ¿Es el mismo artículo en otro tamaño (caja contra pieza)? Usa «Editar artículo» y pon la equivalencia.
        ¿Un renglón quedó ligado al artículo equivocado? Usa «Corregir en el ticket».
      </p>
    </div>
  )
}
