'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOpciones, type OpcionesCuenta } from '@/lib/opciones'
import { useToast } from '../ui'

// Modo entrenamiento (PLAN_MODO_ENTRENAMIENTO.md): avisos que viven en el layout del admin.

/** Opciones de las cuentas para el layout. Se recargan al iniciar sesion (el layout se monta antes del login). */
export function useEntrenamientoActivo(conSesion: boolean) {
  const op = useOpciones()
  const { recargar } = op
  useEffect(() => { if (conSesion) recargar() }, [conSesion, recargar])
  const activo = !!op.cuentas?.some(c => c.entrenamiento)
  return { ...op, activo }
}

/** Franja arriba de cada pantalla mientras el modo esta prendido. */
export function FranjaEntrenamiento() {
  return (
    <div className="border-b border-amber-800/60 bg-amber-950/60">
      <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] text-amber-200 sm:px-6 lg:px-8 2xl:px-12">
        <span className="font-semibold">Falta terminar la configuración.</span>
        <span className="text-amber-300/90">Mientras tanto la IA acepta todo lo que se sube.</span>
        <Link href="/admin/entrenamiento" className="font-medium text-amber-100 underline underline-offset-2">Continuar</Link>
      </div>
    </div>
  )
}

/** La primera vez que entra un negocio nuevo: "¿Deseas iniciar la configuracion?". */
export function BienvenidaEntrenamiento({ cuentas, guardar }: {
  cuentas: OpcionesCuenta[] | null
  guardar: (cuentaId: string, cambios: Partial<OpcionesCuenta>) => Promise<string | null>
}) {
  const router = useRouter()
  const toast = useToast()
  const [ocupado, setOcupado] = useState(false)
  const nuevas = (cuentas ?? []).filter(c => !c.bienvenida_vista)
  if (!nuevas.length) return null

  async function responder(empezar: boolean) {
    setOcupado(true)
    for (const c of nuevas) {
      const err = await guardar(c.cuenta_id, empezar ? { bienvenida_vista: true, entrenamiento: true } : { bienvenida_vista: true })
      if (err) { toast('No se pudo guardar: ' + err, 'error'); setOcupado(false); return }
    }
    setOcupado(false)
    if (empezar) router.push('/admin/entrenamiento')
    else toast('Cuando quieras, actívala en Configuración → Opciones', 'info')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="bienvenida-titulo"
        className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-xl">
        <h2 id="bienvenida-titulo" className="text-lg font-semibold text-zinc-100">¿Deseas iniciar la configuración?</h2>
        <p className="text-[15px] leading-relaxed text-zinc-300">
          Te guiamos paso a paso: tu sucursal, las categorías de tu gasto y tus primeros tickets.
          Mientras dure, nuestra IA aprende cómo es tu negocio con los tickets que subas.
        </p>
        <p className="nota">Puedes prenderla o apagarla cuando quieras en Configuración → Opciones.</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => responder(false)} disabled={ocupado} className="btn-quieto">Más tarde</button>
          <button onClick={() => responder(true)} disabled={ocupado} className="btn-primario" autoFocus>Sí, empezar</button>
        </div>
      </div>
    </div>
  )
}
