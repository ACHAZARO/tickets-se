'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { useToast, useConfirm } from './ui'

// Unificar productos del catalogo que son el mismo insumo (migraciones 070-072).
//  - La base detecta posibles duplicados (RPC sugerir_unificaciones) y esta pantalla los PREGUNTA: nunca se une nada solo.
//  - Unificar = los renglones, precios e inventario del producto absorbido pasan al que se queda; este aprende el nombre
//    del absorbido como sinonimo. Queda respaldo en respaldo.unificaciones_productos.
//  - "No son iguales" se recuerda (unificaciones_descartadas) y no se vuelve a preguntar.

export const EVENTO_UNIFICACIONES = 'unificaciones-cambio'

export interface ProdSug { id: string; nombre: string; unidad: string | null; usos: number; gasto: number }
export interface Sugerencia {
  motivo: 'sinonimo' | 'igual' | 'parecido'
  gasto_total: number
  categoria_id: string
  sucursal_id: string | null
  a: ProdSug
  b: ProdSug
}

const avisarCambio = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_UNIFICACIONES)) }

/** Une `origen` DENTRO de `destino`. `origen` desaparece del catalogo (con respaldo). */
export async function unificarProductos(origenId: string, destinoId: string): Promise<{ ok: true; renglones: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_unificar_productos', { p_origen: origenId, p_destino: destinoId })
  if (error) return { ok: false, error: error.message }
  avisarCambio()
  return { ok: true, renglones: Number((data as { renglones?: number } | null)?.renglones ?? 0) }
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
}
const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 })

/** Circulito con el numero de duplicados muy probables, junto a "Cerebro" en la barra. */
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
    setN(sug.filter(s => s.motivo !== 'parecido').length)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar, pathname])
  useEffect(() => {
    window.addEventListener(EVENTO_UNIFICACIONES, cargar)
    return () => window.removeEventListener(EVENTO_UNIFICACIONES, cargar)
  }, [cargar])
  if (!n) return null
  return (
    <span title={`${n} posibles duplicados en el catalogo`}
      className="ml-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white">{n}</span>
  )
}

/** Panel de Cerebro: posibles duplicados con la pregunta "¿unificar?". No se muestra si no hay nada que preguntar. */
export function PanelDuplicados({ categorias, onCambio }: { categorias: { id: string; nombre: string }[]; onCambio: () => void }) {
  const { sucursalId, sucursales } = useSucursal()
  const toast = useToast()
  const confirm = useConfirm()
  const [sug, setSug] = useState<Sugerencia[] | null>(null)
  const [verQuiza, setVerQuiza] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const seq = useRef(0)
  const cargar = useCallback(async () => {
    const mio = ++seq.current
    const r = await pedirSugerencias(sucursalId)
    if (mio === seq.current) setSug(r)
  }, [sucursalId])
  useEffect(() => { cargar() }, [cargar])

  if (!sug || sug.length === 0) return null
  const fuertes = sug.filter(s => s.motivo !== 'parecido')
  const quiza = sug.filter(s => s.motivo === 'parecido')

  const clave = (s: Sugerencia) => s.a.id + s.b.id
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
    await cargar()
    onCambio()
  }
  async function noSonIguales(s: Sugerencia) {
    setBusy(clave(s))
    const err = await descartarUnificacion(s.a.id, s.b.id)
    setBusy(null)
    if (err) { toast('No se pudo guardar: ' + err, 'error'); return }
    await cargar()
  }

  const tarjeta = (s: Sugerencia) => {
    // El que se queda por defecto: el mas usado (resalta ese boton).
    const aGana = s.a.usos >= s.b.usos
    const btn = (destino: ProdSug, origen: ProdSug, principal: boolean) => (
      <button key={destino.id} type="button" disabled={busy === clave(s)} onClick={() => unir(s, origen, destino)}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${principal ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`}>
        Unificar en &quot;{destino.nombre}&quot;
      </button>
    )
    const prod = (p: ProdSug) => (
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100 truncate" title={p.nombre}>{p.nombre}</p>
        <p className="text-[11px] text-zinc-500">{p.unidad ?? 'sin unidad'} · {p.usos} {p.usos === 1 ? 'compra' : 'compras'} · {fmt(p.gasto)}</p>
      </div>
    )
    return (
      <div key={clave(s)} className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">{prod(s.a)}<span className="hidden sm:block text-zinc-600 self-center">=?</span>{prod(s.b)}</div>
        <p className="text-[11px] text-zinc-500">{MOTIVO_TEXTO[s.motivo]} · {nombreCat(s.categoria_id)} · {nombreSuc(s.sucursal_id)}</p>
        <div className="flex flex-wrap gap-2">
          {btn(s.a, s.b, aGana)}
          {btn(s.b, s.a, !aGana)}
          <button type="button" disabled={busy === clave(s)} onClick={() => noSonIguales(s)}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50">No son iguales</button>
        </div>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-amber-800/40 bg-amber-950/10 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-amber-200">Posibles duplicados en el catalogo ({fuertes.length}{quiza.length ? ` + ${quiza.length} menos seguros` : ''})</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
          Parecen el mismo insumo con dos nombres. Si los unificas, sus compras se suman en uno solo y la IA sigue reconociendo los dos nombres.
          Nunca se une nada sin tu respuesta; &quot;No son iguales&quot; no se vuelve a preguntar.
        </p>
      </div>
      {fuertes.length > 0 && <div className="space-y-2">{fuertes.map(tarjeta)}</div>}
      {quiza.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setVerQuiza(v => !v)} className="text-xs text-zinc-400 hover:text-zinc-200">
            {verQuiza ? 'Ocultar' : 'Ver'} los {quiza.length} menos seguros
          </button>
          {verQuiza && quiza.map(tarjeta)}
        </div>
      )}
    </section>
  )
}
