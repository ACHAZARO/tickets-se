'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from './ui'

// Catalogo ordenado: dos preguntas distintas sobre el mismo par de productos (migraciones 070-079).
//  1) UNIFICAR (070): es el mismo articulo con dos nombres -> queda UNO ("Mantequilla" + "Mantequilla Gloria 1 kg").
//  2) MISMO INSUMO (076): son dos TAMANOS del mismo insumo -> quedan los dos, cada uno con su precio, pero sus
//     cantidades se suman en la unidad base para el inventario ("FRESA 454 G" + "FRESA 907 G" = Fresa, en kg).
// La base detecta y esta pantalla PREGUNTA: nunca se une ni se agrupa nada solo. "No son iguales" se recuerda.

export const EVENTO_UNIFICACIONES = 'unificaciones-cambio'

export interface Contenido { cantidad: number; unidad: string }
export interface ProdSug {
  id: string
  nombre: string
  unidad: string | null
  usos: number
  gasto: number
  insumo_id: string | null
  contiene: Contenido | null   // lo guardado, o lo leido del nombre ("FRESA 454 G" -> 454 g)
}
export interface Sugerencia {
  motivo: 'sinonimo' | 'igual' | 'parecido' | 'presentacion'
  gasto_total: number
  categoria_id: string
  sucursal_id: string | null
  insumo_sugerido: string
  unidad_base_sugerida: string
  a: ProdSug
  b: ProdSug
}

const avisarCambio = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_UNIFICACIONES)) }

/** Une `origen` DENTRO de `destino`: origen desaparece del catalogo (con respaldo). */
export async function unificarProductos(origenId: string, destinoId: string): Promise<{ ok: true; renglones: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_unificar_productos', { p_origen: origenId, p_destino: destinoId })
  if (error) return { ok: false, error: error.message }
  avisarCambio()
  return { ok: true, renglones: Number((data as { renglones?: number } | null)?.renglones ?? 0) }
}

/** Agrupa presentaciones bajo un insumo (los productos siguen existiendo, cada uno con su precio). */
export async function agruparInsumo(
  productos: string[], nombre: string, unidadBase: string,
  contenidos: { producto_id: string; cantidad: number; unidad: string }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('admin_agrupar_insumo', {
    p_productos: productos, p_nombre: nombre, p_unidad_base: unidadBase, p_contenidos: contenidos,
  })
  if (error) return { ok: false, error: error.message }
  avisarCambio()
  return { ok: true }
}

export async function descartarUnificacion(a: string, b: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_descartar_unificacion', { p_a: a, p_b: b })
  if (error) return error.message
  avisarCambio()
  return null
}

// Nunca lanza: el circulito de la barra vive en TODAS las pantallas del admin y no puede romperlas.
async function pedirSugerencias(sucursalId: string): Promise<Sugerencia[]> {
  try {
    const { data, error } = await supabase.rpc('sugerir_unificaciones', { p_sucursal: sucursalId || null })
    if (error || !Array.isArray(data)) return []
    return data as Sugerencia[]
  } catch {
    return []
  }
}

const MOTIVO_TEXTO: Record<Sugerencia['motivo'], string> = {
  sinonimo: 'Ya se habían registrado como el mismo (uno es sinónimo del otro)',
  igual: 'Mismo nombre, sin contar tamaños ni plurales',
  parecido: 'Uno es solo una palabra del otro (menos seguro)',
  presentacion: 'Mismo nombre, distinto tamaño',
}
const UNIDADES_BASE = ['kg', 'lt', 'pz']
const UNIDADES_CONTENIDO = ['kg', 'g', 'lt', 'ml', 'pz', 'oz']
const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 })

