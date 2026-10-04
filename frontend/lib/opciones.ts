'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Opciones de CADA negocio (tabla cuenta_opciones, migracion 088). Regla multi-negocio: estos ajustes viven en
// la base, nunca en el codigo. Una cuenta sin fila = todo apagado.
export interface OpcionesCuenta {
  cuenta_id: string
  nombre: string
  usa_stock: boolean
  gerente_conteo: boolean
}

/** Cuentas que el admin ve (por sus sucursales) con sus opciones. */
export function useOpciones() {
  const [cuentas, setCuentas] = useState<OpcionesCuenta[] | null>(null)
  // cuenta de cada sucursal, para saber que opciones aplican a la sucursal elegida
  const [cuentaDeSucursal, setCuentaDeSucursal] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    const [{ data: sucs }, { data: cts }, { data: ops }] = await Promise.all([
      supabase.from('sucursales').select('id, cuenta_id'),
      supabase.from('cuentas').select('id, nombre').order('nombre'),
      supabase.from('cuenta_opciones').select('cuenta_id, usa_stock, gerente_conteo'),
    ])
    const mapa: Record<string, string> = {}
    for (const s of (sucs as { id: string; cuenta_id: string | null }[] | null) ?? []) if (s.cuenta_id) mapa[s.id] = s.cuenta_id
    setCuentaDeSucursal(mapa)
    const porCuenta = new Map(((ops as Omit<OpcionesCuenta, 'nombre'>[] | null) ?? []).map(o => [o.cuenta_id, o]))
    setCuentas(((cts as { id: string; nombre: string }[] | null) ?? []).map(c => ({
      cuenta_id: c.id, nombre: c.nombre,
      usa_stock: porCuenta.get(c.id)?.usa_stock ?? false,
      gerente_conteo: porCuenta.get(c.id)?.gerente_conteo ?? false,
    })))
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function guardar(cuentaId: string, cambios: Partial<Pick<OpcionesCuenta, 'usa_stock' | 'gerente_conteo'>>) {
    const actual = cuentas?.find(c => c.cuenta_id === cuentaId)
    if (!actual) return 'Cuenta no encontrada'
    const nuevo = { ...actual, ...cambios }
    // Sin Stock no tiene sentido que el gerente cuente.
    if (!nuevo.usa_stock) nuevo.gerente_conteo = false
    const { error } = await supabase.from('cuenta_opciones').upsert({
      cuenta_id: cuentaId, usa_stock: nuevo.usa_stock, gerente_conteo: nuevo.gerente_conteo, updated_at: new Date().toISOString(),
    })
    if (error) return error.message
    setCuentas(cs => cs?.map(c => c.cuenta_id === cuentaId ? nuevo : c) ?? cs)
    return null
  }

  /** Opciones que aplican a una sucursal (o a "Todas": la primera cuenta que tenga Stock). */
  function deSucursal(sucursalId: string): OpcionesCuenta | null {
    if (!cuentas) return null
    if (sucursalId) return cuentas.find(c => c.cuenta_id === cuentaDeSucursal[sucursalId]) ?? null
    return cuentas.find(c => c.usa_stock) ?? cuentas[0] ?? null
  }

  return { cuentas, guardar, deSucursal, recargar: cargar }
}
