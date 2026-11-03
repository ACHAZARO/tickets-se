'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

export interface Sucursal { id: string; nombre: string }

interface Ctx {
  sucursalId: string // '' = todas
  setSucursalId: (id: string) => void
  sucursales: Sucursal[]
  loading: boolean
}

const SucursalContext = createContext<Ctx>({
  sucursalId: '', setSucursalId: () => {}, sucursales: [], loading: true,
})

export function useSucursal() {
  return useContext(SucursalContext)
}

const STORAGE_KEY = 'admin_sucursal_id'

export function SucursalProvider({ children }: { children: ReactNode }) {
  const [sucursalId, setSucursalIdState] = useState('')
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (saved) setSucursalIdState(saved)
    supabase.from('sucursales').select('id, nombre').eq('activa', true).order('nombre')
      .then(({ data }) => {
        const list = data ?? []
        setSucursales(list)
        // si la sucursal guardada ya no existe, vuelve a "todas"
        if (saved && !list.some(s => s.id === saved)) {
          setSucursalIdState('')
          window.localStorage.removeItem(STORAGE_KEY)
        }
        setLoading(false)
      })
  }, [])

  function setSucursalId(id: string) {
    setSucursalIdState(id)
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    }
  }

  return (
    <SucursalContext.Provider value={{ sucursalId, setSucursalId, sucursales, loading }}>
      {children}
    </SucursalContext.Provider>
  )
}

interface CuentaLista { id: string; nombre: string; es_prueba: boolean; estado: string; activa: boolean }

/** Quien administra varios negocios trabaja sobre UNO a la vez. Con uno solo no se muestra. */
export function CuentaSelector() {
  const [cuentas, setCuentas] = useState<CuentaLista[]>([])
  useEffect(() => {
    supabase.rpc('mis_cuentas_lista').then(({ data }) => setCuentas((data as CuentaLista[] | null) ?? []))
  }, [])
  if (cuentas.length <= 1) return null
  async function elegir(id: string) {
    const { error } = await supabase.rpc('elegir_cuenta', { p_cuenta: id })
    if (error) return
    window.localStorage.removeItem(STORAGE_KEY)
    window.location.reload()
  }
  return (
    <select value={cuentas.find(c => c.activa)?.id ?? ''} onChange={e => elegir(e.target.value)} title="Negocio que estás viendo" aria-label="Negocio"
      className="h-9 max-w-[170px] rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-[13px] font-medium text-zinc-100 hover:border-zinc-600">
      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.es_prueba ? ' (prueba)' : ''}</option>)}
    </select>
  )
}

/** Selector compacto para el header del admin. Con una sola sucursal no hay nada que elegir. */
export function SucursalSelector() {
  const { sucursalId, setSucursalId, sucursales } = useSucursal()
  if (sucursales.length <= 1) return null
  return (
    <select
      value={sucursalId}
      onChange={e => setSucursalId(e.target.value)}
      className="h-9 rounded-lg bg-zinc-900 border border-zinc-700 px-2.5 text-[13px] font-medium text-zinc-100 max-w-[170px] hover:border-zinc-600"
      title="Sucursal activa"
    >
      <option value="">Todas las sucursales</option>
      {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
    </select>
  )
}
