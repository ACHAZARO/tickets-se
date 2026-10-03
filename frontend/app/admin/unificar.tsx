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
  sinonimo: 'Ya se habian registrado como el mismo (uno es sinonimo del otro)',
  igual: 'Mismo nombre, sin contar tamanos ni plurales',
  parecido: 'Uno es solo una palabra del otro (menos seguro)',
  presentacion: 'Mismo nombre, distinto tamano',
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
      className="ml-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white">{n}</span>
  )
}

interface EjemploTicket {
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
  comercio: string | null
  fecha: string | null
  bucket: string | null
  path: string | null
  ligadoA: string | null   // a que producto quedo ligado el renglon (importa cuando se encontro por sinonimo)
}

type FilaItem = { descripcion: string | null; cantidad: number | null; unidad: string | null; monto: number | null
  catalogo_productos: { nombre: string } | null
  registros_tickets: { comercio: string | null; fecha_ticket: string | null; created_at: string; storage_path_original: string | null; storage_path_archivo: string | null } | null }

const SELECT_EJEMPLO = 'descripcion, cantidad, unidad, monto, catalogo_productos:producto_catalogo_id(nombre), ' +
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
        ligadoA: r.catalogo_productos?.nombre ?? null,
      }
    })
}

// Los renglones donde sale un producto, con la foto de su ticket (mas recientes primero, sin rechazados).
// Si el producto no tiene renglones propios, busca los renglones cuyo texto es uno de sus sinonimos: asi se ve
// que ese texto SI aparece en un ticket pero quedo ligado a otro producto (caso "Sal 1 kg" vs "Sal fina").
async function ejemplosDe(productoId: string): Promise<{ ejemplos: EjemploTicket[]; porSinonimo: boolean }> {
  const { data, error } = await supabase.from('ticket_items').select(SELECT_EJEMPLO)
    .eq('producto_catalogo_id', productoId).neq('registros_tickets.estado', 'rechazado').limit(40)
  if (error) return { ejemplos: [], porSinonimo: false }
  const propios = aEjemplos(data)
  if (propios.length) return { ejemplos: propios, porSinonimo: false }

  const { data: prod } = await supabase.from('catalogo_productos').select('sinonimos, sucursal_id').eq('id', productoId).maybeSingle()
  const sinonimos = ((prod?.sinonimos as string[] | null) ?? []).filter(Boolean)
  if (!sinonimos.length) return { ejemplos: [], porSinonimo: false }
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
  return { ejemplos: aEjemplos(porTexto), porSinonimo: true }
}