/** Circulito con el numero de casos muy probables, junto a "Cerebro" en la barra. */
export function CerebroBadge({ pathname }: { pathname: string }) {
  const { sucursalId } = useSucursal()
  const [n, setN] = useState(0)
  // Solo cuenta la ULTIMA carga: al abrir, la sucursal guardada se restaura despues del primer render y salen dos
  // cargas seguidas; si la de "todas" terminaba despues, el circulito mostraba el numero de otra sucursal.
  const seq = useRef(0)
  const cargar = useCallback(async () => {
    const mio = ++seq.current
    const sug = await pedirSugerencias(sucursalId)
    if (mio !== seq.current) return
    // TODO lo pendiente, incluidos los "menos seguros": el numero no debe esconder trabajo por revisar.
    setN(sug.length)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar, pathname])
  useEffect(() => {
    window.addEventListener(EVENTO_UNIFICACIONES, cargar)
    return () => window.removeEventListener(EVENTO_UNIFICACIONES, cargar)
  }, [cargar])
  if (!n) return null
  return (
    <span title={`${n} productos del catalogo por revisar`}
      className="ml-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-amber-600 px-1.5 text-xs font-semibold leading-[18px] text-white">{n}</span>
  )
}

export interface EjemploTicket {
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  comercio: string | null
  fecha: string | null
  bucket: string | null
  path: string | null
}

type FilaItem = { descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null
  registros_tickets: { comercio: string | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null } | null }

const SELECT_EJEMPLO = 'descripcion, cantidad, unidad, monto, ' +
  'registros_tickets!inner(comercio, fecha_ticket, created_at, estado, sucursal_id, storage_path_original, storage_path_archivo)'

function aEjemplos(data: unknown): EjemploTicket[] {
  const fecha = (t: NonNullable<FilaItem['registros_tickets']>) => t.fecha_ticket ?? t.created_at
  return ((data as FilaItem[] | null) ?? [])
    .filter(r => r.registros_tickets)
    .sort((x, y) => fecha(y.registros_tickets!).localeCompare(fecha(x.registros_tickets!)))
    .map(r => {
      const t = r.registros_tickets!
      return {
        descripcion: r.descripcion, cantidad: r.cantidad, unidad: r.unidad, monto: r.monto,
        comercio: t.comercio, fecha: fecha(t).slice(0, 10),
        bucket: t.storage_path_archivo ? 'archivo' : t.storage_path_original ? 'por-revisar' : null,
        path: t.storage_path_archivo ?? t.storage_path_original,
      }
    })
}

// Los renglones donde sale un producto, con la foto de su ticket (mas recientes primero, sin rechazados).
// Si el producto no tiene renglones propios, busca los renglones cuyo texto es uno de sus sinonimos: asi se ve
// que ese texto SI aparece en un ticket aunque quedo ligado a otro producto (caso "Sal 1 kg" vs "Sal fina").
export async function ejemplosDe(productoId: string, max = 40): Promise<EjemploTicket[]> {
  const { data, error } = await supabase.from('ticket_items').select(SELECT_EJEMPLO)
    .eq('producto_catalogo_id', productoId).neq('registros_tickets.estado', 'rechazado').limit(max)
  if (error) return []
  const propios = aEjemplos(data)
  if (propios.length) return propios

  const { data: prod } = await supabase.from('catalogo_productos').select('sinonimos, sucursal_id').eq('id', productoId).maybeSingle()
  const sinonimos = ((prod?.sinonimos as string[] | null) ?? []).filter(Boolean)
  if (!sinonimos.length) return []
  // "Contiene", no exacto: el ticket trae prefijos como "2 x " antes del texto aprendido. Una consulta por
  // sinonimo (con % y _ escapados) para no armar un filtro .or() que se rompe con comas o parentesis.
  const porTexto: unknown[] = []
  for (const sin of sinonimos.slice(0, 6)) {
    let q = supabase.from('ticket_items').select(SELECT_EJEMPLO)
      .ilike('descripcion', `%${sin.replace(/[\\%_]/g, m => '\\' + m)}%`).neq('registros_tickets.estado', 'rechazado').limit(20)
    if (prod?.sucursal_id) q = q.eq('registros_tickets.sucursal_id', prod.sucursal_id)
    const { data: filas } = await q
    porTexto.push(...((filas as unknown[] | null) ?? []))
  }
  return aEjemplos(porTexto)
}

