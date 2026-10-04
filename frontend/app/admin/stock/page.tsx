'use client'

import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { useOpciones } from '@/lib/opciones'
import { computeBaseUnits } from '@/lib/units.mjs'
import { aUnidadBase, unidadesCompatibles, existenciaEstimada, consumoReal } from '@/lib/stock.mjs'

interface Conteo { fecha: string; cantidad: number }
interface Compra { fecha: string; cantidad: number; monto: number }
import { useToast, Consejo } from '../ui'

// Stock por CONTEO FISICO (paso 1, migracion 088). Ya no se registra consumo a mano:
//   existencia estimada = ultimo conteo + compras posteriores
//   consumo real        = conteo inicial + compras entre conteos - conteo final
// Se apaga/prende por negocio en Configuracion > Opciones (cuenta_opciones.usa_stock).

interface Fila {
  clave: string          // 'i:<insumo>' o 'p:<producto>' (igual que en conteos_inventario)
  nombre: string
  productoId: string     // el mas comprado (para guardar el conteo)
  insumoId: string | null
  presentaciones: string[]
  baseUnidad: string | null   // unidad granular en la que se compara (g, ml, pz...)
  unidadPreferida: string | null // unidad del insumo (para capturar)
  compras: Compra[]
  conteos: Conteo[]
}

const hoyISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10)
}
const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fechaCorta = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

// Para mostrar: g/ml grandes en kg/lt (no cambia el calculo).
function mostrar(cantidad: number, base: string | null) {
  if ((base === 'g' || base === 'ml') && Math.abs(cantidad) >= 1000) return `${num(cantidad / 1000)} ${base === 'g' ? 'kg' : 'lt'}`
  return `${num(cantidad)}${base ? ' ' + base : ''}`
}

type Vista = 'existencias' | 'contar' | 'consumo'