/** Una columna de "Ver tickets": la foto de un ticket donde sale el producto + lo que la IA leyo en ese renglon. */
function LadoTicket({ producto }: { producto: ProdSug }) {
  const [ejemplos, setEjemplos] = useState<EjemploTicket[] | null>(null)
  const [porSinonimo, setPorSinonimo] = useState(false)
  const [i, setI] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [cargandoFoto, setCargandoFoto] = useState(false)

  useEffect(() => { let vivo = true; ejemplosDe(producto.id).then(r => { if (vivo) { setEjemplos(r.ejemplos); setPorSinonimo(r.porSinonimo) } }); return () => { vivo = false } }, [producto.id])

  const actual = ejemplos?.[i] ?? null
  useEffect(() => {
    if (!actual?.bucket || !actual.path) { setUrl(null); return }
    let vivo = true
    setCargandoFoto(true)
    // Foto reducida: la original pesa varios MB y en celular tarda.
    supabase.storage.from(actual.bucket).createSignedUrl(actual.path, 3600, { transform: { width: 1000, quality: 72, resize: 'contain' } })
      .then(({ data }) => { if (vivo) { setUrl(data?.signedUrl ?? null); setCargandoFoto(false) } })
      .catch(() => { if (vivo) { setUrl(null); setCargandoFoto(false) } })
    return () => { vivo = false }
  }, [actual?.bucket, actual?.path])

  const cant = Number(actual?.cantidad); const monto = Number(actual?.monto)
  const precioUnit = Number.isFinite(cant) && cant > 0 && Number.isFinite(monto) && monto > 0 ? monto / cant : null

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-semibold text-zinc-100 truncate" title={producto.nombre}>{producto.nombre}</p>
      {ejemplos === null ? (
        <p className="text-[11px] text-zinc-500">Buscando tickets…</p>
      ) : ejemplos.length === 0 || !actual ? (
        <p className="text-[11px] text-zinc-500">No hay tickets con este nombre.</p>
      ) : (
        <>
          {porSinonimo && (
            <p className="rounded-md bg-amber-950/40 border border-amber-800/40 px-2 py-1 text-[11px] text-amber-200">
              Este nombre no tiene tickets propios. Este renglon dice lo mismo que su sinonimo, pero quedo ligado a
              {' '}<b>&quot;{actual.ligadoA ?? 'ningun producto'}&quot;</b>.
            </p>
          )}
          <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center">
            {cargandoFoto ? <span className="text-[11px] text-zinc-600">Cargando foto…</span>
              : url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="block h-full w-full" title="Abrir foto completa">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ticket con ${producto.nombre}`} className="h-full w-full object-contain" />
                </a>
              ) : <span className="text-[11px] text-zinc-600">Sin foto</span>}
          </div>
          <p className="text-[11px] text-zinc-300 break-words">En el ticket dice: <b className="text-zinc-100">&quot;{actual.descripcion ?? '—'}&quot;</b></p>
          <p className="text-[11px] text-zinc-500">
            {actual.cantidad ?? '?'} {actual.unidad ?? ''} · {actual.monto != null ? fmt(actual.monto) : '—'}
            {precioUnit != null ? ` · ${'$' + precioUnit.toLocaleString('es-MX', { maximumFractionDigits: 2 })} c/u` : ''}
          </p>
          <p className="text-[11px] text-zinc-500 truncate">{actual.comercio ?? 'sin comercio'} · {actual.fecha ?? ''}</p>
          {ejemplos.length > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={i === 0} onClick={() => setI(n => n - 1)}
                className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 disabled:opacity-30">‹</button>
              <span className="text-[11px] text-zinc-500">{i + 1} de {ejemplos.length}</span>
              <button type="button" disabled={i >= ejemplos.length - 1} onClick={() => setI(n => n + 1)}
                className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 disabled:opacity-30">›</button>
            </div>
          )}
        </>
      )}
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

  if (!sug || sug.length === 0) return null
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
    const aGana = s.a.usos >= s.b.usos
    const ocupado = busy === k

    const prod = (p: ProdSug) => (
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100 truncate" title={p.nombre}>{p.nombre}</p>
        <p className="text-[11px] text-zinc-500">
          {p.unidad ?? 'sin unidad'} · {p.usos} {p.usos === 1 ? 'compra' : 'compras'} · {fmt(p.gasto)}
          {p.contiene ? ` · trae ${p.contiene.cantidad} ${p.contiene.unidad}` : ''}
        </p>
      </div>
    )
    const btnUnificar = (destino: ProdSug, origen: ProdSug, principal: boolean) => (
      <button key={destino.id} type="button" disabled={ocupado} onClick={() => unir(s, origen, destino)}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${principal ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`}>
        Unificar en &quot;{destino.nombre}&quot;
      </button>
    )
    const btnInsumo = (
      <button type="button" disabled={ocupado} onClick={() => abrirForm(s)}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${esTamano && !f ? 'bg-sky-600 text-white hover:bg-sky-500' : 'bg-zinc-800 text-sky-300 hover:bg-zinc-700'}`}>
        {f ? 'Cancelar' : 'Mismo insumo, distinto tamaño'}
      </button>
    )

    const campos = (lado: 'a' | 'b', p: ProdSug) => (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-zinc-400 min-w-0 flex-1 truncate">1 {p.unidad ?? 'unidad'} de &quot;{p.nombre}&quot; =</span>
        <input value={f[lado].cantidad} inputMode="decimal" placeholder="cantidad"
          onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], [lado]: { ...fs[k][lado], cantidad: e.target.value } } }))}
          className="w-24 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100" />
        <select value={f[lado].unidad}
          onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], [lado]: { ...fs[k][lado], unidad: e.target.value } } }))}
          className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100">
          {[...new Set([...UNIDADES_CONTENIDO, f[lado].unidad].filter(Boolean))].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    )

    return (
      <div key={k} className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">{prod(s.a)}<span className="hidden sm:block text-zinc-600 self-center">=?</span>{prod(s.b)}</div>
        <p className="text-[11px] text-zinc-500">{MOTIVO_TEXTO[s.motivo]} · {nombreCat(s.categoria_id)} · {nombreSuc(s.sucursal_id)}</p>
        <button type="button" onClick={() => setViendo(v => ({ ...v, [k]: !v[k] }))}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-zinc-700">
          {viendo[k] ? 'Ocultar tickets' : 'Ver tickets'}
        </button>
        {viendo[k] && (
          <div className="rounded-lg bg-zinc-800/40 p-2 space-y-2">
            <p className="text-[11px] text-zinc-400">Un ticket de cada nombre. Toca la foto para verla completa.</p>
            <div className="grid grid-cols-2 gap-2">
              <LadoTicket producto={s.a} />
              <LadoTicket producto={s.b} />
            </div>
          </div>
        )}

        {f ? (
          <div className="rounded-lg bg-zinc-800/40 p-3 space-y-2">
            <p className="text-[11px] text-zinc-400">
              Quedan los dos productos (cada uno con su precio), pero sus compras se suman en un solo insumo para el inventario.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-zinc-500">Insumo</label>
              <input value={f.nombre} onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], nombre: e.target.value } }))}
                className="flex-1 min-w-[140px] rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-100" />
              <label className="text-[11px] text-zinc-500">se mide en</label>
              <select value={f.unidadBase} onChange={e => setForm(fs => ({ ...fs, [k]: { ...fs[k], unidadBase: e.target.value } }))}
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-100">
                {[...new Set([...UNIDADES_BASE, f.unidadBase])].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {campos('a', s.a)}
            {campos('b', s.b)}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={ocupado} onClick={() => guardarInsumo(s)}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {ocupado ? 'Guardando…' : 'Guardar insumo'}
              </button>
              {btnInsumo}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {esTamano ? (
              <>
                {btnInsumo}
                {btnUnificar(s.a, s.b, false)}
                {btnUnificar(s.b, s.a, false)}
              </>
            ) : (
              <>
                {btnUnificar(s.a, s.b, aGana)}
                {btnUnificar(s.b, s.a, !aGana)}
                {btnInsumo}
              </>
            )}
            <button type="button" disabled={ocupado} onClick={() => noSonIguales(s)}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50">No son iguales</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-amber-800/40 bg-amber-950/10 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-amber-200">Catalogo por revisar ({sug.length})</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
          <b className="text-zinc-400">Unificar</b> = es el mismo articulo con dos nombres y queda uno solo.{' '}
          <b className="text-zinc-400">Mismo insumo, distinto tamaño</b> = quedan los dos (cada uno con su precio) pero sus compras se suman
          para el inventario, por ejemplo Sal de 1 kg y de 1.1 kg = 2.1 kg de Sal. Nunca se hace nada sin tu respuesta.
        </p>
      </div>

      {mismos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Parecen el mismo articulo ({mismos.length})</p>
          {mismos.map(tarjeta)}
        </div>
      )}
      {tamanos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Mismo nombre, distinto tamaño ({tamanos.length})</p>
          {tamanos.map(tarjeta)}
        </div>
      )}
      {quiza.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerQuiza(v => !(v ?? abiertoPorDefecto))} className="text-xs font-medium uppercase tracking-widest text-zinc-500 hover:text-zinc-300">
            {abiertos ? '▾' : '▸'} Menos seguros ({quiza.length})
          </button>
          {abiertos && quiza.map(tarjeta)}
        </div>
      )}
    </section>
  )
}
