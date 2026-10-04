'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm, Consejo } from './ui'
import { ElegirArticulo } from './elegir-articulo'

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

// "Por que aparece": explica de donde salio la pareja (no es una afirmacion de que sean lo mismo).
const MOTIVO_TEXTO: Record<Sugerencia['motivo'], string> = {
  sinonimo: 'la IA ya había aprendido uno de estos nombres como otra forma de escribir el otro',
  igual: 'tienen el mismo nombre si no cuentas tamaños ni plurales',
  parecido: 'un nombre está dentro del otro (puede que no sean lo mismo)',
  presentacion: 'mismo nombre, distinto tamaño',
}
// Unidad del insumo: gramos y mililitros primero (escribir 1000 g es mas facil que 0.001 kg).
const UNIDADES_BASE: { valor: string; texto: string }[] = [
  { valor: 'g', texto: 'gramos (g)' }, { valor: 'ml', texto: 'mililitros (ml)' }, { valor: 'pz', texto: 'piezas (pz)' },
  { valor: 'kg', texto: 'kilos (kg)' }, { valor: 'lt', texto: 'litros (lt)' },
]
// Lo que trae cada presentacion solo puede ir en unidades que se conviertan a la del insumo.
const COMPATIBLES: Record<string, string[]> = { g: ['g', 'kg'], kg: ['kg', 'g'], ml: ['ml', 'lt'], lt: ['lt', 'ml'], pz: ['pz'] }
const compatibles = (base: string) => COMPATIBLES[base] ?? [base]
const baseInicial = (sugerida: string) => sugerida === 'kg' ? 'g' : sugerida === 'lt' ? 'ml' : (COMPATIBLES[sugerida] ? sugerida : 'pz')
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
    // TODO lo pendiente, incluidos los "menos seguros"; se cuentan GRUPOS (un articulo en varias parejas = 1 revision).
    setN(agrupar(sug).length)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar, pathname])
  useEffect(() => {
    window.addEventListener(EVENTO_UNIFICACIONES, cargar)
    return () => window.removeEventListener(EVENTO_UNIFICACIONES, cargar)
  }, [cargar])
  if (!n) return null
  return (
    <span title={`${n} grupos de artículos por revisar`}
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

// --------------------------------------------------------------------------------------------------------------
// GRUPOS: la base devuelve PAREJAS ("Sal fina"~"Sal 1 kg", "Sal fina"~"Sal La Fina 1.1 kg"). Si un articulo sale en
// varias, se juntan en UN grupo (union de parejas conectadas) para revisarlo una sola vez.
// --------------------------------------------------------------------------------------------------------------
export interface Grupo {
  clave: string
  productos: ProdSug[]
  pares: Sugerencia[]
  motivo: Sugerencia['motivo']   // el mas seguro del grupo
  categoria_id: string
  sucursal_id: string | null
  insumo_sugerido: string
  unidad_base_sugerida: string
}
const RANGO: Record<Sugerencia['motivo'], number> = { sinonimo: 0, igual: 1, presentacion: 2, parecido: 3 }

export function agrupar(sug: Sugerencia[]): Grupo[] {
  const padre = new Map<string, string>()
  const raiz = (x: string): string => { const p = padre.get(x) ?? x; if (p === x) return x; const r = raiz(p); padre.set(x, r); return r }
  for (const s of sug) { padre.set(s.a.id, raiz(s.a.id)); padre.set(s.b.id, raiz(s.b.id)); padre.set(raiz(s.a.id), raiz(s.b.id)) }
  const porRaiz = new Map<string, Sugerencia[]>()
  for (const s of sug) { const r = raiz(s.a.id); porRaiz.set(r, [...(porRaiz.get(r) ?? []), s]) }
  return [...porRaiz.values()].map(pares => {
    const prods = new Map<string, ProdSug>()
    for (const s of pares) { prods.set(s.a.id, s.a); prods.set(s.b.id, s.b) }
    const mejor = [...pares].sort((x, y) => RANGO[x.motivo] - RANGO[y.motivo])[0]
    const productos = [...prods.values()].sort((x, y) => y.usos - x.usos || x.nombre.localeCompare(y.nombre))
    return {
      clave: productos.map(p => p.id).sort().join('|'), productos, pares, motivo: mejor.motivo,
      categoria_id: mejor.categoria_id, sucursal_id: mejor.sucursal_id,
      insumo_sugerido: mejor.insumo_sugerido, unidad_base_sugerida: mejor.unidad_base_sugerida,
    }
  }).sort((a, b) => RANGO[a.motivo] - RANGO[b.motivo] || b.pares.reduce((s, p) => s + p.gasto_total, 0) - a.pares.reduce((s, p) => s + p.gasto_total, 0))
}

// Una foto por articulo, sin repetir la misma foto entre articulos (el chiste es ver un ticket con cada nombre).
function elegirFotos(listas: EjemploTicket[][]): (EjemploTicket | null)[] {
  const usadas = new Set<string>()
  return listas.map(l => {
    const e = l.find(x => x.path && !usadas.has(x.path)) ?? null
    if (e?.path) usadas.add(e.path)
    return e
  })
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

function CompararTickets({ productos }: { productos: ProdSug[] }) {
  const [fotos, setFotos] = useState<(EjemploTicket | null)[] | null>(null)
  const ids = productos.map(p => p.id).join(',')
  useEffect(() => {
    let vivo = true
    Promise.all(productos.map(p => ejemplosDe(p.id))).then(l => { if (vivo) setFotos(elegirFotos(l)) })
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  return (
    <div className={`grid gap-3 rounded-lg bg-zinc-800/50 p-2 ${productos.length > 2 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
      {productos.map((p, i) => <FotoTicket key={p.id} nombre={p.nombre} ej={fotos ? fotos[i] : undefined} />)}
    </div>
  )
}

interface FormInsumo {
  nombre: string
  unidadBase: string
  trae: Record<string, { cantidad: string; unidad: string }>   // por articulo: cuanto trae cada uno
}

/** Panel de "Articulos por revisar": grupos de articulos que parecen repetidos, con la pregunta de que hacer. */
export function PanelDuplicados({ categorias, onCambio }: { categorias: { id: string; nombre: string }[]; onCambio: () => void }) {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [sug, setSug] = useState<Sugerencia[] | null>(null)
  const [verQuiza, setVerQuiza] = useState<boolean | null>(null)   // null = automatico (abierto si son pocos)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, FormInsumo>>({})
  const [viendo, setViendo] = useState<Record<string, boolean>>({})   // grupos con "Ver tickets" abierto
  const [eligiendo, setEligiendo] = useState<Record<string, boolean>>({}) // grupos con "Unificar" abierto
  // Insumos que ya existen: al nombrar uno se sugieren para no crear "Huevo" dos veces.
  const [insumos, setInsumos] = useState<{ id: string; nombre: string; unidad_base: string; sucursal_id: string | null }[]>([])

  const seq = useRef(0)
  const cargar = useCallback(async () => {
    const mio = ++seq.current
    const r = await pedirSugerencias(sucursalId)
    if (mio === seq.current) setSug(r)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    supabase.from('insumos').select('id, nombre, unidad_base, sucursal_id').order('nombre')
      .then(({ data }) => setInsumos((data as typeof insumos | null) ?? []))
  }, [sug])

  if (!sug) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
  if (sug.length === 0) return <p className="tarjeta px-4 py-6 text-sm text-zinc-400">Todo en orden: no hay artículos por revisar.</p>
  const grupos = agrupar(sug)
  const mismos = grupos.filter(g => g.motivo === 'sinonimo' || g.motivo === 'igual')
  const tamanos = grupos.filter(g => g.motivo === 'presentacion')
  const quiza = grupos.filter(g => g.motivo === 'parecido')

  // Con pocos casos se muestran abiertos; con muchos (ej. 44 en Wings) se colapsan para no llenar la pantalla.
  const abiertoPorDefecto = quiza.length <= 10
  const abiertos = verQuiza ?? abiertoPorDefecto
  const nombreSuc = (id: string | null) => (id ? sucursales.find(x => x.id === id)?.nombre : null) ?? 'Todas las sucursales'
  const nombreCat = (id: string) => categorias.find(c => c.id === id)?.nombre ?? 'sin categoria'

  const cerrarPaneles = (k: string) => {
    setEligiendo(e => ({ ...e, [k]: false }))
    setForm(f => { const n = { ...f }; delete n[k]; return n })
  }

  // Unificar el grupo: todos pasan al articulo elegido.
  async function unir(g: Grupo, destino: ProdSug) {
    const otros = g.productos.filter(p => p.id !== destino.id)
    const compras = otros.reduce((s, p) => s + p.usos, 0)
    const ok = await confirm(
      `¿Unificar bajo "${destino.nombre}"?\n\nLas ${compras} ${compras === 1 ? 'compra' : 'compras'} de ${otros.map(p => `"${p.nombre}"`).join(', ')} pasan a "${destino.nombre}". ` +
      `Cuando la IA lea esos nombres en un ticket, los guardará como "${destino.nombre}". Queda respaldo.`)
    if (!ok) return
    setBusy(g.clave)
    let renglones = 0
    for (const o of otros) {
      const r = await unificarProductos(o.id, destino.id)
      if (!r.ok) { setBusy(null); toast(`No se pudo unificar "${o.nombre}": ${r.error}`, 'error'); await cargar(); onCambio(); return }
      renglones += r.renglones
    }
    setBusy(null)
    toast(`Unificado: ${renglones} renglones ahora en "${destino.nombre}"`)
    await cargar(); onCambio()
  }

  // "No son iguales": descarta las parejas del grupo (todas, o solo las de un articulo si se saca del grupo).
  async function descartar(g: Grupo, soloProducto?: ProdSug) {
    const pares = soloProducto ? g.pares.filter(s => s.a.id === soloProducto.id || s.b.id === soloProducto.id) : g.pares
    setBusy(g.clave)
    for (const s of pares) {
      const err = await descartarUnificacion(s.a.id, s.b.id)
      if (err) { setBusy(null); toast('No se pudo guardar: ' + err, 'error'); await cargar(); return }
    }
    setBusy(null)
    toast(soloProducto ? `«${soloProducto.nombre}» salió del grupo` : 'Listo: quedan separados')
    await cargar()
  }

  function abrirForm(g: Grupo) {
    setEligiendo(e => ({ ...e, [g.clave]: false }))
    const base = baseInicial(g.unidad_base_sugerida)
    const trae: FormInsumo['trae'] = {}
    for (const p of g.productos) {
      trae[p.id] = p.contiene && compatibles(base).includes(p.contiene.unidad)
        ? { cantidad: String(p.contiene.cantidad), unidad: p.contiene.unidad }
        : { cantidad: '', unidad: base }
    }
    setForm(f => ({ ...f, [g.clave]: { nombre: g.insumo_sugerido, unidadBase: base, trae } }))
  }

  // Al cambiar la unidad del insumo, lo que traiga cada presentacion se pasa a una unidad compatible.
  function cambiarBase(k: string, base: string) {
    setForm(fs => {
      const f = fs[k]
      const trae = Object.fromEntries(Object.entries(f.trae).map(([id, l]) => [id, compatibles(base).includes(l.unidad) ? l : { cantidad: '', unidad: base }]))
      return { ...fs, [k]: { ...f, unidadBase: base, trae } }
    })
  }

  async function guardarInsumo(g: Grupo) {
    const f = form[g.clave]
    if (!f || !f.nombre.trim()) { toast('Escribe el nombre del insumo', 'error'); return }
    // contenidos: cantidad en la unidad elegida; el inventario la convierte a la unidad del insumo
    const contenidos: { producto_id: string; cantidad: number; unidad: string }[] = []
    for (const p of g.productos) {
      const campo = f.trae[p.id]
      const c = Number(campo?.cantidad)
      if (campo?.cantidad.trim() && (!Number.isFinite(c) || c <= 0)) { toast(`Cantidad inválida en "${p.nombre}"`, 'error'); return }
      if (campo && Number.isFinite(c) && c > 0 && campo.unidad.trim()) contenidos.push({ producto_id: p.id, cantidad: c, unidad: campo.unidad.trim() })
    }
    setBusy(g.clave)
    const r = await agruparInsumo(g.productos.map(p => p.id), f.nombre.trim(), f.unidadBase, contenidos)
    setBusy(null)
    if (!r.ok) { toast('No se pudo guardar: ' + r.error, 'error'); return }
    toast(`"${f.nombre.trim()}" quedó como un solo insumo (${f.unidadBase})`)
    cerrarPaneles(g.clave)
    await cargar(); onCambio()
  }

  const tarjeta = (g: Grupo) => {
    const k = g.clave
    const f = form[k]
    const unificando = !!eligiendo[k]
    const ocupado = busy === k
    const varios = g.productos.length > 2
    const toggleTickets = (
      <button type="button" onClick={() => setViendo(v => ({ ...v, [k]: !v[k] }))} className="btn-texto btn-sm sm:ml-auto">
        {viendo[k] ? 'Ocultar tickets' : 'Ver tickets'}
      </button>
    )
    const atras = <button type="button" onClick={() => cerrarPaneles(k)} className="btn-quieto btn-sm">Atrás</button>

    return (
      <div key={k} className="tarjeta overflow-hidden">
        {/* Barra de titulo: los articulos del grupo. Con las fotos abiertas, aqui mismo se cierran (▲). */}
        <div className="flex items-start gap-3 px-4 pt-4">
          <ul className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {g.productos.map((p, i) => (
              <li key={p.id} className="flex min-w-0 items-start gap-1.5 sm:max-w-[22rem]">
                {i > 0 && <span className="hidden pt-0.5 text-[13px] text-zinc-500 sm:inline" aria-hidden>vs</span>}
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-zinc-100 break-words">{p.nombre}</p>
                  <p className="text-[13px] text-zinc-500">
                    {p.unidad ?? 'sin unidad'} · {p.usos} {p.usos === 1 ? 'compra' : 'compras'} · {fmt(p.gasto)}
                    {p.contiene ? ` · trae ${p.contiene.cantidad} ${p.contiene.unidad}` : ''}
                  </p>
                </div>
                {varios && (
                  <button type="button" disabled={ocupado} onClick={() => descartar(g, p)} title={`«${p.nombre}» no es igual a los demás: sacarlo del grupo`}
                    aria-label={`Sacar ${p.nombre} del grupo`} className="btn-quieto btn-sm -mt-1 px-2 text-base leading-none">×</button>
                )}
              </li>
            ))}
          </ul>
          {viendo[k] && (
            <button type="button" onClick={() => setViendo(v => ({ ...v, [k]: false }))} aria-expanded="true"
              className="btn-secundario btn-sm shrink-0" title="Ocultar las fotos">
              <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
              Ocultar
            </button>
          )}
        </div>

        <div className="space-y-3 px-4 pb-4 pt-2">
          <p className="nota">
            <span className="font-medium text-zinc-400">Por qué aparece: </span>{MOTIVO_TEXTO[g.motivo]}. · {nombreCat(g.categoria_id)} · {nombreSuc(g.sucursal_id)}
          </p>

          {viendo[k] && <CompararTickets productos={g.productos} />}

          {unificando ? (
            <div className="rounded-lg bg-zinc-800/50 p-3 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-100">Elige el nombre con el que quieres identificar {varios ? 'todos' : 'ambos'}</p>
                <p className="nota">Cuando la IA lea los otros nombres en un ticket, los guardará bajo el que elijas. Sus compras pasan a ese nombre.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.productos.map(destino => (
                  <button key={destino.id} type="button" disabled={ocupado} onClick={() => unir(g, destino)}
                    className="btn-opcion btn-sm whitespace-normal text-left">
                    Unificar bajo «{destino.nombre}»
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">{atras}{toggleTickets}</div>
            </div>
          ) : f ? (
            <div className="rounded-lg bg-zinc-800/50 p-3 space-y-3">
              <p className="nota">Quedan {varios ? 'todos' : 'los dos'}, cada uno con su precio. El inventario los suma bajo un mismo insumo.</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="space-y-1">
                  <span className="etiqueta block">Nombre del insumo</span>
                  <ElegirArticulo key={`ins-${k}`} valorInicial={f.nombre} ariaLabel="Nombre del insumo" placeholder="ej. Huevo"
                    opciones={insumos.filter(i => i.sucursal_id === g.sucursal_id).map(i => ({ id: i.id, nombre: i.nombre, detalle: `se mide en ${i.unidad_base}` }))}
                    onCambio={(texto, elegida) => {
                      setForm(fs => ({ ...fs, [k]: { ...fs[k], nombre: texto } }))
                      // Si es un insumo que ya existe, se usa su misma unidad.
                      const ex = elegida && insumos.find(i => i.id === elegida.id)
                      if (ex && ex.unidad_base !== form[k]?.unidadBase) cambiarBase(k, ex.unidad_base)
                    }}
                    notaNuevo={t => <>«{t}» es un insumo nuevo: se creará al guardar.</>}
                    notaExistente={o => <>Se agregan a «{o.nombre}», que ya existe.</>} />
                </div>
                <label className="space-y-1">
                  <span className="etiqueta block">Se mide en</span>
                  <select value={f.unidadBase} onChange={e => cambiarBase(k, e.target.value)} className="campo w-full py-1.5">
                    {[...UNIDADES_BASE, ...(UNIDADES_BASE.some(u => u.valor === f.unidadBase) ? [] : [{ valor: f.unidadBase, texto: f.unidadBase }])]
                      .map(u => <option key={u.valor} value={u.valor}>{u.texto}</option>)}
                  </select>
                </label>
              </div>
              <Consejo>Mídelo en la misma unidad que usan tus recetas: si la receta pide gramos, elige gramos. Así el inventario y el costo de cada platillo cuadran.</Consejo>
              <div className="space-y-2">
                <p className="etiqueta">¿Cuánto trae cada uno?</p>
                {g.productos.map(p => {
                  const l = f.trae[p.id] ?? { cantidad: '', unidad: f.unidadBase }
                  const poner = (cambio: Partial<{ cantidad: string; unidad: string }>) =>
                    setForm(fs => ({ ...fs, [k]: { ...fs[k], trae: { ...fs[k].trae, [p.id]: { ...l, ...cambio } } } }))
                  return (
                    <div key={p.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                      <span className="text-sm text-zinc-200 break-words sm:min-w-0 sm:flex-1">{p.nombre} trae</span>
                      <div className="flex items-center gap-2">
                        <input value={l.cantidad} inputMode="decimal" placeholder="cantidad" aria-label={`Cuánto trae ${p.nombre}`}
                          onChange={e => poner({ cantidad: e.target.value })} className="campo w-28 py-1.5" />
                        <select value={l.unidad} aria-label={`Unidad de ${p.nombre}`} onChange={e => poner({ unidad: e.target.value })} className="campo py-1.5">
                          {compatibles(f.unidadBase).map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" disabled={ocupado} onClick={() => guardarInsumo(g)} className="btn-primario btn-sm">
                  {ocupado ? 'Guardando…' : 'Guardar insumo'}
                </button>
                {atras}
                {toggleTickets}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={ocupado} onClick={() => { cerrarPaneles(k); setEligiendo(e => ({ ...e, [k]: true })) }}
                className="btn-opcion btn-sm">Unificar</button>
              <button type="button" disabled={ocupado} onClick={() => abrirForm(g)} className="btn-opcion btn-sm">Mismo insumo, distinto tamaño</button>
              <button type="button" disabled={ocupado} onClick={() => descartar(g)} className="btn-opcion btn-sm">No son iguales</button>
              {toggleTickets}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      <p className="text-sm text-zinc-400"><span className="chip-revisar mr-1.5">{grupos.length}</span>{grupos.length === 1 ? 'grupo por revisar' : 'grupos por revisar'}</p>

      {mismos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-300">Parecen el mismo ({mismos.length})</h3>
          <div className="space-y-2">{mismos.map(tarjeta)}</div>
        </div>
      )}
      {tamanos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-300">Mismo nombre, distinto tamaño ({tamanos.length})</h3>
          <div className="space-y-2">{tamanos.map(tarjeta)}</div>
        </div>
      )}
      {quiza.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerQuiza(v => !(v ?? abiertoPorDefecto))} className="text-sm font-semibold text-zinc-300 hover:text-zinc-100">
            {abiertos ? '▾' : '▸'} Menos seguros ({quiza.length})
          </button>
          {abiertos && <div className="space-y-2">{quiza.map(tarjeta)}</div>}
        </div>
      )}
    </section>
  )
}
