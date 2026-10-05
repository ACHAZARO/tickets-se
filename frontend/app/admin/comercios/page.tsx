'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from '../ui'
import { SelectorPeriodo, rangoMesActual } from '../periodo'
import { GaleriaTickets } from '../galeria-tickets'
import type { EjemploTicket } from '../unificar'

// "Donde compras": la IA reconoce los comercios sola al leer los tickets. Esta pantalla responde cuanto le
// compras a cada uno en el periodo, en que, y si un articulo esta mas barato en otro lado. Forzar categoria y
// olvidar un comercio quedan como opciones avanzadas.

interface Categoria { id: string; nombre: string }
interface Comercio { id: string; nombre: string; categoria_id: string | null; veces: number; sucursal_id: string | null }
// El mismo nombre puede existir dos veces (global y de una sucursal): en pantalla es UN comercio.
interface Grupo { clave: string; nombre: string; ids: string[]; categoria_id: string | null; veces: number }
interface CompraArticulo { comercio: string; precio: number; fecha: string }
interface ResumenComercio {
  gasto: number
  tickets: number
  ultima: string | null
  categorias: { nombre: string; gasto: number }[]
}
interface ArticuloAqui {
  id: string
  nombre: string
  unidad: string | null
  veces: number
  precioAqui: number
  mejor: CompraArticulo | null // precio mas bajo en OTRO comercio (ultima compra de cada comercio)
}

const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fmt0 = (n: number) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 })
const fechaCorta = (f: string | null) => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'
const clave = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

type FilaItem = {
  monto: number | null; cantidad: number | null; producto_catalogo_id: string | null
  catalogo_productos: { nombre: string; unidad_default: string | null } | null
  categorias_gasto: { nombre: string } | null
  registros_tickets: { comercio: string | null; fecha_ticket: string | null; created_at: string } | null
}

