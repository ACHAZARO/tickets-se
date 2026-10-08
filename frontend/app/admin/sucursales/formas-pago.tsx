'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useToast } from '../ui'

// Formas de pago de CADA negocio (tabla formas_pago, migracion 085): los botones "¿Como se pago?" que ve el gerente al
// subir un ticket. No se borran (los tickets viejos las usan): se apagan. sale_de_caja = se paga con el efectivo de la
// caja del local; asi la API separa lo pagado con Caja de lo pagado por otros medios.
// Con varios negocios, cada uno tiene su lista y su renglon para agregar (antes todo caia en la cuenta principal).
interface Forma { id: string; cuenta_id: string; nombre: string; sale_de_caja: boolean; activa: boolean; orden: number }
interface Cuenta { id: string; nombre: string }
const NUEVA_VACIA = { nombre: '', sale_de_caja: false }

export default function FormasPago() {
  const toast = useToast()
  const [formas, setFormas] = useState<Forma[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [cargando, setCargando] = useState(true)
  const [nueva, setNueva] = useState<Record<string, { nombre: string; sale_de_caja: boolean }>>({})
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)

  const cargar = useCallback(async () => {
    const [fRes, cRes] = await Promise.all([
      supabase.from('formas_pago').select('id, cuenta_id, nombre, sale_de_caja, activa, orden').order('orden').order('nombre'),
      supabase.from('cuentas').select('id, nombre').order('created_at'),
    ])
    if (fRes.error) toast('No se pudieron cargar las formas de pago: ' + fRes.error.message, 'error')
    setFormas((fRes.data ?? []) as Forma[])
    setCuentas((cRes.data ?? []) as Cuenta[])
    setCargando(false)
  }, [toast])

  useEffect(() => { cargar() }, [cargar])

  async function agregar(cuentaId: string) {
    const n = nueva[cuentaId] ?? NUEVA_VACIA
    const nombre = n.nombre.trim()
    if (!nombre) return
    const deLaCuenta = formas.filter(f => f.cuenta_id === cuentaId)
    if (deLaCuenta.some(f => f.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      toast('Ya existe una forma con ese nombre', 'error'); return
    }
    await ensureFreshSession()
    const orden = deLaCuenta.reduce((m, f) => Math.max(m, f.orden), 0) + 1
    const { data, error } = await supabase.from('formas_pago')
      .insert({ cuenta_id: cuentaId, nombre, sale_de_caja: n.sale_de_caja, orden })
      .select('id, cuenta_id, nombre, sale_de_caja, activa, orden').single()
    if (error || !data) { toast('No se pudo agregar: ' + (error?.message ?? ''), 'error'); return }
    setFormas(prev => [...prev, data as Forma])
    setNueva(prev => ({ ...prev, [cuentaId]: NUEVA_VACIA }))
  }

  async function cambiar(f: Forma, cambios: Partial<Pick<Forma, 'nombre' | 'sale_de_caja' | 'activa'>>) {
    await ensureFreshSession()
    const { error } = await supabase.from('formas_pago').update(cambios).eq('id', f.id)
    if (error) {
      toast(error.code === '23505' ? 'Ya existe una forma con ese nombre' : 'No se pudo guardar: ' + error.message, 'error')
      return false
    }
    setFormas(prev => prev.map(x => (x.id === f.id ? { ...x, ...cambios } : x)))
    return true
  }

  async function guardarNombre() {
    if (!editando) return
    const f = formas.find(x => x.id === editando.id)
    const nombre = editando.nombre.trim()
    if (!f || !nombre || nombre === f.nombre) { setEditando(null); return }
    if (await cambiar(f, { nombre })) setEditando(null)
  }

  if (cargando) return null

  return (
    <section className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Formas de pago</h2>
        <p className="nota">
          Opciones de &quot;¿Cómo se pagó?&quot; al subir un ticket. Una forma ya usada no se borra: se apaga.
        </p>
        <p className="nota">
          Marca «Se paga con dinero de la caja» solo en las que usan el efectivo de la caja del local (normalmente solo
          Efectivo). Así sabes cuánto salió de la caja en cada corte.
        </p>
      </div>
      {cuentas.map(c => {
        const deLaCuenta = formas.filter(f => f.cuenta_id === c.id)
        const n = nueva[c.id] ?? NUEVA_VACIA
        return (
          <div key={c.id} className="space-y-2">
            {cuentas.length > 1 && <h3 className="text-base font-semibold text-zinc-100">{c.nombre}</h3>}
            <div className="tarjeta divide-y divide-zinc-800">
              {deLaCuenta.length === 0 && <p className="p-4 text-sm text-zinc-500">Sin formas de pago: los gerentes suben sin elegir (queda &quot;No registrado&quot;).</p>}
              {deLaCuenta.map(f => (
                <div key={f.id} className={`flex flex-wrap items-center gap-3 p-3 ${f.activa ? '' : 'opacity-50'}`}>
                  {editando?.id === f.id ? (
                    <input
                      autoFocus
                      value={editando.nombre}
                      maxLength={40}
                      onChange={e => setEditando({ id: f.id, nombre: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') guardarNombre(); if (e.key === 'Escape') setEditando(null) }}
                      onBlur={guardarNombre}
                      className="campo min-w-0 flex-1 py-1.5"
                    />
                  ) : (
                    <button onClick={() => setEditando({ id: f.id, nombre: f.nombre })} className="min-w-0 flex-1 text-left text-sm text-zinc-100" title="Cambiar nombre">
                      {f.nombre}{!f.activa && <span className="ml-2 text-xs text-zinc-500">(apagada)</span>}
                    </button>
                  )}
                  <label className={`flex items-center gap-1.5 text-[13px] ${f.sale_de_caja ? 'text-emerald-300' : 'text-zinc-500'}`}>
                    <input type="checkbox" className="accent-emerald-500" checked={f.sale_de_caja} onChange={e => cambiar(f, { sale_de_caja: e.target.checked })} />
                    Se paga con dinero de la caja
                  </label>
                  <button onClick={() => cambiar(f, { activa: !f.activa })} className={`${f.activa ? 'btn-quieto' : 'btn-secundario'} btn-sm`}>
                    {f.activa ? 'Apagar' : 'Prender'}
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 p-3">
                <input
                  value={n.nombre}
                  maxLength={40}
                  placeholder="Nueva forma (ej. Tarjeta BBVA empresa)"
                  onChange={e => setNueva(prev => ({ ...prev, [c.id]: { ...n, nombre: e.target.value } }))}
                  onKeyDown={e => { if (e.key === 'Enter') agregar(c.id) }}
                  className="campo min-w-0 flex-1 py-1.5"
                />
                <label className={`flex items-center gap-1.5 text-[13px] ${n.sale_de_caja ? 'text-emerald-300' : 'text-zinc-500'}`}>
                  <input type="checkbox" className="accent-emerald-500" checked={n.sale_de_caja} onChange={e => setNueva(prev => ({ ...prev, [c.id]: { ...n, sale_de_caja: e.target.checked } }))} />
                  Se paga con dinero de la caja
                </label>
                <button onClick={() => agregar(c.id)} disabled={!n.nombre.trim()} className="btn-secundario btn-sm">+ Agregar</button>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
