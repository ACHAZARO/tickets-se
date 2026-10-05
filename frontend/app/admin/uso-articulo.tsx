'use client'

import { supabase } from '@/lib/supabase'
import { useToast, useConfirm } from './ui'

// Uso de un articulo (migracion 094, decision Alejandro 05-oct-2026). Normal = sin etiqueta.
//  Ocasional     -> cuenta como gasto; no entra a Stock ni a alertas de precio; no sale en sugerencias;
//                   si vuelve a aparecer, el ticket va a Por revisar.
//  No autorizado -> el negocio no lo compra: cada vez que aparece, el renglon va a Fraude. Si lo apruebas cuenta
//                   como gasto extra; si no, no cuenta y queda por justificar.

export type Uso = 'normal' | 'ocasional' | 'no_autorizado'

export const USO: Record<Uso, { texto: string; ayuda: string; chip: string }> = {
  normal: { texto: 'Normal', ayuda: 'Se compra seguido: cuenta en gasto, Stock y precios como siempre.', chip: '' },
  ocasional: {
    texto: 'Ocasional',
    ayuda: 'Se compra de vez en cuando. Cuenta como gasto, pero no entra a Stock ni a alertas de precio. Si vuelve a aparecer, el ticket va a Por revisar.',
    chip: 'chip-info',
  },
  no_autorizado: {
    texto: 'No autorizado',
    ayuda: 'El negocio no lo compra. Si aparece en un ticket, va a revisión de Fraude. Si lo apruebas, cuenta como gasto extra; si no, no cuenta y queda por justificar.',
    chip: 'chip-mal',
  },
}

export const usoDe = (u: string | null | undefined): Uso => (u === 'ocasional' || u === 'no_autorizado' ? u : 'normal')

export function ChipUso({ uso }: { uso: string | null | undefined }) {
  const u = usoDe(uso)
  if (u === 'normal') return null
  return <span className={USO[u].chip} title={USO[u].ayuda}>{USO[u].texto}</span>
}

/** Tres opciones juntas (Normal / Ocasional / No autorizado); cada una explica lo que hace al pasar el cursor. */
export function SelectorUso({ uso, onElegir, disabled }: { uso: string | null | undefined; onElegir: (u: Uso) => void; disabled?: boolean }) {
  const actual = usoDe(uso)
  const tono: Record<Uso, string> = {
    normal: 'bg-zinc-100 text-zinc-900',
    ocasional: 'bg-blue-600 text-white',
    no_autorizado: 'bg-red-600 text-white',
  }
  return (
    <div role="radiogroup" aria-label="Cómo se compra este artículo" className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-800 p-1">
      {(Object.keys(USO) as Uso[]).map(u => (
        <button key={u} type="button" role="radio" aria-checked={actual === u} title={USO[u].ayuda} disabled={disabled}
          onClick={() => actual !== u && onElegir(u)}
          className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${actual === u ? tono[u] + ' shadow-sm' : 'text-zinc-300 hover:bg-zinc-700'}`}>
          {USO[u].texto}
        </button>
      ))}
    </div>
  )
}

/**
 * Cambia el uso de un articulo con las preguntas que tocan. Al pasar a No autorizado ofrece revisar sus compras
 * ANTERIORES (por si quien manejaba antes la operacion metio cosas que no se usan). Devuelve el resultado o null.
 */
export function useMarcarUso() {
  const toast = useToast()
  const confirm = useConfirm()
  return async (p: { id: string; nombre: string }, uso: Uso): Promise<{ uso: Uso; categoria_id: string | null; pendientes: number } | null> => {
    let revisar = false
    if (uso === 'no_autorizado') {
      if (!(await confirm(`«${p.nombre}» pasará a No autorizado.\n\nCada vez que aparezca en un ticket irá a revisión de Fraude. Si lo apruebas cuenta como gasto extra; si no, no cuenta y queda por justificar.`, { si: 'Marcar como no autorizado' }))) return null
      const { count } = await supabase.from('ticket_items')
        .select('id, registros_tickets!inner(estado)', { count: 'exact', head: true })
        .eq('producto_catalogo_id', p.id).eq('autorizacion', 'normal').neq('registros_tickets.estado', 'rechazado')
      if (count && count > 0) {
        const uno = count === 1
        revisar = await confirm(`Ya apareció ${count} ${uno ? 'vez' : 'veces'} en tickets anteriores.\n\n¿Quieres ${uno ? 'revisarlo' : 'revisarlos'}? ${uno ? 'Se manda' : 'Se mandan'} a Fraude para que decidas si se aprueba. Si no, solo cuenta de aquí en adelante.`,
          { si: uno ? 'Sí, revisarlo' : 'Sí, revisarlos', no: 'Solo de aquí en adelante' })
      }
    }
    const { data, error } = await supabase.rpc('marcar_uso_articulo', { p_producto: p.id, p_uso: uso, p_revisar_pasados: revisar })
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return null }
    const r = data as { uso: Uso; categoria_id: string | null; pendientes: number }
    toast(uso === 'no_autorizado'
      ? (r.pendientes ? `Listo: ${r.pendientes} ${r.pendientes === 1 ? 'renglón quedó' : 'renglones quedaron'} en Fraude para revisar` : 'Listo: marcado como no autorizado')
      : uso === 'ocasional' ? 'Listo: marcado como ocasional' : 'Listo: vuelve a ser normal. Revisa su categoría por si la quieres cambiar')
    return r
  }
}
