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
  // Articulos no autorizados (migracion 094): a donde va lo aprobado y si el gerente ve lo que no se aprobo.
  categoria_extra_id: string | null
  avisar_gerente_no_autorizado: boolean
  // El gerente paga con su tarjeta y toma el efectivo de la caja (migracion 115): ese papel ya no se pregunta.
  tarjeta_repone_caja: boolean
  // Modo entrenamiento (migracion 098, PLAN_MODO_ENTRENAMIENTO.md): la IA acepta lo que sube el admin y aprende.
  entrenamiento: boolean
  entrenamiento_desde: string | null
  bienvenida_vista: boolean
  giro: string | null
  entrenamiento_pasos: PasosEntrenamiento
}

/** Pasos del entrenamiento que se palomean a mano (los demas se revisan en la base). */
export interface PasosEntrenamiento { articulos?: 'A' | 'B'; tickets?: boolean; cerebro?: boolean; pin_admin?: string }

type Editables = Omit<OpcionesCuenta, 'cuenta_id' | 'nombre'>
// Avisa a las demas pantallas abiertas (menu, franja de entrenamiento) que una opcion cambio.
const EVENTO = 'opciones-cuenta-cambiaron'

/** Cuentas que el admin ve (por sus sucursales) con sus opciones. */
export function useOpciones() {
  const [cuentas, setCuentas] = useState<OpcionesCuenta[] | null>(null)
  // cuenta de cada sucursal, para saber que opciones aplican a la sucursal elegida
  const [cuentaDeSucursal, setCuentaDeSucursal] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    const [{ data: sucs }, { data: cts }, { data: ops, error: errOps }] = await Promise.all([
      supabase.from('sucursales').select('id, cuenta_id'),
      supabase.from('cuentas').select('id, nombre').order('nombre'),
      supabase.from('cuenta_opciones').select('cuenta_id, usa_stock, gerente_conteo, categoria_extra_id, avisar_gerente_no_autorizado, tarjeta_repone_caja, entrenamiento, entrenamiento_desde, bienvenida_vista, giro, entrenamiento_pasos'),
    ])
    const mapa: Record<string, string> = {}
    for (const s of (sucs as { id: string; cuenta_id: string | null }[] | null) ?? []) if (s.cuenta_id) mapa[s.id] = s.cuenta_id
    setCuentaDeSucursal(mapa)
    const porCuenta = new Map(((ops as Omit<OpcionesCuenta, 'nombre'>[] | null) ?? []).map(o => [o.cuenta_id, o]))
    setCuentas(((cts as { id: string; nombre: string }[] | null) ?? []).map(c => ({
      cuenta_id: c.id, nombre: c.nombre,
      usa_stock: porCuenta.get(c.id)?.usa_stock ?? false,
      gerente_conteo: porCuenta.get(c.id)?.gerente_conteo ?? false,
      categoria_extra_id: porCuenta.get(c.id)?.categoria_extra_id ?? null,
      avisar_gerente_no_autorizado: porCuenta.get(c.id)?.avisar_gerente_no_autorizado ?? false,
      tarjeta_repone_caja: porCuenta.get(c.id)?.tarjeta_repone_caja ?? false,
      entrenamiento: porCuenta.get(c.id)?.entrenamiento ?? false,
      entrenamiento_desde: porCuenta.get(c.id)?.entrenamiento_desde ?? null,
      // Cuenta sin fila = negocio nuevo: aun no se le pregunta por la configuracion.
      // Si no se pudieron leer las opciones NO se pregunta (seria preguntarle a un negocio que ya esta configurado).
      bienvenida_vista: errOps ? true : porCuenta.get(c.id)?.bienvenida_vista ?? false,
      giro: porCuenta.get(c.id)?.giro ?? null,
      entrenamiento_pasos: porCuenta.get(c.id)?.entrenamiento_pasos ?? {},
    })))
  }, [])
  useEffect(() => {
    cargar()
    window.addEventListener(EVENTO, cargar)
    return () => window.removeEventListener(EVENTO, cargar)
  }, [cargar])

  async function guardar(cuentaId: string, cambios: Partial<Editables>) {
    const actual = cuentas?.find(c => c.cuenta_id === cuentaId)
    if (!actual) return 'Cuenta no encontrada'
    const nuevo = { ...actual, ...cambios }
    // Sin Stock no tiene sentido que el gerente cuente.
    if (!nuevo.usa_stock) nuevo.gerente_conteo = false
    // Al prender el entrenamiento se anota desde cuando (rastro); al apagarlo se conserva la fecha.
    if (cambios.entrenamiento === true && !actual.entrenamiento) nuevo.entrenamiento_desde = new Date().toISOString()
    const { cuenta_id: _c, nombre: _n, ...fila } = nuevo
    const { error } = await supabase.from('cuenta_opciones').upsert({
      cuenta_id: cuentaId, ...fila, updated_at: new Date().toISOString(),
    })
    if (error) return error.message
    setCuentas(cs => cs?.map(c => c.cuenta_id === cuentaId ? nuevo : c) ?? cs)
    window.dispatchEvent(new Event(EVENTO))
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
