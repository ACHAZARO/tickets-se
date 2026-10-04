'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useToast } from '../ui'

// Formas de pago del negocio (tabla formas_pago, migracion 085): los botones "¿Como se pago?" que ve el gerente al
// subir un ticket. No se borran (los tickets viejos las usan): se apagan. "Sale de la Caja" = el dinero sale de la
// caja de la sucursal; asi la API separa lo pagado con Caja de lo pagado por otros medios.
interface Forma { id: string; cuenta_id: string; nombre: string; sale_de_caja: boolean; activa: boolean; orden: number }

export default function FormasPago() {
  const toast = useToast()
  const [formas, setFormas] = useState<Forma[]>([])
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [nueva, setNueva] = useState({ nombre: '', sale_de_caja: false })
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)

  const cargar = useCallback(async () => {
    const [fRes, sRes] = await Promise.all([
      supabase.from('formas_pago').select('id, cuenta_id, nombre, sale_de_caja, activa, orden').order('orden').order('nombre'),
      supabase.from('sucursales').select('cuenta_id').eq('es_prueba', false).limit(1),
    ])
    if (fRes.error) toast('No se pudieron cargar las formas de pago: ' + fRes.error.message, 'error')
    setFormas((fRes.data ?? []) as Forma[])
    // Las formas son del negocio (cuenta): se toma la cuenta de las sucursales.
    setCuentaId((sRes.data?.[0]?.cuenta_id as string | undefined) ?? (fRes.data?.[0]?.cuenta_id as string | undefined) ?? null)
    setCargando(false)
  }, [toast])

  useEffect(() => { cargar() }, [cargar])

  async function agregar() {
    const nombre = nueva.nombre.trim()
    if (!nombre || !cuentaId) return
    if (formas.some(f => f.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      toast('Ya existe una forma con ese nombre', 'error'); return
    }
    await ensureFreshSession()
    const orden = formas.reduce((m, f) => Math.max(m, f.orden), 0) + 1
    const { data, error } = await supabase.from('formas_pago')
      .insert({ cuenta_id: cuentaId, nombre, sale_de_caja: nueva.sale_de_caja, orden })
      .select('id, cuenta_id, nombre, sale_de_caja, activa, orden').single()
    if (error || !data) { toast('No se pudo agregar: ' + (error?.message ?? ''), 'error'); return }
    setFormas(prev => [...prev, data as Forma])
    setNueva({ nombre: '', sale_de_caja: false })
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
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Formas de pago</h2>
        <p className="nota mt-1">
          Opciones de &quot;¿Cómo se pagó?&quot; al subir un ticket. Una forma ya usada no se borra: se apaga.
        </p>
      </div>
      <div className="tarjeta divide-y divide-zinc-800">
        {formas.length === 0 && <p className="p-4 text-sm text-zinc-500">Sin formas de pago: los gerentes suben sin elegir (queda &quot;No registrado&quot;).</p>}
        {formas.map(f => (
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
            <label className="flex items-center gap-1.5 text-[13px] text-zinc-400">
              <input type="checkbox" className="accent-emerald-500" checked={f.sale_de_caja} onChange={e => cambiar(f, { sale_de_caja: e.target.checked })} />
              Sale de la Caja
            </label>
            <button onClick={() => cambiar(f, { activa: !f.activa })} className={`${f.activa ? 'btn-peligro' : 'btn-secundario'} btn-sm`}>
              {f.activa ? 'Apagar' : 'Prender'}
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={nueva.nombre}
            maxLength={40}
            placeholder="Nueva forma (ej. Tarjeta BBVA empresa)"
            onChange={e => setNueva(n => ({ ...n, nombre: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') agregar() }}
            className="campo min-w-0 flex-1 py-1.5"
          />
          <label className="flex items-center gap-1.5 text-[13px] text-zinc-400">
            <input type="checkbox" className="accent-emerald-500" checked={nueva.sale_de_caja} onChange={e => setNueva(n => ({ ...n, sale_de_caja: e.target.checked }))} />
            Sale de la Caja
          </label>
          <button
            onClick={agregar}
            disabled={!nueva.nombre.trim() || !cuentaId}
            className="btn-primario btn-sm"
          >+ Agregar</button>
        </div>
      </div>
    </section>
  )
}
