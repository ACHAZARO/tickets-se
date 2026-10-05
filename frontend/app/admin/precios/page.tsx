'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { traerTodo } from '@/lib/traer-todo'
import { useSucursal } from '@/lib/sucursal-context'
import { EditorArticulo, EditorRenglon } from '../editores'
import { useToast } from '../ui'
import { FotoTicket, type EjemploTicket } from '../unificar'

// Cada punto guarda de que ticket salio, para poder ver la foto y abrir el ticket (Ver tickets).
interface Punto {
  precio: number; fecha: string | null; created_at: string
  ticketId: string; itemId: string; descripcion: string | null; cantidad: number; unidad: string | null; monto: number
  comercio: string | null; bucket: string | null; path: string | null
}
// Revision de una alerta de precio (edge function revisar-precio). La IA propone; quien revisa aplica.
interface Revision {
  estado: 'cargando' | 'listo' | 'error' | 'aplicando'
  par: string            // el par que reviso la IA: si cambia (compra nueva), la revision ya no aplica
  error?: string
  veredicto?: 'falsa_alarma' | 'subida_real' | 'otro_articulo' | 'no_se'
  explicacion?: string
  modelo?: string
  correcciones?: { item_id: string; renglon: string; cantidad: number; unidad: string | null }[]
  equivalencia?: { producto_id: string; contiene_cantidad: number; contiene_unidad: string } | null
}
const UMBRAL_IA = 100 // % de variacion a partir del cual vale la pena preguntarle a la IA
const VEREDICTO: Record<string, { texto: string; chip: string }> = {
  falsa_alarma: { texto: 'Falsa alarma', chip: 'chip-bien' },
  subida_real: { texto: 'Subida real', chip: 'chip-mal' },
  otro_articulo: { texto: 'Son artículos distintos', chip: 'chip-revisar' },
  no_se: { texto: 'La IA no está segura', chip: 'chip-neutro' },
}

interface ProdPrecio {
  nombre: string
  productoId: string | null // articulo del catalogo (para "Editar artículo")
  unidad: string | null
  puntos: Punto[]
  ultimo: number
  anterior: number | null
  variacion: number | null // % vs anterior
  par: string | null        // 'itemAnterior|itemUltimo' (para recordar lo revisado)
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
  const [editandoArt, setEditandoArt] = useState<string | null>(null)       // panel lateral: articulo
  const [editandoRenglon, setEditandoRenglon] = useState<string | null>(null) // panel lateral: renglon
  const toast = useToast()
  const [revisiones, setRevisiones] = useState<Record<string, Revision>>({})   // por nombre de articulo
  const [revisados, setRevisados] = useState<Record<string, string>>({})       // par -> veredicto guardado
  const [revisandoTodo, setRevisandoTodo] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Fuente real: renglones CONFIRMADOS con cantidad y monto -> precio unitario.
    // (No dependemos de precio_historial, asi aparecen TODOS los productos comprados.)
    const { data } = await traerTodo(() => {
      let q = supabase.from('ticket_items')
        .select('id, descripcion, cantidad, unidad, monto, producto_catalogo_id, catalogo_productos:producto_catalogo_id(nombre, unidad_default, uso), registros_tickets!inner(id, comercio, fecha_ticket, created_at, estado, sucursal_id, storage_path_original, storage_path_archivo)')
        .eq('registros_tickets.estado', 'confirmado')
      if (sucursalId) q = q.eq('registros_tickets.sucursal_id', sucursalId)
      return q
    })

    const map = new Map<string, ProdPrecio>()
    for (const row of (data as unknown as Array<{ id: string; descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null; producto_catalogo_id: string | null; catalogo_productos: { nombre: string; unidad_default: string | null; uso?: string } | null; registros_tickets: { id: string; comercio: string | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null } | null }>) ?? []) {
      // Ocasionales y no autorizados no llevan alertas de precio (094).
      if ((row.catalogo_productos?.uso ?? 'normal') !== 'normal') continue
      const monto = Number(row.monto); const cant = Number(row.cantidad)
      if (!Number.isFinite(monto) || monto <= 0 || !Number.isFinite(cant) || cant <= 0) continue
      const nombre = (row.catalogo_productos?.nombre ?? row.descripcion ?? '').trim()
      if (!nombre) continue
      const key = nombre.toLowerCase()
      const unidad = row.catalogo_productos?.unidad_default ?? row.unidad ?? null
      if (!map.has(key)) map.set(key, { nombre, productoId: row.producto_catalogo_id, unidad, puntos: [], ultimo: 0, anterior: null, variacion: null, par: null })
      const t = row.registros_tickets
      map.get(key)!.puntos.push({
        precio: monto / cant, fecha: t?.fecha_ticket ?? null, created_at: t?.created_at ?? '',
        ticketId: t?.id ?? '', itemId: row.id, descripcion: row.descripcion, cantidad: cant, unidad: row.unidad, monto, comercio: t?.comercio ?? null,
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
      p.par = n >= 2 ? `${p.puntos[n - 2].itemId}|${p.puntos[n - 1].itemId}` : null
      list.push(p)
    }
    list.sort((a, b) => Math.abs(b.variacion ?? 0) - Math.abs(a.variacion ?? 0) || b.ultimo - a.ultimo)
    setProds(list)
    // Pares (anterior, ultimo) que ya se revisaron: no vuelven a alarmar.
    const { data: rev } = await supabase.from('precios_revisados').select('item_anterior, item_ultimo, veredicto')
    setRevisados(Object.fromEntries(((rev as { item_anterior: string; item_ultimo: string; veredicto: string }[] | null) ?? [])
      .map(r => [`${r.item_anterior}|${r.item_ultimo}`, r.veredicto])))
    setLoading(false)
  }, [sucursalId])