// Escoge un ticket para cada lado que NO sea la misma foto: el chiste es ver un ticket con cada nombre.
function elegirPar(as: EjemploTicket[], bs: EjemploTicket[]): { a: EjemploTicket | null; b: EjemploTicket | null } {
  for (const x of as) {
    const y = bs.find(e => e.path !== x.path)
    if (y) return { a: x, b: y }
  }
  if (as.length) return { a: as[0], b: null }
  return { a: null, b: bs[0] ?? null }
}

/** Una columna de "Ver tickets": nombre + foto. Toca la foto para verla completa. */
export function FotoTicket({ nombre, ej }: { nombre: string; ej: EjemploTicket | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!ej?.bucket || !ej.path) return
    let vivo = true
    // Foto reducida: la original pesa varios MB y en celular tarda.
    supabase.storage.from(ej.bucket).createSignedUrl(ej.path, 3600, { transform: { width: 1000, quality: 72, resize: 'contain' } })
      .then(({ data }) => { if (vivo) setUrl(data?.signedUrl ?? null) })
      .catch(() => {})
    return () => { vivo = false }
  }, [ej?.bucket, ej?.path])

  const hueco = (texto: string) => <span className="px-3 text-center nota">{texto}</span>
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium text-zinc-100 truncate" title={nombre}>{nombre}</p>
      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-zinc-900 flex items-center justify-center">
        {ej === undefined ? hueco('Buscando…')
          : !ej ? hueco('No hay otro ticket con este nombre')
          : url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full" title="Ver foto completa">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Ticket con ${nombre}`} className="h-full w-full object-contain" />
            </a>
          ) : hueco('Cargando foto…')}
      </div>
    </div>
  )
}

function CompararTickets({ a, b }: { a: ProdSug; b: ProdSug }) {
  const [par, setPar] = useState<{ a: EjemploTicket | null; b: EjemploTicket | null } | null>(null)
  useEffect(() => {
    let vivo = true
    Promise.all([ejemplosDe(a.id), ejemplosDe(b.id)]).then(([ea, eb]) => { if (vivo) setPar(elegirPar(ea, eb)) })
    return () => { vivo = false }
  }, [a.id, b.id])
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg bg-zinc-800/50 p-2">
      <FotoTicket nombre={a.nombre} ej={par ? par.a : undefined} />
      <FotoTicket nombre={b.nombre} ej={par ? par.b : undefined} />
    </div>
  )
}

interface FormInsumo {
  nombre: string
  unidadBase: string
  a: { cantidad: string; unidad: string }
  b: { cantidad: string; unidad: string }
}