export default function StockPage() {
  const { sucursalId, sucursales } = useSucursal()
  const { cuentas, deSucursal, guardar } = useOpciones()
  const toast = useToast()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : ''
  const opciones = deSucursal(sucursalId)
  const [vista, setVista] = useState<Vista>('existencias')
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  // captura del conteo: clave -> { cantidad, unidad }
  const [fechaConteo, setFechaConteo] = useState(hoyISO)
  const [captura, setCaptura] = useState<Record<string, { cantidad: string; unidad: string }>>({})
  const [guardando, setGuardando] = useState(false)
  const [periodo, setPeriodo] = useState<{ d0: string; d1: string } | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  const fetchSeq = useRef(0)
  const fetchData = useCallback(async () => {
    if (!sucursalId) { setFilas([]); setLoading(false); return }
    setLoading(true)
    const seq = ++fetchSeq.current
    const [{ data, error }, { data: cts }] = await Promise.all([
      traerTodo(() => supabase.from('ticket_items')
        .select('id, cantidad, unidad, monto, producto_catalogo_id, catalogo_productos:producto_catalogo_id(id, nombre, unidad_default, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, contiene_sub_unidad, insumos:insumo_id(id, nombre, unidad_base)), registros_tickets!inner(estado, sucursal_id, fecha_ticket, created_at)')
        .eq('registros_tickets.estado', 'confirmado').eq('registros_tickets.sucursal_id', sucursalId)
        .not('producto_catalogo_id', 'is', null)),
      traerTodo(() => supabase.from('conteos_inventario').select('id, clave, fecha, cantidad, unidad').eq('sucursal_id', sucursalId)),
    ])
    if (seq !== fetchSeq.current) return
    if (error) { toast('No se pudo cargar el stock: ' + error.message, 'error'); setLoading(false); return }

    type Row = {
      cantidad: number | null; unidad: string | null; monto: number | null
      catalogo_productos: { id: string; nombre: string; unidad_default: string | null; contiene_cantidad: number | null; contiene_unidad: string | null; contiene_sub_cantidad: number | null; contiene_sub_unidad: string | null; insumos: { id: string; nombre: string; unidad_base: string } | null } | null
      registros_tickets: { fecha_ticket: string | null; created_at: string } | null
    }
    const map = new Map<string, Fila & { porProducto: Record<string, number> }>()
    for (const row of (data as unknown as Row[]) ?? []) {
      const prod = row.catalogo_productos
      if (!prod) continue
      const compra = (prod.unidad_default ?? row.unidad)?.trim() || null
      const base = computeBaseUnits({
        productName: prod.nombre, quantity: Number(row.cantidad ?? 0), purchaseUnit: compra,
        containsQuantity: prod.contiene_cantidad, containsUnit: prod.contiene_unidad,
        subQuantity: prod.contiene_sub_cantidad, subUnit: prod.contiene_sub_unidad,
      })
      if (!base) continue
      let unidad = base.source !== 'identity' ? base.unit : compra
      if (unidad && unidad.toLowerCase() === prod.nombre.toLowerCase()) unidad = null
      // Los servicios (envios, mantenimiento) no se guardan en bodega: no van al inventario.
      if (unidad && /^servicios?$/i.test(unidad)) continue
      const insumo = prod.insumos ?? null
      const clave = insumo ? 'i:' + insumo.id : 'p:' + prod.id
      const f: Fila & { porProducto: Record<string, number> } = map.get(clave) ?? {
        clave, nombre: insumo?.nombre?.trim() || prod.nombre, productoId: prod.id, insumoId: insumo?.id ?? null,
        presentaciones: [], baseUnidad: unidad, unidadPreferida: insumo?.unidad_base?.trim() || null,
        compras: [], conteos: [], porProducto: {},
      }
      const t = row.registros_tickets
      f.compras.push({ fecha: t?.fecha_ticket ?? t?.created_at.slice(0, 10) ?? '', cantidad: base.quantity, monto: Number(row.monto ?? 0) })
      f.porProducto[prod.id] = (f.porProducto[prod.id] ?? 0) + base.quantity
      if (insumo && !f.presentaciones.includes(prod.nombre)) f.presentaciones.push(prod.nombre)
      if (unidad && f.baseUnidad && f.baseUnidad !== unidad) f.baseUnidad = 'mixta'
      else if (!f.baseUnidad) f.baseUnidad = unidad
      map.set(clave, f)
    }
    // Conteos guardados (cada uno en la unidad en que se conto) -> unidad base del articulo.
    for (const c of (cts as { clave: string; fecha: string; cantidad: number; unidad: string | null }[] | null) ?? []) {
      const f = map.get(c.clave)
      if (!f) continue
      const q = aUnidadBase(c.cantidad, c.unidad, f.baseUnidad)
      if (q != null) f.conteos.push({ fecha: c.fecha, cantidad: q })
    }
    const list: Fila[] = [...map.values()].map(f => ({
      ...f, productoId: Object.entries(f.porProducto).sort((a, b) => b[1] - a[1])[0]?.[0] ?? f.productoId,
    }))
    list.sort((a, b) => b.compras.length - a.compras.length)
    setFilas(list)
    setLoading(false)
  }, [sucursalId, toast])

  useEffect(() => { if (opciones?.usa_stock) fetchData() }, [fetchData, opciones?.usa_stock])

  // Fechas en que hubo conteo (para elegir el periodo de consumo real)
  const fechas = [...new Set(filas.flatMap(f => f.conteos.map(c => c.fecha)))].sort().reverse()
  useEffect(() => {
    if (fechas.length >= 2 && (!periodo || !fechas.includes(periodo.d0) || !fechas.includes(periodo.d1))) setPeriodo({ d0: fechas[1], d1: fechas[0] })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechas.join(',')])

  async function guardarConteo() {
    if (!sucursalId) return
    const renglones: Record<string, unknown>[] = []
    for (const f of filas) {
      const c = captura[f.clave]
      if (!c || c.cantidad.trim() === '') continue
      const q = Number(c.cantidad)
      if (!Number.isFinite(q) || q < 0) { toast(`Cantidad inválida en «${f.nombre}»`, 'error'); return }
      if (aUnidadBase(q, c.unidad, f.baseUnidad) == null) { toast(`«${c.unidad}» no se puede convertir a ${f.baseUnidad} en «${f.nombre}»`, 'error'); return }
      renglones.push({
        sucursal_id: sucursalId, fecha: fechaConteo, clave: f.clave, nombre: f.nombre,
        producto_catalogo_id: f.insumoId ? null : f.productoId, insumo_id: f.insumoId,
        cantidad: q, unidad: c.unidad || f.baseUnidad, updated_at: new Date().toISOString(),
      })
    }
    if (renglones.length === 0) { toast('Escribe al menos una cantidad', 'error'); return }
    setGuardando(true)
    const { data: { session } } = await supabase.auth.getSession()
    const quien = session?.user?.email ?? 'admin'
    const { error } = await supabase.from('conteos_inventario')
      .upsert(renglones.map(r => ({ ...r, contado_por: quien })), { onConflict: 'sucursal_id,fecha,clave' })
    setGuardando(false)
    if (error) { toast('No se pudo guardar el conteo: ' + error.message, 'error'); return }
    toast(`Conteo guardado: ${renglones.length} ${renglones.length === 1 ? 'artículo' : 'artículos'}`)
    setCaptura({})
    setVista('existencias')
    fetchData()
  }

  const filtradas = filas.filter(f => !filtro || f.nombre.toLowerCase().includes(filtro.toLowerCase()))

  // ---------- Stock apagado: explicar y ofrecer activarlo ----------
  if (cuentas !== null && !opciones?.usa_stock) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Stock</h2>
          <p className="nota max-w-2xl">Sabe cuánto se consume de verdad y cuánto cuesta, contando lo que hay en físico.</p>
        </div>
        <section className="tarjeta space-y-4 p-5">
          <h3 className="text-base font-semibold text-zinc-100">Así funciona</h3>
          <ol className="space-y-3">
            {[
              ['Cuenta lo que tienes', 'Una vez al mes (o cada semana). La lista ya viene armada con lo que has comprado.'],
              ['La app suma tus compras', 'Todo lo que entra por los tickets se suma solo, en la misma unidad.'],
              ['Ve lo que realmente se consumió', 'En el siguiente conteo: lo que había + lo que compraste − lo que queda = consumo real, con su costo.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-900 text-xs font-semibold text-emerald-300">{i + 1}</span>
                <div><p className="text-sm font-medium text-zinc-100">{t}</p><p className="nota">{d}</p></div>
              </li>
            ))}
          </ol>
          <p className="nota">Más adelante: recetas y ventas de tu punto de venta, para saber cuánto debió consumirse y encontrar la merma.</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className="btn-primario" onClick={async () => {
              if (!opciones) return
              const err = await guardar(opciones.cuenta_id, { usa_stock: true })
              if (err) toast('No se pudo activar: ' + err, 'error'); else toast('Stock activado')
            }}>Activar Stock</button>
            <Link href="/admin/opciones" className="btn-texto">Ver opciones</Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Stock{nombreSucursal && ` · ${nombreSucursal}`}</h2>
        <p className="nota max-w-2xl">Lo que hay = último conteo + lo comprado después. Cuenta seguido para que sea real.</p>
      </div>

      {!sucursalId ? (
        <p className="tarjeta px-4 py-6 text-sm text-zinc-400">El inventario es de cada lugar: elige una sucursal arriba.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5" role="tablist">
              {([['existencias', 'Existencias'], ['contar', 'Hacer conteo'], ['consumo', 'Consumo real']] as const).map(([v, t]) => (
                <button key={v} role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                  className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${vista === v ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-100'}`}>{t}</button>
              ))}
            </div>
            <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar artículo…"
              aria-label="Buscar artículo" className="campo min-w-[180px] flex-1" />
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
          ) : filas.length === 0 ? (
            <p className="tarjeta px-4 py-6 text-sm text-zinc-400">Aún no hay compras de artículos del catálogo en esta sucursal. Aparecen al confirmar tickets.</p>
          ) : vista === 'existencias' ? (
            <div className="tarjeta divide-y divide-zinc-800/60">
              {filtradas.map(f => {
                const e = existenciaEstimada(f.conteos, f.compras)
                const despues = e.conConteo ? e.cantidad - e.ultimo!.cantidad : 0
                return (
                  <div key={f.clave} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100 break-words">
                        {f.nombre}
                        {f.presentaciones.length > 1 && <span className="chip-info ml-2" title={f.presentaciones.join(' · ')}>{f.presentaciones.length} tamaños</span>}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {e.ultimo
                          ? `Contado ${mostrar(e.ultimo.cantidad, f.baseUnidad)} el ${fechaCorta(e.ultimo.fecha)}${despues ? ` · + ${mostrar(despues, f.baseUnidad)} comprado después` : ''}`
                          : 'Sin conteo todavía'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {e.conConteo
                        ? <p className={`text-[15px] font-semibold ${e.cantidad <= 0 ? 'text-red-400' : 'text-zinc-100'}`}>≈ {mostrar(e.cantidad, f.baseUnidad)}</p>
                        : <p className="text-sm text-zinc-500">{mostrar(e.cantidad, f.baseUnidad)}<span className="block text-xs">comprado</span></p>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : vista === 'contar' ? (
            <div className="space-y-4">
              <Consejo>Cuenta lo que hay en físico en tu sucursal. Si algo ya no hay, pon 0. Lo que dejes vacío no se cuenta. Puedes guardar por partes: contar dos veces el mismo día actualiza.</Consejo>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="etiqueta block">Fecha del conteo</span>
                  <input type="date" value={fechaConteo} max={hoyISO()} onChange={e => setFechaConteo(e.target.value)} className="campo" />
                </label>
                <p className="nota pb-2">{Object.values(captura).filter(c => c.cantidad.trim() !== '').length} capturados de {filas.length}</p>
              </div>
              <div className="tarjeta divide-y divide-zinc-800/60">
                {filtradas.map(f => {
                  const unidades = unidadesCompatibles(f.baseUnidad === 'mixta' ? null : f.baseUnidad)
                  const pref = f.unidadPreferida && unidades.includes(f.unidadPreferida) ? f.unidadPreferida : unidades[0] ?? ''
                  const c = captura[f.clave] ?? { cantidad: '', unidad: pref }
                  const e = existenciaEstimada(f.conteos, f.compras)
                  return (
                    <div key={f.clave} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 break-words">{f.nombre}</p>
                        <p className="text-xs text-zinc-500">{e.conConteo ? `Debería haber ≈ ${mostrar(e.cantidad, f.baseUnidad)}` : 'Primer conteo'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="number" inputMode="decimal" min={0} value={c.cantidad} placeholder="cantidad" aria-label={`Cuánto hay de ${f.nombre}`}
                          onChange={ev => setCaptura(cs => ({ ...cs, [f.clave]: { ...c, cantidad: ev.target.value } }))}
                          className="campo w-28 py-1.5" />
                        {unidades.length > 1 ? (
                          <select value={c.unidad} aria-label={`Unidad de ${f.nombre}`}
                            onChange={ev => setCaptura(cs => ({ ...cs, [f.clave]: { ...c, unidad: ev.target.value } }))} className="campo py-1.5">
                            {unidades.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        ) : <span className="w-12 text-sm text-zinc-400">{unidades[0] ?? f.baseUnidad ?? ''}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={guardarConteo} disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar conteo'}</button>
                <button onClick={() => { setCaptura({}); setVista('existencias') }} className="btn-quieto">Atrás</button>
              </div>
            </div>
          ) : (
            // ---------- Consumo real ----------
            fechas.length < 2 || !periodo ? (
              <section className="tarjeta space-y-2 px-4 py-5">
                <p className="text-sm font-medium text-zinc-100">{fechas.length === 0 ? 'Aún no hay conteos' : 'Falta un segundo conteo'}</p>
                <p className="nota">El consumo real sale de comparar dos conteos: lo que había + lo que compraste − lo que queda. {fechas.length === 1 ? `Ya tienes el del ${fechaCorta(fechas[0])}; haz el siguiente en unos días.` : 'Haz tu primer conteo en «Hacer conteo».'}</p>
              </section>
            ) : (() => {
              const filasConsumo = filtradas.map(f => ({ f, r: consumoReal(f.conteos, f.compras, periodo.d0, periodo.d1) })).filter(x => x.r)
              const total = filasConsumo.reduce((s, x) => s + (x.r!.costo || 0), 0)
              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1">
                      <span className="etiqueta block">Desde el conteo del</span>
                      <select value={periodo.d0} onChange={e => setPeriodo(p => p && { ...p, d0: e.target.value })} className="campo">
                        {fechas.filter(d => d < periodo.d1).map(d => <option key={d} value={d}>{fechaCorta(d)}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="etiqueta block">Hasta el conteo del</span>
                      <select value={periodo.d1} onChange={e => setPeriodo(p => p && { ...p, d1: e.target.value })} className="campo">
                        {fechas.filter(d => d > periodo.d0).map(d => <option key={d} value={d}>{fechaCorta(d)}</option>)}
                      </select>
                    </label>
                    <div className="pb-1">
                      <p className="etiqueta">Costo de lo consumido</p>
                      <p className="text-2xl font-semibold text-zinc-100">{fmt(total)}</p>
                    </div>
                  </div>
                  {filasConsumo.length === 0 ? (
                    <p className="tarjeta px-4 py-6 text-sm text-zinc-400">Ningún artículo tiene conteo en las dos fechas.</p>
                  ) : (
                    <div className="tarjeta overflow-hidden">
                      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px] md:min-w-0">
                        <thead>
                          <tr className="border-b border-zinc-800 text-[13px] font-medium text-zinc-500">
                            <th className="text-left font-medium px-4 py-3">Artículo</th>
                            <th className="text-right font-medium px-4 py-3">Había</th>
                            <th className="text-right font-medium px-4 py-3">+ Compraste</th>
                            <th className="text-right font-medium px-4 py-3">− Queda</th>
                            <th className="text-right font-medium px-4 py-3">= Consumo</th>
                            <th className="text-right font-medium px-4 py-3">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filasConsumo.sort((a, b) => b.r!.costo - a.r!.costo).map(({ f, r }) => (
                            <Fragment key={f.clave}>
                              <tr className="border-b border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer" onClick={() => setAbierto(abierto === f.clave ? null : f.clave)}>
                                <td className="px-4 py-2.5 text-zinc-100">{f.nombre}</td>
                                <td className="px-4 py-2.5 text-right text-zinc-400">{mostrar(r!.inicial, f.baseUnidad)}</td>
                                <td className="px-4 py-2.5 text-right text-zinc-400">{mostrar(r!.compras, f.baseUnidad)}</td>
                                <td className="px-4 py-2.5 text-right text-zinc-400">{mostrar(r!.final, f.baseUnidad)}</td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${r!.consumo < 0 ? 'text-amber-400' : 'text-zinc-100'}`}>{mostrar(r!.consumo, f.baseUnidad)}</td>
                                <td className="px-4 py-2.5 text-right text-zinc-100">{fmt(r!.costo)}</td>
                              </tr>
                              {abierto === f.clave && r!.consumo < 0 && (
                                <tr className="border-b border-zinc-800/60"><td colSpan={6} className="px-4 py-2 text-[13px] text-amber-400">
                                  Salió negativo: hay más de lo que había más lo comprado. Suele ser un ticket sin subir o un conteo con otra unidad.
                                </td></tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}
                </div>
              )
            })()
          )}
        </>
      )}
    </div>
  )
}