export default function ComerciosPage() {
  const { sucursalId } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [desde, setDesde] = useState(() => rangoMesActual().inicio)
  const [hasta, setHasta] = useState(() => rangoMesActual().fin)
  const [comercios, setComercios] = useState<Grupo[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [resumen, setResumen] = useState<Record<string, ResumenComercio>>({})
  const [articulos, setArticulos] = useState<Record<string, ArticuloAqui[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [galeria, setGaleria] = useState<string | null>(null) // nombre del comercio

  const seqRef = useRef(0)
  const fetchData = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    let comQ = supabase.from('comercios').select('id, nombre, categoria_id, veces, sucursal_id').order('veces', { ascending: false })
    let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    comQ = sucursalId ? comQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : comQ
    catQ = sucursalId ? catQ.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : catQ

    // Tickets OFICIALES (confirmados) del periodo: cuanto se le compro a cada comercio.
    const tQ = traerTodo(() => {
      let q = supabase.from('registros_tickets').select('id, comercio, monto, fecha_ticket, created_at, ticket_items(monto, autorizacion)')
        .eq('estado', 'confirmado').gte('fecha_ticket', desde).lte('fecha_ticket', hasta)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      return q
    })

    // Renglones confirmados (todo el historial): en que se gasta y precios por articulo para comparar comercios.
    const iQ = traerTodo(() => {
      let q = supabase.from('ticket_items')
        .select('id, monto, cantidad, producto_catalogo_id, catalogo_productos:producto_catalogo_id(nombre, unidad_default), categorias_gasto:categoria_id(nombre), registros_tickets!inner(comercio, fecha_ticket, created_at, estado, sucursal_id)')
        .eq('registros_tickets.estado', 'confirmado')
        .in('autorizacion', ['normal', 'aprobado'])   // renglones no autorizados sin aprobar (094) no son gasto
      if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
      return q
    })

    const [comRes, catRes, tRes, iRes] = await Promise.all([comQ, catQ, tQ, iQ])
    if (seq !== seqRef.current) return
    const grupos = new Map<string, Grupo>()
    for (const c of (comRes.data as Comercio[] | null) ?? []) {
      const g = grupos.get(clave(c.nombre))
      if (g) { g.ids.push(c.id); g.veces += c.veces; g.categoria_id ??= c.categoria_id }
      else grupos.set(clave(c.nombre), { clave: clave(c.nombre), nombre: c.nombre.trim(), ids: [c.id], categoria_id: c.categoria_id, veces: c.veces })
    }
    setComercios([...grupos.values()])
    setCategorias(catRes.data ?? [])

    const res: Record<string, ResumenComercio> = {}
    for (const t of (tRes.data as { comercio: string | null; monto: number | null; fecha_ticket: string | null; created_at: string; ticket_items: { monto: number | null; autorizacion: string }[] | null }[] | null) ?? []) {
      const k = clave(t.comercio)
      if (!k) continue
      const r = res[k] ?? (res[k] = { gasto: 0, tickets: 0, ultima: null, categorias: [] })
      // Renglones no autorizados sin aprobar (094) no son gasto: igual que los oficiales de Tickets.
      const noCuenta = (t.ticket_items ?? []).filter(i => i.autorizacion === 'pendiente' || i.autorizacion === 'rechazado').reduce((s, i) => s + Number(i.monto ?? 0), 0)
      r.gasto += Number(t.monto ?? 0) - noCuenta
      r.tickets += 1
      const f = t.fecha_ticket ?? t.created_at.slice(0, 10)
      if (!r.ultima || f > r.ultima) r.ultima = f
    }

    // Categorias del periodo por comercio (con monto) + ultima compra de cada articulo en cada comercio.
    const catsPorCom: Record<string, Map<string, number>> = {}
    const ultimaPorArtCom = new Map<string, Map<string, CompraArticulo>>() // articulo -> comercio -> ultima compra
    const artInfo = new Map<string, { nombre: string; unidad: string | null }>()
    const vecesArtCom = new Map<string, number>() // `${comercio}|${articulo}` -> veces
    for (const it of (iRes.data as unknown as FilaItem[] | null) ?? []) {
      const t = it.registros_tickets
      const com = clave(t?.comercio)
      if (!t || !com) continue
      const fecha = t.fecha_ticket ?? t.created_at.slice(0, 10)
      const monto = Number(it.monto ?? 0)
      if (fecha >= desde && fecha <= hasta && it.categorias_gasto?.nombre) {
        const m = catsPorCom[com] ?? (catsPorCom[com] = new Map())
        m.set(it.categorias_gasto.nombre, (m.get(it.categorias_gasto.nombre) ?? 0) + monto)
      }
      const cant = Number(it.cantidad ?? 0)
      const art = it.producto_catalogo_id
      if (!art || !it.catalogo_productos || cant <= 0 || monto <= 0) continue
      artInfo.set(art, { nombre: it.catalogo_productos.nombre, unidad: it.catalogo_productos.unidad_default })
      vecesArtCom.set(`${com}|${art}`, (vecesArtCom.get(`${com}|${art}`) ?? 0) + 1)
      const porCom = ultimaPorArtCom.get(art) ?? new Map<string, CompraArticulo>()
      const previa = porCom.get(com)
      if (!previa || fecha >= previa.fecha) porCom.set(com, { comercio: t.comercio!.trim(), precio: monto / cant, fecha })
      ultimaPorArtCom.set(art, porCom)
    }
    for (const [k, m] of Object.entries(catsPorCom)) {
      const r = res[k] ?? (res[k] = { gasto: 0, tickets: 0, ultima: null, categorias: [] })
      r.categorias = [...m.entries()].map(([nombre, gasto]) => ({ nombre, gasto })).sort((a, b) => b.gasto - a.gasto)
    }

    const arts: Record<string, ArticuloAqui[]> = {}
    for (const [art, porCom] of ultimaPorArtCom) {
      for (const [com, aqui] of porCom) {
        let mejor: CompraArticulo | null = null
        for (const [otro, c] of porCom) if (otro !== com && (!mejor || c.precio < mejor.precio)) mejor = c
        const info = artInfo.get(art)!
        ;(arts[com] ??= []).push({ id: art, nombre: info.nombre, unidad: info.unidad, veces: vecesArtCom.get(`${com}|${art}`) ?? 0, precioAqui: aqui.precio, mejor })
      }
    }
    for (const lista of Object.values(arts)) lista.sort((a, b) => b.veces - a.veces)
    setResumen(res)
    setArticulos(arts)
    setLoading(false)
  }, [sucursalId, desde, hasta])

  useEffect(() => { fetchData() }, [fetchData])

  async function setCategoria(c: Grupo, categoriaId: string) {
    const { error } = await supabase.from('comercios').update({ categoria_id: categoriaId || null }).in('id', c.ids)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    setComercios(prev => prev.map(x => x.clave === c.clave ? { ...x, categoria_id: categoriaId || null } : x))
    toast(categoriaId ? 'Listo: lo que la IA no reconozca de este comercio irá a esa categoría' : 'Listo: la IA decide artículo por artículo')
  }
  async function eliminar(c: Grupo) {
    if (!(await confirm(`¿Olvidar el comercio "${c.nombre}"? Sale de esta lista; sus tickets no cambian. Si vuelve a aparecer en un ticket, la IA lo aprende de nuevo.`, { danger: true }))) return
    const { error } = await supabase.from('comercios').delete().in('id', c.ids)
    if (error) { toast('No se pudo olvidar: ' + error.message, 'error'); return }
    setComercios(prev => prev.filter(x => x.clave !== c.clave))
  }

  // Tickets del comercio para la galeria (no rechazados, mas recientes primero).
  const cargarTicketsDe = (nombre: string) => async (): Promise<EjemploTicket[]> => {
    let q = supabase.from('registros_tickets')
      .select('comercio, monto, fecha_ticket, created_at, storage_path_original, storage_path_archivo')
      .ilike('comercio', nombre.replace(/[\\%_]/g, m => '\\' + m)).neq('estado', 'rechazado')
      .order('fecha_ticket', { ascending: false, nullsFirst: false }).limit(200)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    const { data } = await q
    return ((data as { comercio: string | null; monto: number | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null }[] | null) ?? []).map(t => ({
      descripcion: null, cantidad: null, unidad: null, monto: t.monto, comercio: t.comercio,
      fecha: t.fecha_ticket ?? t.created_at.slice(0, 10),
      bucket: t.storage_path_archivo ? 'archivo' : t.storage_path_original ? 'por-revisar' : null,
      path: t.storage_path_archivo ?? t.storage_path_original,
    }))
  }

  const conGasto = (c: Grupo) => resumen[c.clave]?.gasto ?? 0
  const filtrados = comercios
    .filter(c => !search || c.nombre.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => conGasto(b) - conGasto(a) || b.veces - a.veces)
  const totalPeriodo = Object.values(resumen).reduce((s, r) => s + r.gasto, 0)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Comercios</h2>
        <p className="nota max-w-2xl">
          La IA reconoce los comercios sola al leer los tickets. Aquí ves cuánto le compras a cada uno y si un artículo te sale más barato en otro lado.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="etiqueta">Periodo</p>
          <SelectorPeriodo desde={desde} hasta={hasta} onChange={(d, h) => { setDesde(d); setHasta(h) }} />
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar comercio…"
          aria-label="Buscar comercio" className="campo flex-1 min-w-[180px]" />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      ) : filtrados.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-12">{comercios.length === 0 ? 'Aún no hay comercios. Aparecen solos al procesar tickets.' : 'Sin coincidencias'}</p>
      ) : (
        <div className="grid items-start gap-2">
          {filtrados.map(c => {
            const r = resumen[clave(c.nombre)]
            const arts = articulos[clave(c.nombre)] ?? []
            const expandido = abierto === c.clave
            const pct = r && totalPeriodo > 0 ? (r.gasto / totalPeriodo) * 100 : 0
            const forzada = categorias.find(k => k.id === c.categoria_id)?.nombre
            return (
              <div key={c.clave} className="tarjeta overflow-hidden">
                <button type="button" onClick={() => setAbierto(expandido ? null : c.clave)} aria-expanded={expandido}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-100 break-words">{c.nombre}</p>
                    <p className="text-xs text-zinc-500">
                      {r && r.tickets > 0
                        ? `${r.tickets} ${r.tickets === 1 ? 'ticket' : 'tickets'} · última compra ${fechaCorta(r.ultima)}`
                        : 'Sin compras en este periodo'}
                      {forzada && <> · <span className="text-blue-400">preestablecida: {forzada}</span></>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${r?.gasto ? 'text-zinc-100' : 'text-zinc-500'}`}>{fmt0(r?.gasto ?? 0)}</p>
                    {pct >= 1 && <p className="text-xs text-zinc-500">{pct.toFixed(0)}% del total</p>}
                  </div>
                  <span aria-hidden className={`text-zinc-500 transition-transform ${expandido ? 'rotate-90' : ''}`}>›</span>
                </button>

                {expandido && (
                  <div className="space-y-4 border-t border-zinc-800 px-4 py-4">
                    {r && r.categorias.length > 0 && (
                      <div className="space-y-1.5">
                        <h3 className="text-sm font-semibold text-zinc-300">En qué se gastó aquí</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {r.categorias.map(k => <span key={k.nombre} className="chip-neutro">{k.nombre} · {fmt0(k.gasto)}</span>)}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <h3 className="text-sm font-semibold text-zinc-300">Lo que compras aquí</h3>
                      {arts.length === 0 ? (
                        <p className="nota">Aún no hay artículos del catálogo comprados aquí.</p>
                      ) : (
                        <div className="rounded-lg bg-zinc-800/50 divide-y divide-zinc-800/60">
                          {arts.slice(0, 15).map(a => {
                            const masBaratoOtro = a.mejor && a.mejor.precio < a.precioAqui * 0.97
                            return (
                              <div key={a.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                                <span className="min-w-0 flex-1 text-zinc-200 break-words">{a.nombre}{a.unidad ? <span className="text-zinc-500"> /{a.unidad}</span> : ''}</span>
                                <span className="shrink-0 text-right">
                                  <span className="font-medium text-zinc-100">{fmt(a.precioAqui)}</span>
                                  {a.mejor == null ? (
                                    <span className="block text-xs text-zinc-500">solo lo compras aquí</span>
                                  ) : masBaratoOtro ? (
                                    <span className="block text-xs text-amber-400" title={`Última compra en ${a.mejor.comercio}: ${fechaCorta(a.mejor.fecha)}`}>
                                      {fmt(a.mejor!.precio)} en {a.mejor.comercio}
                                    </span>
                                  ) : (
                                    <span className="block text-xs text-emerald-400">aquí es lo más barato</span>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {arts.length > 0 && <p className="nota">Precio por unidad de la última compra en cada comercio.</p>}
                    </div>

                    <button type="button" onClick={() => setGaleria(c.nombre)} className="btn-texto btn-sm -ml-2"
                      title="Todas las fotos de tickets de este comercio, una por una: sirve para revisar notas escritas a mano o cobros raros">
                      Ver tickets de este comercio
                    </button>

                    <details className="group rounded-lg bg-zinc-800/50 px-3 py-2">
                      <summary className="cursor-pointer select-none text-[13px] font-medium text-zinc-400 hover:text-zinc-200">Opciones avanzadas</summary>
                      <div className="space-y-4 pt-3 pb-1">
                        <div className="space-y-1.5">
                          <label className="etiqueta block" htmlFor={`forzar-${c.clave}`}>Categoría preestablecida</label>
                          <select id={`forzar-${c.clave}`} value={c.categoria_id ?? ''} onChange={e => setCategoria(c, e.target.value)}
                            className="campo w-full sm:w-auto">
                            <option value="">Ninguna: la IA decide artículo por artículo</option>
                            {categorias.map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                          </select>
                          <p className="nota">Lo que la IA no reconozca de este comercio se manda aquí. Cada artículo lo puedes cambiar en Cerebro. Útil si el comercio vende una sola cosa (gasolinera, luz, gas); en Chedraui o Costco mejor «Ninguna».</p>
                        </div>
                        <div className="space-y-1">
                          <button onClick={() => eliminar(c)} className="btn-peligro btn-sm -ml-2">Olvidar comercio</button>
                          <p className="nota">Lo quita de esta lista. Sus tickets no cambian.</p>
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {galeria && (
        <GaleriaTickets titulo={galeria} cargar={cargarTicketsDe(galeria)} vacio="No hay fotos de tickets de este comercio"
          onCerrar={() => setGaleria(null)} />
      )}
    </div>
  )
}
