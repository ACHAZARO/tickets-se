'use client'

import { useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from '../ui'

interface Item {
  id: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
  categoria_id: string | null
  producto_catalogo_id: string | null
  necesita_revision: boolean
  motivo_revision: string | null
  categorias_gasto: { nombre: string } | null
}
interface CatalogProduct {
  id: string
  nombre: string
  categoria_id: string | null
  unidad_default: string | null
  contiene_cantidad: number | null
  contiene_unidad: string | null
  contiene_sub_cantidad: number | null
  contiene_sub_unidad: string | null
}
interface Ticket {
  id: string
  comercio: string | null
  fecha_ticket: string | null
  monto: number | null
  estado: string
  created_at: string
  storage_path_original: string | null
  storage_path_archivo: string | null
  sucursal_id: string | null
  gemini_raw: Record<string, unknown> | null
  sucursales: { nombre: string } | null
  empleados: { nombre: string } | null
}
interface AlertRow { registro_ticket_id: string; tipo: string; resuelta: boolean }

const UNIDADES = ['pz', 'kg', 'g', 'ml', 'lt', 'caja', 'bulto', 'paquete', 'cono', 'charola', 'costal', 'reja', 'rollo', 'galon', 'six', 'docena', 'atado', 'manojo', 'otro']
// Unidades "simples": no necesitan equivalencia (1 kg ya es base). Cualquier OTRA
// unidad (caja, cono, charola, costal, otro...) puede traer N piezas -> mostramos equivalencia.
const BASE_UNIDADES = new Set(['pz', 'kg', 'g', 'ml', 'lt'])

const ESTADO_COLOR: Record<string, string> = {
  confirmado: 'bg-emerald-900/40 text-emerald-400',
  pendiente: 'bg-amber-900/40 text-amber-400',
  rechazado: 'bg-red-900/40 text-red-400',
  archivado: 'bg-zinc-800 text-zinc-400',
}
const ALERT_LABEL: Record<string, string> = {
  posible_duplicado: 'Posible duplicado',
  duplicado: 'Duplicado',
  ilegible: 'Ilegible',
  producto_no_reconocido: 'Productos nuevos',
  sin_unidad: 'Sin unidad',
  sin_fecha: 'Fecha asumida',
  precio_anomalo: 'Cambio de precio',
  monto_anomalo: 'Monto anomalo',
}

function primerDiaMesISO(): string {
  const n = new Date()
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`
}
const hoyISO = () => new Date().toISOString().slice(0, 10)
function diaSiguienteISO(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  dt.setDate(dt.getDate() + 1)
  return dt.toISOString().slice(0, 10)
}
const fmt = (n: number | null) => n != null ? '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '-'

function pathBucket(t: Ticket): { bucket: string; path: string } | null {
  if (t.storage_path_archivo) return { bucket: 'archivo', path: t.storage_path_archivo }
  if (t.storage_path_original) return { bucket: 'por-revisar', path: t.storage_path_original }
  return null
}

function emptyItem(ticketId: string): Omit<Item, 'categorias_gasto'> {
  return {
    id: `nuevo-${crypto.randomUUID()}`,
    descripcion: '',
    cantidad: 1,
    unidad: 'pz',
    monto: null,
    categoria_id: null,
    producto_catalogo_id: null,
    necesita_revision: true,
    motivo_revision: 'producto_nuevo',
  }
}

export default function TicketsPage() {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const nombreSucursal = sucursalId ? (sucursales.find(s => s.id === sucursalId)?.nombre ?? 'sucursal') : 'Todas las sucursales'
  const [desde, setDesde] = useState(primerDiaMesISO())
  const [hasta, setHasta] = useState(hoyISO())
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [alertas, setAlertas] = useState<Record<string, string[]>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<{ ticket: Ticket; items: Item[]; url: string | null } | null>(null)
  const [originalDesc, setOriginalDesc] = useState<Record<string, string>>({})
  const [catalogo, setCatalogo] = useState<CatalogProduct[]>([])
  const [cats, setCats] = useState<{ id: string; nombre: string }[]>([])
  const [comercioFiltro, setComercioFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendientes' | 'alertas' | 'confirmados'>('todos')
  const [editando, setEditando] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let q = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    q = sucursalId ? q.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : q
    q.then(({ data }) => setCats(data ?? []))
  }, [sucursalId])

  const loadCatalogo = useCallback(async (sucId: string | null) => {
    let q = supabase.from('catalogo_productos')
      .select('id, nombre, categoria_id, unidad_default, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, contiene_sub_unidad')
      .eq('activo', true).order('nombre')
    q = sucId ? q.or(`sucursal_id.is.null,sucursal_id.eq.${sucId}`) : q
    const { data } = await q
    setCatalogo((data as CatalogProduct[] | null) ?? [])
  }, [])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('registros_tickets')
      .select('id, comercio, fecha_ticket, monto, estado, created_at, storage_path_original, storage_path_archivo, sucursal_id, gemini_raw, sucursales:sucursal_id(nombre), empleados:empleado_id(nombre)')
      .gte('created_at', desde).lt('created_at', diaSiguienteISO(hasta))
      .order('created_at', { ascending: false }).limit(600)
    if (sucursalId) q = q.eq('sucursal_id', sucursalId)
    const { data, error } = await q
    if (error) { setLoadError(error.message); setTickets([]); setLoading(false); return }
    setLoadError(null)
    const rows = (data as unknown as Ticket[]) ?? []
    setTickets(rows)

    const ids = rows.map(t => t.id)
    if (ids.length) {
      const { data: alerts } = await supabase.from('alertas_tickets')
        .select('registro_ticket_id, tipo, resuelta')
        .in('registro_ticket_id', ids).eq('resuelta', false)
      const map: Record<string, string[]> = {}
      for (const a of (alerts as AlertRow[] | null) ?? []) {
        map[a.registro_ticket_id] = [...(map[a.registro_ticket_id] ?? []), a.tipo]
      }
      setAlertas(map)
    } else setAlertas({})

    const byBucket: Record<string, string[]> = { archivo: [], 'por-revisar': [] }
    for (const t of rows) { const pb = pathBucket(t); if (pb) byBucket[pb.bucket].push(pb.path) }
    const urlMap: Record<string, string> = {}
    for (const bucket of ['archivo', 'por-revisar']) {
      if (byBucket[bucket].length === 0) continue
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(byBucket[bucket], 3600)
      for (const s of signed ?? []) if (s.signedUrl && s.path) urlMap[`${bucket}/${s.path}`] = s.signedUrl
    }
    setUrls(urlMap)
    setLoading(false)
  }, [desde, hasta, sucursalId])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  function urlDe(t: Ticket): string | null {
    const pb = pathBucket(t)
    return pb ? (urls[`${pb.bucket}/${pb.path}`] ?? null) : null
  }

  // URL firmada REDIMENSIONADA para el modal: evita descargar la foto original de
  // varios MB (que congelaba el panel). Si el transform falla, cae al original.
  async function urlModal(t: Ticket): Promise<string | null> {
    const pb = pathBucket(t)
    if (!pb) return null
    try {
      const { data } = await supabase.storage.from(pb.bucket).createSignedUrl(pb.path, 3600, {
        transform: { width: 1400, quality: 72, resize: 'contain' },
      })
      return data?.signedUrl ?? urlDe(t)
    } catch {
      return urlDe(t)
    }
  }

  function ticketBadges(t: Ticket): string[] {
    const out = new Set<string>()
    if (!t.sucursal_id) out.add('Sin sucursal')
    if (!t.fecha_ticket) out.add('Sin fecha')
    if (t.gemini_raw?._fecha_asumida) out.add('Fecha asumida')
    if (t.estado === 'rechazado') out.add('Rechazado')
    for (const a of alertas[t.id] ?? []) out.add(ALERT_LABEL[a] ?? a)
    if (out.size === 0 && t.estado !== 'confirmado') out.add('Revisar ticket')
    return [...out]
  }

  async function abrirDetalle(t: Ticket) {
    setBusy('abrir')
    setEditando(true)
    await loadCatalogo(t.sucursal_id)
    const { data } = await supabase.from('ticket_items')
      .select('id, descripcion, cantidad, unidad, monto, categoria_id, producto_catalogo_id, necesita_revision, motivo_revision, categorias_gasto:categoria_id(nombre)')
      .eq('registro_ticket_id', t.id).order('created_at').order('id')
    const items = ((data as unknown as Item[]) ?? [])
    setOriginalDesc(Object.fromEntries(items.map(it => [it.id, it.descripcion])))
    const urlModalImg = await urlModal(t)
    setDetalle({ ticket: t, items, url: urlModalImg })
    setBusy(null)
  }

  function setItemField(itemId: string, field: keyof Item, value: string) {
    setDetalle(d => {
      if (!d) return d
      return { ...d, items: d.items.map(it => {
        if (it.id !== itemId) return it
        if (field === 'monto' || field === 'cantidad') return { ...it, [field]: value.trim() === '' ? null : Number(value) }
        return { ...it, [field]: value || null }
      }) }
    })
  }

  function vincularProducto(it: Item, prodId: string) {
    const prod = catalogo.find(p => p.id === prodId)
    setDetalle(d => d ? {
      ...d,
      items: d.items.map(x => x.id === it.id ? {
        ...x,
        producto_catalogo_id: prodId || null,
        categoria_id: prod?.categoria_id ?? x.categoria_id,
        unidad: prod?.unidad_default ?? x.unidad,
      } : x),
    } : d)
  }

  function agregarRenglon() {
    if (!detalle) return
    const it = emptyItem(detalle.ticket.id)
    setOriginalDesc(prev => ({ ...prev, [it.id]: '' }))
    setDetalle({ ...detalle, items: [...detalle.items, { ...it, categorias_gasto: null }] })
  }

  async function borrarRenglon(it: Item) {
    if (!detalle) return
    if (!it.id.startsWith('nuevo-')) await supabase.from('ticket_items').delete().eq('id', it.id)
    const nextItems = detalle.items.filter(x => x.id !== it.id)
    await syncTicketTotal(detalle.ticket.id, nextItems)
    setDetalle({ ...detalle, ticket: { ...detalle.ticket, monto: sumItems(nextItems) }, items: nextItems })
  }

  function sumItems(items: Item[]): number {
    return items.reduce((s, item) => s + (Number(item.monto) || 0), 0)
  }

  async function syncTicketTotal(ticketId: string, items: Item[]) {
    const total = sumItems(items)
    await supabase.from('registros_tickets').update({ monto: total }).eq('id', ticketId)
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, monto: total } : t))
  }

  async function ensureProduct(it: Item, opts: { synonymText: string; baseQty: string; baseUnit: string; subQty: string; subUnit: string }) {
    const sucId = detalle?.ticket.sucursal_id ?? null
    let productoId = it.producto_catalogo_id
    const nombre = it.descripcion.trim()
    if (!nombre || !it.categoria_id) return null

    if (!productoId) {
      const { data: ex } = await supabase.from('catalogo_productos').select('id')
        .ilike('nombre', nombre)
        .or(`sucursal_id.is.null,sucursal_id.eq.${sucId ?? '00000000-0000-0000-0000-000000000000'}`)
        .limit(1).maybeSingle()
      if (ex) productoId = ex.id as string
      else {
        const { data: nuevo } = await supabase.from('catalogo_productos').insert({
          nombre,
          sinonimos: [],
          categoria_id: it.categoria_id,
          unidad_default: it.unidad || null,
          sucursal_id: sucId,
        }).select('id').single()
        productoId = nuevo?.id ?? null
      }
    }

    if (productoId) {
      const { data: cur } = await supabase.from('catalogo_productos')
        .select('nombre, sinonimos').eq('id', productoId).single()
      const finalName = (cur?.nombre as string | undefined) ?? nombre
      const original = (originalDesc[it.id] ?? '').trim()
      const manual = opts.synonymText.split(',').map(s => s.trim()).filter(Boolean)
      const merged = new Map<string, string>()
      for (const s of ((cur?.sinonimos as string[] | null) ?? [])) if (s.trim()) merged.set(s.trim().toLowerCase(), s.trim())
      for (const s of [original, ...manual]) {
        const clean = s.trim()
        if (clean && clean.toLowerCase() !== finalName.toLowerCase()) merged.set(clean.toLowerCase(), clean)
      }
      const baseQty = opts.baseQty.trim() === '' ? null : Number(opts.baseQty)
      const baseUnit = opts.baseUnit.trim() || null
      const subQty = opts.subQty.trim() === '' ? null : Number(opts.subQty)
      const subUnit = opts.subUnit.trim() || null
      const updatePayload: Record<string, unknown> = {
        nombre,
        categoria_id: it.categoria_id,
        unidad_default: it.unidad || null,
        sinonimos: [...merged.values()],
      }
      if (Number.isFinite(baseQty as number) && (baseQty as number) > 0 && baseUnit) {
        updatePayload.contiene_cantidad = baseQty
        updatePayload.contiene_unidad = baseUnit
        // Nivel 2 (opcional): cada baseUnit trae subQty subUnit.
        if (Number.isFinite(subQty as number) && (subQty as number) > 0 && subUnit) {
          updatePayload.contiene_sub_cantidad = subQty
          updatePayload.contiene_sub_unidad = subUnit
        } else {
          updatePayload.contiene_sub_cantidad = null
          updatePayload.contiene_sub_unidad = null
        }
      }
      await supabase.from('catalogo_productos').update(updatePayload).eq('id', productoId)
    }
    return productoId
  }

  async function guardarItemTicket(it: Item, form: HTMLFormElement) {
    if (!detalle) return
    setBusy(it.id)
    const fd = new FormData(form)
    const productoId = await ensureProduct(it, {
      synonymText: String(fd.get('sinonimos') ?? ''),
      baseQty: String(fd.get('baseQty') ?? ''),
      baseUnit: String(fd.get('baseUnit') ?? ''),
      subQty: String(fd.get('subQty') ?? ''),
      subUnit: String(fd.get('subUnit') ?? ''),
    })
    const necesita = !it.categoria_id || !it.unidad || !productoId
    const payload = {
      registro_ticket_id: detalle.ticket.id,
      descripcion: it.descripcion.trim() || 'Producto',
      cantidad: it.cantidad,
      unidad: it.unidad || null,
      monto: it.monto,
      categoria_id: it.categoria_id || null,
      producto_catalogo_id: productoId,
      necesita_revision: necesita,
      motivo_revision: necesita ? (!it.categoria_id ? 'sin_categoria' : !it.unidad ? 'sin_unidad' : 'producto_nuevo') : null,
    }
    let savedId = it.id
    if (it.id.startsWith('nuevo-')) {
      const { data, error } = await supabase.from('ticket_items').insert(payload).select('id').single()
      if (error) { toast(error.message, 'error'); setBusy(null); return }
      savedId = data.id as string
    } else {
      const { error } = await supabase.from('ticket_items').update(payload).eq('id', it.id)
      if (error) { toast(error.message, 'error'); setBusy(null); return }
    }
    await supabase.from('alertas_tickets').update({ resuelta: true }).eq('registro_ticket_id', detalle.ticket.id).eq('tipo', 'producto_no_reconocido')
    const nombreCat = cats.find(c => c.id === it.categoria_id)?.nombre ?? null
    const currentItems = detalle.items.map(x => x.id === it.id ? {
        ...x,
        id: savedId,
        descripcion: payload.descripcion,
        cantidad: payload.cantidad,
        unidad: payload.unidad,
        monto: payload.monto,
        categoria_id: payload.categoria_id,
        producto_catalogo_id: productoId,
        necesita_revision: necesita,
        motivo_revision: payload.motivo_revision,
        categorias_gasto: nombreCat ? { nombre: nombreCat } : null,
      } : x)
    await syncTicketTotal(detalle.ticket.id, currentItems)
    setDetalle(d => d ? { ...d, ticket: { ...d.ticket, monto: sumItems(currentItems) }, items: currentItems } : d)
    setOriginalDesc(prev => ({ ...prev, [savedId]: prev[it.id] ?? it.descripcion }))
    setBusy(null)
    // Feedback visible: que SE NOTE que se guardo el renglon.
    setSavedFlash(prev => ({ ...prev, [savedId]: true }))
    setTimeout(() => setSavedFlash(prev => { const n = { ...prev }; delete n[savedId]; return n }), 2500)
  }

  async function actualizarHeader(id: string, campo: 'fecha_ticket' | 'comercio', valor: string) {
    const v = valor || null
    await supabase.from('registros_tickets').update({ [campo]: v }).eq('id', id)
    setDetalle(d => d ? { ...d, ticket: { ...d.ticket, [campo]: v } } : d)
    setTickets(prev => prev.map(x => x.id === id ? { ...x, [campo]: v } as Ticket : x))
  }

  async function confirmarTicket(t: Ticket) {
    setBusy('confirmar')
    const { error } = await supabase.functions.invoke('confirmar-admin', { body: { registro_id: t.id } })
    if (!error) await supabase.from('alertas_tickets').update({ resuelta: true }).eq('registro_ticket_id', t.id).eq('resuelta', false)
    setBusy(null)
    if (error) { toast('No se pudo confirmar: ' + error.message, 'error'); return }
    setDetalle(d => d ? { ...d, ticket: { ...d.ticket, estado: 'confirmado' } } : d)
    setTickets(prev => prev.map(x => x.id === t.id ? { ...x, estado: 'confirmado' } : x))
    setAlertas(prev => ({ ...prev, [t.id]: [] }))
  }

  async function rechazarTicket(t: Ticket) {
    if (!(await confirm('Rechazar este ticket? No entra al arqueo.', { danger: true }))) return
    await supabase.from('registros_tickets').update({ estado: 'rechazado' }).eq('id', t.id)
    await supabase.from('alertas_tickets').update({ resuelta: true }).eq('registro_ticket_id', t.id)
    setDetalle(d => d ? { ...d, ticket: { ...d.ticket, estado: 'rechazado' } } : d)
    setTickets(prev => prev.map(x => x.id === t.id ? { ...x, estado: 'rechazado' } : x))
  }

  async function reintentarIA(t: Ticket) {
    if (!(await confirm('Volver a leer con IA? Se reemplazan los renglones actuales.'))) return
    setBusy('ia')
    const { error } = await supabase.functions.invoke('reprocesar-ticket', { body: { registro_id: t.id } })
    setBusy(null)
    if (error) { toast('No se pudo releer: ' + error.message, 'error'); return }
    await fetchTickets()
    // Trae el ticket FRESCO de la BD (el estado en `tickets` aun no se actualizo en este
    // closure tras setTickets); abrirDetalle ademas re-consulta los renglones.
    const { data: fresh } = await supabase.from('registros_tickets')
      .select('id, comercio, fecha_ticket, monto, estado, created_at, storage_path_original, storage_path_archivo, sucursal_id, sucursales:sucursal_id(nombre), empleados:empleado_id(nombre)')
      .eq('id', t.id).maybeSingle()
    await abrirDetalle((fresh as unknown as Ticket) ?? t)
  }

  async function eliminarTicket(t: Ticket) {
    if (!(await confirm('Eliminar este ticket? Se borran registro, renglones y foto. No se puede deshacer.', { danger: true }))) return
    const pb = pathBucket(t)
    if (pb) await supabase.storage.from(pb.bucket).remove([pb.path])
    const { error } = await supabase.from('registros_tickets').delete().eq('id', t.id)
    if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return }
    setDetalle(null)
    setTickets(prev => prev.filter(x => x.id !== t.id))
  }

  const comerciosUnicos = [...new Set(tickets.map(t => t.comercio).filter((c): c is string => !!c))].sort()
  const baseTickets = comercioFiltro ? tickets.filter(t => (t.comercio ?? '') === comercioFiltro) : tickets
  const tieneAlerta = (t: Ticket) => (alertas[t.id]?.length ?? 0) > 0
  const cuenta = {
    todos: baseTickets.length,
    pendientes: baseTickets.filter(t => t.estado === 'pendiente').length,
    alertas: baseTickets.filter(tieneAlerta).length,
    confirmados: baseTickets.filter(t => t.estado === 'confirmado').length,
  }
  const ticketsFiltrados = baseTickets.filter(t =>
    filtroEstado === 'todos' ? true
    : filtroEstado === 'pendientes' ? t.estado === 'pendiente'
    : filtroEstado === 'alertas' ? tieneAlerta(t)
    : t.estado === 'confirmado'
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Tickets</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{nombreSucursal} · revision completa por ticket</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde"><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" /></Field>
        <Field label="Hasta"><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100" /></Field>
        <Field label="Comercio">
          <select value={comercioFiltro} onChange={e => setComercioFiltro(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 max-w-[220px]">
            <option value="">Todos</option>
            {comerciosUnicos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { k: 'todos', label: 'Todos', n: cuenta.todos, color: 'bg-zinc-700 text-zinc-100' },
          { k: 'pendientes', label: 'Pendientes', n: cuenta.pendientes, color: 'bg-amber-600 text-white' },
          { k: 'alertas', label: 'Con alerta', n: cuenta.alertas, color: 'bg-orange-600 text-white' },
          { k: 'confirmados', label: 'Confirmados', n: cuenta.confirmados, color: 'bg-emerald-700 text-white' },
        ] as const).map(c => (
          <button key={c.k} onClick={() => setFiltroEstado(c.k)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${filtroEstado === c.k ? c.color : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
            {c.label}
            <span className={`text-xs rounded-full px-1.5 ${filtroEstado === c.k ? 'bg-black/20' : 'bg-zinc-800'}`}>{c.n}</span>
          </button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-xl bg-red-950/40 border border-red-800/50 px-4 py-3 text-sm text-red-300">
          No se pudieron cargar los tickets: {loadError}
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
      ) : ticketsFiltrados.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No hay tickets en este periodo</p>
      ) : (
        <div className="space-y-2">
          {ticketsFiltrados.map(t => {
            const url = urlDe(t)
            const badges = ticketBadges(t)
            return (
              <button key={t.id} onClick={() => abrirDetalle(t)}
                className="w-full flex items-center gap-4 rounded-xl bg-zinc-900 p-3 hover:bg-zinc-800/80 transition-colors text-left">
                <div className="group relative h-14 w-14 rounded-lg bg-zinc-800 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover rounded-lg" />}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" loading="lazy" decoding="async" className="hidden md:group-hover:block absolute left-[60px] top-0 z-50 w-72 max-h-96 object-contain rounded-lg border border-zinc-600 shadow-2xl bg-zinc-950 pointer-events-none" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-zinc-100 truncate">{t.comercio ?? 'Sin comercio'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_COLOR[t.estado] ?? 'bg-zinc-800 text-zinc-400'}`}>{t.estado}</span>
                    {badges.map(b => <span key={b} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300">{b}</span>)}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{t.sucursales?.nombre ?? 'Sin sucursal'} · {t.empleados?.nombre ?? ''} · {t.fecha_ticket ?? 'Sin fecha'}</p>
                </div>
                <span className="text-sm text-zinc-300 whitespace-nowrap">{fmt(t.monto)}</span>
              </button>
            )
          })}
        </div>
      )}

      {detalle && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/60 p-0 lg:p-4" onClick={() => setDetalle(null)}>
          <div className="w-full lg:max-w-6xl rounded-t-2xl lg:rounded-2xl bg-zinc-900 border border-zinc-800 p-5 max-h-[94dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <datalist id="unidades-tickets">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">{detalle.ticket.comercio ?? 'Ticket'}</h3>
                <p className="text-xs text-zinc-500">{detalle.ticket.sucursales?.nombre ?? 'Sin sucursal'} · subido por {detalle.ticket.empleados?.nombre ?? 'Desconocido'}</p>
                <div className="flex gap-1 flex-wrap mt-2">{ticketBadges(detalle.ticket).map(b => <span key={b} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300">{b}</span>)}</div>
              </div>
              <button onClick={() => setDetalle(null)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">x</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 mt-4">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Comercio"><input defaultValue={detalle.ticket.comercio ?? ''} onBlur={e => actualizarHeader(detalle.ticket.id, 'comercio', e.target.value)} className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" /></Field>
                  <Field label="Fecha"><input type="date" defaultValue={detalle.ticket.fecha_ticket ?? ''} onBlur={e => actualizarHeader(detalle.ticket.id, 'fecha_ticket', e.target.value)} className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" /></Field>
                </div>
                {detalle.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detalle.url} alt="Ticket" decoding="async" className="w-full max-h-[64vh] object-contain rounded-xl bg-zinc-950" />
                ) : <div className="h-64 rounded-xl bg-zinc-950 flex items-center justify-center text-zinc-600">Sin imagen</div>}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => reintentarIA(detalle.ticket)} disabled={busy === 'ia'} className="rounded-xl bg-blue-600/80 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy === 'ia' ? 'Leyendo...' : 'Volver a leer IA'}</button>
                  <button onClick={() => rechazarTicket(detalle.ticket)} className="rounded-xl bg-zinc-800 py-2.5 text-sm font-medium text-red-400">Rechazar</button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Renglones ({detalle.items.length})</p>
                  <div className="flex gap-2">
                    <button onClick={agregarRenglon} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100">+ Renglon</button>
                    <button onClick={() => setEditando(v => !v)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-blue-300">{editando ? 'Vista simple' : 'Editar'}</button>
                  </div>
                </div>

                <div className="space-y-2">
                  {detalle.items.length === 0 && <p className="rounded-xl bg-zinc-800/40 px-3 py-4 text-sm text-zinc-500">Sin renglones. Agrega los productos manualmente o vuelve a leer con IA.</p>}
                  {detalle.items.map(it => editando ? (
                    <form key={it.id} onSubmit={e => { e.preventDefault(); guardarItemTicket(it, e.currentTarget) }} className={`rounded-xl border p-3 space-y-2 ${it.necesita_revision ? 'border-amber-800/50 bg-amber-950/10' : 'border-zinc-800 bg-zinc-900'}`}>
                      <div className="flex gap-2">
                        <input value={it.descripcion} onChange={e => setItemField(it.id, 'descripcion', e.target.value)} placeholder="Producto correcto" className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                        <button type="button" onClick={() => borrarRenglon(it)} className="rounded-lg bg-zinc-800 px-3 text-xs text-red-400">Borrar</button>
                      </div>
                      {originalDesc[it.id] && originalDesc[it.id] !== it.descripcion && <p className="text-[11px] text-zinc-500">Leido originalmente: {originalDesc[it.id]}</p>}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <input type="number" inputMode="decimal" value={it.cantidad ?? ''} onChange={e => setItemField(it.id, 'cantidad', e.target.value)} placeholder="cantidad" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                        <input list="unidades-tickets" value={it.unidad ?? ''} onChange={e => setItemField(it.id, 'unidad', e.target.value)} placeholder="Unidad (cono, caja, pz...)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                        <input type="number" inputMode="decimal" value={it.monto ?? ''} onChange={e => setItemField(it.id, 'monto', e.target.value)} placeholder="precio" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" />
                        <select value={it.categoria_id ?? ''} onChange={e => setItemField(it.id, 'categoria_id', e.target.value)} className="md:col-span-2 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                          <option value="">Categoria</option>{cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </div>
                      <select value={it.producto_catalogo_id ?? ''} onChange={e => vincularProducto(it, e.target.value)} className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100">
                        <option value="">Crear/ligar por nombre al guardar</option>{catalogo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <input name="sinonimos" placeholder="Sinonimos/codigos adicionales separados por coma" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                      {it.unidad && !BASE_UNIDADES.has(it.unidad) && (() => {
                        const linked = catalogo.find(p => p.id === it.producto_catalogo_id)
                        return (
                          <div className="rounded-lg bg-zinc-800/40 p-2 space-y-1.5">
                            <p className="text-[11px] text-zinc-400">¿Esta presentación trae varias piezas? <span className="text-zinc-200">1 {it.unidad} = </span></p>
                            <div className="grid grid-cols-2 gap-2">
                              <input key={`bq-${it.producto_catalogo_id ?? 'new'}`} name="baseQty" type="number" inputMode="decimal" defaultValue={linked?.contiene_cantidad ?? ''} placeholder="cuántas (ej. 24)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                              <input key={`bu-${it.producto_catalogo_id ?? 'new'}`} list="unidades-tickets" name="baseUnit" defaultValue={linked?.contiene_unidad ?? ''} placeholder="de qué (ej. pz, huevo)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                            </div>
                            <p className="text-[11px] text-zinc-500">Y opcional: cada pieza trae… (ej. cada media crema = 355 ml)</p>
                            <div className="grid grid-cols-2 gap-2">
                              <input key={`sq-${it.producto_catalogo_id ?? 'new'}`} name="subQty" type="number" inputMode="decimal" defaultValue={linked?.contiene_sub_cantidad ?? ''} placeholder="cuánto c/u (ej. 355)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                              <input key={`su-${it.producto_catalogo_id ?? 'new'}`} list="unidades-tickets" name="subUnit" defaultValue={linked?.contiene_sub_unidad ?? ''} placeholder="de qué (ej. ml)" className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600" />
                            </div>
                            {linked?.contiene_cantidad && linked?.contiene_unidad && (
                              <p className="text-[11px] text-emerald-500/80">Guardado: 1 {it.unidad} = {linked.contiene_cantidad} {linked.contiene_unidad}{linked.contiene_sub_cantidad && linked.contiene_sub_unidad ? ` = ${(Number(linked.contiene_cantidad) * Number(linked.contiene_sub_cantidad)).toLocaleString('es-MX')} ${linked.contiene_sub_unidad}` : ''}</p>
                            )}
                          </div>
                        )
                      })()}
                      <div className="flex items-center gap-2">
                        <button type="submit" disabled={busy === it.id} className={`flex-1 rounded-lg py-2 text-sm font-medium text-zinc-100 disabled:opacity-60 transition-colors ${savedFlash[it.id] ? 'bg-emerald-700' : 'bg-zinc-700 hover:bg-zinc-600'}`}>{busy === it.id ? 'Guardando...' : savedFlash[it.id] ? '✓ Guardado' : 'Guardar y ensenar'}</button>
                        {savedFlash[it.id] && <span className="text-sm text-emerald-400 font-medium whitespace-nowrap">✓ Guardado</span>}
                      </div>
                    </form>
                  ) : (
                    <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-800/50 px-3 py-2 text-sm">
                      <div className="min-w-0"><p className="text-zinc-100 truncate">{it.descripcion}</p><p className="text-xs text-zinc-500">{it.cantidad ?? ''} {it.unidad ?? ''} · {it.categorias_gasto?.nombre ?? 'sin categoria'}</p></div>
                      <span className="text-zinc-300 whitespace-nowrap">{fmt(it.monto)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between text-sm border-t border-zinc-800 pt-3">
                  <span className="text-zinc-500">Total ticket</span>
                  <span className="text-zinc-100 font-semibold">{fmt(detalle.ticket.monto)}</span>
                </div>
                {detalle.ticket.estado !== 'confirmado' && (
                  <button onClick={() => confirmarTicket(detalle.ticket)} disabled={busy === 'confirmar'} className="w-full rounded-xl bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-60">{busy === 'confirmar' ? 'Confirmando...' : 'Confirmar ticket'}</button>
                )}
                <button onClick={() => eliminarTicket(detalle.ticket)} className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-medium text-red-400">Eliminar ticket</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="text-xs text-zinc-500 block mb-1">{label}</span>{children}</label>
}