/** Panel de Cerebro: lo que el catalogo tiene repetido, con la pregunta de que hacer. */
export function PanelDuplicados({ categorias, onCambio }: { categorias: { id: string; nombre: string }[]; onCambio: () => void }) {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [sug, setSug] = useState<Sugerencia[] | null>(null)
  const [verQuiza, setVerQuiza] = useState<boolean | null>(null)   // null = automatico (abierto si son pocos)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, FormInsumo>>({})
  const [viendo, setViendo] = useState<Record<string, boolean>>({})   // tarjetas con "Ver tickets" abierto

  const seq = useRef(0)
  const cargar = useCallback(async () => {
    const mio = ++seq.current
    const r = await pedirSugerencias(sucursalId)
    if (mio === seq.current) setSug(r)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar])

  if (!sug) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
  if (sug.length === 0) return <p className="tarjeta px-4 py-6 text-sm text-zinc-400">Todo en orden: no hay artículos por revisar.</p>
  const clave = (s: Sugerencia) => s.a.id + s.b.id
  const mismos = sug.filter(s => s.motivo === 'sinonimo' || s.motivo === 'igual')
  const tamanos = sug.filter(s => s.motivo === 'presentacion')
  const quiza = sug.filter(s => s.motivo === 'parecido')

  // Con pocos casos se muestran abiertos; con muchos (ej. 44 en Wings) se colapsan para no llenar la pantalla.
  const abiertoPorDefecto = quiza.length <= 10
  const abiertos = verQuiza ?? abiertoPorDefecto
  const nombreSuc = (id: string | null) => (id ? sucursales.find(x => x.id === id)?.nombre : null) ?? 'Todas las sucursales'
  const nombreCat = (id: string) => categorias.find(c => c.id === id)?.nombre ?? 'sin categoria'

  async function unir(s: Sugerencia, origen: ProdSug, destino: ProdSug) {
    const ok = await confirm(
      `¿Unificar "${origen.nombre}" dentro de "${destino.nombre}"? Sus ${origen.usos} renglones (${fmt(origen.gasto)}) pasan a "${destino.nombre}", ` +
      `que tambien reconocera el nombre "${origen.nombre}". Queda respaldo.`)
    if (!ok) return
    setBusy(clave(s))
    const r = await unificarProductos(origen.id, destino.id)
    setBusy(null)
    if (!r.ok) { toast('No se pudo unificar: ' + r.error, 'error'); return }
    toast(`Unificado: ${r.renglones} renglones ahora en "${destino.nombre}"`)
    await cargar(); onCambio()
  }

  async function noSonIguales(s: Sugerencia) {
    setBusy(clave(s))
    const err = await descartarUnificacion(s.a.id, s.b.id)
    setBusy(null)
    if (err) { toast('No se pudo guardar: ' + err, 'error'); return }
    await cargar()
  }

  function abrirForm(s: Sugerencia) {
    const k = clave(s)
    if (form[k]) { setForm(f => { const n = { ...f }; delete n[k]; return n }); return }
    const de = (p: ProdSug) => ({
      cantidad: p.contiene ? String(p.contiene.cantidad) : '',
      unidad: p.contiene?.unidad ?? s.unidad_base_sugerida,
    })
    setForm(f => ({ ...f, [k]: { nombre: s.insumo_sugerido, unidadBase: s.unidad_base_sugerida, a: de(s.a), b: de(s.b) } }))
  }

  async function guardarInsumo(s: Sugerencia) {
    const k = clave(s)
    const f = form[k]
    if (!f || !f.nombre.trim()) { toast('Escribe el nombre del insumo', 'error'); return }
    const contenidos: { producto_id: string; cantidad: number; unidad: string }[] = []
    for (const [prod, campo] of [[s.a, f.a], [s.b, f.b]] as const) {
      const c = Number(campo.cantidad)
      if (campo.cantidad.trim() && (!Number.isFinite(c) || c <= 0)) { toast(`Cantidad invalida en "${prod.nombre}"`, 'error'); return }
      if (Number.isFinite(c) && c > 0 && campo.unidad.trim()) contenidos.push({ producto_id: prod.id, cantidad: c, unidad: campo.unidad.trim() })
    }
    setBusy(k)
    const r = await agruparInsumo([s.a.id, s.b.id], f.nombre.trim(), f.unidadBase, contenidos)
    setBusy(null)
    if (!r.ok) { toast('No se pudo guardar: ' + r.error, 'error'); return }
    toast(`"${f.nombre.trim()}" quedo como un solo insumo (${f.unidadBase})`)
    setForm(fs => { const n = { ...fs }; delete n[k]; return n })
    await cargar(); onCambio()
  }

  const tarjeta = (s: Sugerencia) => {
    const k = clave(s)
    const f = form[k]
    const esTamano = s.motivo === 'presentacion'
    const ocupado = busy === k

    const prod = (p: ProdSug) => (
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-zinc-100 truncate" title={p.nombre}>{p.nombre}</p>
        <p className="text-[13px] text-zinc-500">
          {p.unidad ?? 'sin unidad'} · {p.usos} {p.usos === 1 ? 'compra' : 'compras'} · {fmt(p.gasto)}
          {p.contiene ? ` · trae ${p.contiene.cantidad} ${p.contiene.unidad}` : ''}
        </p>
      </div>
    )
    const btnUnificar = (destino: ProdSug, origen: ProdSug) => (
      <button key={destino.id} type="button" disabled={ocupado} onClick={() => unir(s, origen, destino)}
        title={`Unificar: se queda "${destino.nombre}"`}
        className="btn-opcion btn-sm whitespace-normal text-left">
        {destino.nombre}
      </button>
    )
    const btnInsumo = (
      <button type="button" disabled={ocupado} onClick={() => abrirForm(s)}
        className={`${f ? 'btn-quieto' : 'btn-secundario'} btn-sm`}>
        {f ? 'Cancelar' : 'Mismo insumo, distinto tamaño'}
      </button>
    )

    const campos = (lado: 'a' | 'b', p: ProdSug) => (
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span className="text-sm text-zinc-200 break-words sm:min-w-0 sm:flex-1">{p.nombre} =</span>
        <div className="flex items-center gap-2">
        <input value={f[lado].cantidad} inputMode="decimal" placeholder="cantidad"
          onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], [lado]: { ...fs[k][lado], cantidad: e.target.value } } }))}
          className="campo w-24 py-1.5" />
        <select value={f[lado].unidad}
          onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], [lado]: { ...fs[k][lado], unidad: e.target.value } } }))}
          className="campo py-1.5">
          {[...new Set([...UNIDADES_CONTENIDO, f[lado].unidad].filter(Boolean))].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        </div>
      </div>
    )

    return (
      <div key={k} className="tarjeta p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">{prod(s.a)}<span className="hidden sm:block text-zinc-500 self-center" aria-hidden>≟</span>{prod(s.b)}</div>
        <p className="nota">{MOTIVO_TEXTO[s.motivo]} · {nombreCat(s.categoria_id)} · {nombreSuc(s.sucursal_id)}</p>
        {viendo[k] && <CompararTickets a={s.a} b={s.b} />}

        {f ? (
          <div className="rounded-lg bg-zinc-800/50 p-3 space-y-3">
            <p className="nota">Quedan los dos, cada uno con su precio; el inventario los suma.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="etiqueta">Insumo</label>
              <input value={f.nombre} onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], nombre: e.target.value } }))}
                className="campo flex-1 min-w-[140px] py-1.5" />
              <label className="etiqueta">se mide en</label>
              <select value={f.unidadBase} onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], unidadBase: e.target.value } }))}
                className="campo py-1.5">
                {[...new Set([...UNIDADES_BASE, f.unidadBase])].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {campos('a', s.a)}
            {campos('b', s.b)}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={ocupado} onClick={() => guardarInsumo(s)}
                className="btn-primario btn-sm">
                {ocupado ? 'Guardando…' : 'Guardar insumo'}
              </button>
              {btnInsumo}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-zinc-400">Unificar, se queda:</span>
            {btnUnificar(s.a, s.b)}
            {btnUnificar(s.b, s.a)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {btnInsumo}
            <button type="button" onClick={() => setViendo(v => ({ ...v, [k]: !v[k] }))} className="btn-texto btn-sm">
              {viendo[k] ? 'Ocultar tickets' : 'Ver tickets'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => noSonIguales(s)}
              className="btn-quieto btn-sm sm:ml-auto">No son iguales</button>
          </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-5">
      <p className="text-sm text-zinc-400"><span className="chip-revisar mr-1.5">{sug.length}</span>parejas por revisar</p>

      {mismos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-300">Parecen el mismo ({mismos.length})</h3>
          {mismos.map(tarjeta)}
        </div>
      )}
      {tamanos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-300">Mismo nombre, distinto tamaño ({tamanos.length})</h3>
          {tamanos.map(tarjeta)}
        </div>
      )}
      {quiza.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerQuiza(v => !(v ?? abiertoPorDefecto))} className="text-sm font-semibold text-zinc-300 hover:text-zinc-100">
            {abiertos ? '▾' : '▸'} Menos seguros ({quiza.length})
          </button>
          {abiertos && quiza.map(tarjeta)}
        </div>
      )}
    </section>
  )
}