  const pendienteIA = (p: ProdPrecio) => p.par != null && p.variacion != null && Math.abs(p.variacion) >= UMBRAL_IA && !revisados[p.par]

  async function revisarConIA(p: ProdPrecio) {
    if (!p.par) return
    const [item_anterior, item_ultimo] = p.par.split('|')
    setRevisiones(r => ({ ...r, [p.nombre]: { estado: 'cargando', par: p.par! } }))
    const { data, error } = await supabase.functions.invoke('revisar-precio', { body: { item_anterior, item_ultimo } })
    if (error || !data?.ok) {
      let msg = data?.error ?? 'No se pudo revisar'
      try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* sin cuerpo */ }
      setRevisiones(r => ({ ...r, [p.nombre]: { estado: 'error', error: msg, par: p.par! } }))
      return
    }
    setRevisiones(r => ({ ...r, [p.nombre]: { ...data, estado: 'listo', par: p.par! } }))
  }

  async function revisarTodas() {
    // Los que ya tienen respuesta (o se estan revisando) no se vuelven a mandar: cada revision cuesta.
    const lista = prods.filter(p => pendienteIA(p) && !revisiones[p.nombre])
    if (lista.length === 0) return
    setRevisandoTodo(true)
    // De 2 en 2 para no saturar la cuota de la IA.
    for (let i = 0; i < lista.length; i += 2) await Promise.all(lista.slice(i, i + 2).map(revisarConIA))
    setRevisandoTodo(false)
  }

  async function guardarVeredicto(p: ProdPrecio, veredicto: 'subida_real' | 'corregido' | 'otro_articulo', rv?: Revision) {
    const par = rv?.par ?? p.par   // se guarda el par que REVISO la IA, no otro
    if (!par) return false
    const [item_anterior, item_ultimo] = par.split('|')
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('precios_revisados').upsert({
      item_anterior, item_ultimo, veredicto, explicacion: rv?.explicacion ?? null, modelo: rv?.modelo ?? null,
      revisado_por: session?.user?.email ?? 'admin',
    }, { onConflict: 'item_anterior,item_ultimo' })
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return false }
    return true
  }

  async function aplicarCorreccion(p: ProdPrecio, rv: Revision) {
    if (rv.par !== p.par) { toast('Llegó otra compra de este artículo: vuelve a revisarlo', 'error'); return }
    setRevisiones(r => ({ ...r, [p.nombre]: { ...rv, estado: 'aplicando' } }))
    const fallo = (msg: string) => { toast(msg, 'error'); setRevisiones(r => ({ ...r, [p.nombre]: { ...rv, estado: 'listo' } })) }
    // 1) La equivalencia primero: si no se puede (articulo con 2 niveles), no se toca nada.
    if (rv.equivalencia) {
      const { data: tocadas, error } = await supabase.from('catalogo_productos')
        .update({ contiene_cantidad: rv.equivalencia.contiene_cantidad, contiene_unidad: rv.equivalencia.contiene_unidad })
        .eq('id', rv.equivalencia.producto_id).is('contiene_sub_cantidad', null).select('id')
      if (error) return fallo('No se pudo guardar la equivalencia: ' + error.message)
      if (!tocadas?.length) return fallo('Este artículo tiene una equivalencia de dos niveles: corrígela con «Editar artículo».')
    }
    // 2) Los renglones, y luego el historial de precios de sus tickets.
    const tickets = new Set<string>()
    for (const c of rv.correcciones ?? []) {
      const { data: ti, error } = await supabase.from('ticket_items').update({ cantidad: c.cantidad, unidad: c.unidad }).eq('id', c.item_id).select('registro_ticket_id')
      if (error) return fallo('No se pudo corregir el renglón: ' + error.message)
      for (const x of (ti as { registro_ticket_id: string }[] | null) ?? []) tickets.add(x.registro_ticket_id)
    }
    for (const t of tickets) await supabase.rpc('recalcular_precios_ticket', { p_registro: t })
    // Si corregimos un renglon, el par cambia de precio: se guarda igual para no volver a alarmar por lo mismo.
    if (!(await guardarVeredicto(p, 'corregido', rv))) return
    toast(`«${p.nombre}» corregido`)
    setRevisiones(r => { const n = { ...r }; delete n[p.nombre]; return n })
    fetchData()
  }

  async function marcar(p: ProdPrecio, veredicto: 'subida_real' | 'otro_articulo', rv?: Revision) {
    if (!(await guardarVeredicto(p, veredicto, rv))) return
    toast(veredicto === 'subida_real' ? 'Marcada como subida real: ya no alarma' : 'Anotado: son artículos distintos, ya no alarma')
    setRevisiones(r => { const n = { ...r }; delete n[p.nombre]; return n })
    setRevisados(x => ({ ...x, [(rv?.par ?? p.par)!]: veredicto }))
  }

  // Tarjeta con lo que dijo la IA y lo que se puede hacer.
  const tarjetaRevision = (p: ProdPrecio, rv: Revision) => {
    if (rv.estado === 'cargando') return <p className="flex items-center gap-2 text-sm text-zinc-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />La IA está revisando las fotos…</p>
    if (rv.par !== p.par) return <p className="text-sm text-zinc-400">Llegó otra compra de este artículo desde que lo revisó la IA. <button onClick={() => revisarConIA(p)} className="btn-texto btn-sm">Revisar de nuevo</button></p>
    if (rv.estado === 'error') return <p className="text-sm text-red-400">{rv.error} <button onClick={() => revisarConIA(p)} className="btn-texto btn-sm">Reintentar</button></p>
    const v = VEREDICTO[rv.veredicto ?? 'no_se']
    const hayCorreccion = (rv.correcciones?.length ?? 0) > 0 || !!rv.equivalencia
    return (
      <div className="space-y-2.5">
        <p className="text-sm text-zinc-200"><span className={`${v.chip} mr-2`}>{v.texto}</span>{rv.explicacion}</p>
        {hayCorreccion && (
          <ul className="space-y-0.5 text-[13px] text-zinc-400">
            {rv.correcciones?.map(c => <li key={c.item_id}>Corregir el renglón {c.renglon}: {c.cantidad} {c.unidad ?? ''}</li>)}
            {rv.equivalencia && <li>Guardar en el artículo: 1 {p.unidad ?? 'unidad'} trae {rv.equivalencia.contiene_cantidad} {rv.equivalencia.contiene_unidad}</li>}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {hayCorreccion && (
            <button onClick={() => aplicarCorreccion(p, rv)} disabled={rv.estado === 'aplicando'} className="btn-primario btn-sm">
              {rv.estado === 'aplicando' ? 'Aplicando…' : 'Aplicar corrección'}
            </button>
          )}
          {rv.veredicto === 'otro_articulo' && (
            <>
              <button onClick={() => setEditandoRenglon(rv.par.split('|')[1])} className="btn-secundario btn-sm">Corregir renglón</button>
              <button onClick={() => marcar(p, 'otro_articulo', rv)} className="btn-quieto btn-sm">Son distintos, dejarlo así</button>
            </>
          )}
          <button onClick={() => marcar(p, 'subida_real', rv)} className={`${hayCorreccion ? 'btn-quieto' : 'btn-secundario'} btn-sm`}>Es subida real</button>
          {!hayCorreccion && rv.veredicto !== 'subida_real' && <button onClick={() => setViendo(p.nombre)} className="btn-texto btn-sm">Ver tickets</button>}
        </div>
      </div>
    )
  }

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setRevisiones({}) }, [sucursalId])

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
        {prods.some(pendienteIA) && (
          <button onClick={revisarTodas} disabled={revisandoTodo} className="btn-secundario"
            title="La IA mira las fotos de las variaciones de 100% o más y dice si es una medida mal tomada o una subida real">
            {revisandoTodo ? 'Revisando…' : `Revisar alertas con IA (${prods.filter(pendienteIA).length})`}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={soloCambios} onChange={e => setSoloCambios(e.target.checked)} className="accent-emerald-500" />
          Solo cambios ≥15%
        </label>
      </div>

      {prods.some(p => revisiones[p.nombre] && p.nombre !== abierto) && (
        <section className="tarjeta divide-y divide-zinc-800">
          <h3 className="px-4 py-3 text-sm font-semibold text-zinc-100">Revisión de la IA</h3>
          {prods.filter(p => revisiones[p.nombre] && p.nombre !== abierto).map(p => (
            <div key={p.nombre} className="space-y-2 px-4 py-3">
              <p className="text-sm font-medium text-zinc-100">{p.nombre} <span className="font-normal text-zinc-500">· {p.anterior != null ? fmt(p.anterior) : '—'} → {fmt(p.ultimo)}</span></p>
              {tarjetaRevision(p, revisiones[p.nombre])}
            </div>
          ))}
        </section>
      )}

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
                const veredictoGuardado = p.par ? revisados[p.par] : undefined
                const fuerte = p.variacion != null && Math.abs(p.variacion) >= 40 && !veredictoGuardado
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
                        {veredictoGuardado && <span className="block text-xs font-normal text-zinc-500">{veredictoGuardado === 'subida_real' ? 'subida real' : veredictoGuardado === 'corregido' ? 'corregido' : 'otro artículo'}</span>}
                        {!veredictoGuardado && pendienteIA(p) && <span className="block text-xs font-normal text-amber-400">¿falsa alarma?</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{p.puntos.length}</td>
                    </tr>
                    {exp && (
                      <tr className="border-b border-zinc-800/60 bg-zinc-800/30">
                        <td colSpan={5} className="px-4 py-3">
                          {/* La tabla es mas ancha que el celular: este bloque se queda del ancho de la pantalla */}
                          <div className="sticky left-4 w-[calc(100vw-4rem)] space-y-3 md:static md:w-auto">
                          <Sparkline puntos={p.puntos} />
                          {revisiones[p.nombre]
                            ? <div className="rounded-lg bg-zinc-900 p-3">{tarjetaRevision(p, revisiones[p.nombre])}</div>
                            : pendienteIA(p) && (
                              <button type="button" onClick={() => revisarConIA(p)} className="btn-secundario btn-sm"
                                title="La IA mira las dos fotos y dice si es una medida mal tomada o una subida real">Revisar con IA</button>
                            )}
                          <div className="flex flex-wrap items-center gap-2">
                            {p.puntos.length >= 1 && (
                              <button type="button" onClick={() => setViendo(viendo === p.nombre ? null : p.nombre)} className="btn-texto btn-sm -ml-2">
                                {viendo === p.nombre ? 'Ocultar tickets' : p.puntos.length >= 2 ? 'Ver tickets (anterior y último)' : 'Ver ticket'}
                              </button>
                            )}
                            {p.productoId && (
                              <button type="button" onClick={() => setEditandoArt(p.productoId)} className="btn-secundario btn-sm"
                                title="Corregir nombre, categoría, unidad o lo que trae (ej. 1 caja = 12 pz) sin salir de aquí">
                                Editar artículo
                              </button>
                            )}
                          </div>
                          {viendo === p.nombre && <CompararPrecios puntos={p.puntos} onCorregir={setEditandoRenglon} />}
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
      {editandoArt && <EditorArticulo productoId={editandoArt} onCerrar={() => setEditandoArt(null)} onGuardado={fetchData} />}
      {editandoRenglon && <EditorRenglon itemId={editandoRenglon} onCerrar={() => setEditandoRenglon(null)} onGuardado={fetchData} />}
    </div>
  )
}

const aEjemplo = (pt: Punto): EjemploTicket => ({
  descripcion: pt.descripcion, cantidad: pt.cantidad, unidad: pt.unidad, monto: pt.monto,
  comercio: pt.comercio, fecha: (pt.fecha ?? pt.created_at).slice(0, 10), bucket: pt.bucket, path: pt.path,
})

/** Anterior vs ultimo, foto con foto: se ve si es el mismo articulo, otro tamano o un renglon mal ligado. */
function CompararPrecios({ puntos, onCorregir }: { puntos: Punto[]; onCorregir: (itemId: string) => void }) {
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
            <button type="button" onClick={() => onCorregir(pt.itemId)} className="btn-texto btn-sm -ml-2"
              title="Corregir este renglón (cantidad, unidad o artículo ligado) sin salir de aquí">
              Corregir renglón
            </button>
          </div>
        ))}
      </div>
      <p className="nota">
        ¿Es el mismo artículo en otro tamaño (caja contra pieza)? Usa «Editar artículo» y pon la equivalencia.
        ¿Un renglón tiene mal la cantidad o el artículo? Usa «Corregir renglón».
      </p>
    </div>
  )
}
