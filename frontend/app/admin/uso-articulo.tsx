'use client'

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast, useConfirm, Interruptor } from './ui'

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

// ---------- Vigilar (migracion 099, Alejandro 10-oct-2026) ----------
// Aparte del uso: el articulo sigue contando normal (gasto, Stock, precios), pero cada ticket que lo trae va a
// Por revisar y nunca se aprueba solo. El motivo es para quien revisa; nunca se manda a la IA.

export const AYUDA_VIGILAR = 'Cada ticket que lo traiga va a Por revisar y nunca se aprueba solo (tampoco la IA lo aprueba). Sigue contando en gasto, Stock y precios como siempre.'

export function ChipVigilado({ vigilar, motivo }: { vigilar: boolean | null | undefined; motivo?: string | null }) {
  if (!vigilar) return null
  return <span className="chip-revisar" title={motivo ? `Vigilado: ${motivo}` : AYUDA_VIGILAR}>Vigilado</span>
}

/** Guarda si el articulo se vigila y su motivo. Devuelve true si se guardo. */
export function useMarcarVigilar() {
  const toast = useToast()
  return async (p: { id: string; nombre: string }, vigilar: boolean, motivo?: string | null): Promise<boolean> => {
    const cambios: { vigilar: boolean; vigilar_motivo?: string | null } = { vigilar }
    if (motivo !== undefined) cambios.vigilar_motivo = motivo?.trim() || null
    const { error } = await supabase.from('catalogo_productos').update(cambios).eq('id', p.id)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return false }
    toast(motivo !== undefined && vigilar
      ? 'Listo: motivo guardado'
      : vigilar ? `Listo: cada ticket con «${p.nombre}» irá a Por revisar` : `Listo: «${p.nombre}» ya no se vigila`)
    return true
  }
}

/**
 * Seccion plegable "Opciones avanzadas" del articulo: interruptor Vigilar + motivo. El interruptor se guarda al
 * tocarlo; el motivo con su boton. `onCambio` avisa a la pantalla para que pinte lo guardado.
 */
export function OpcionesAvanzadas({ p, onCambio }: {
  p: { id: string; nombre: string; vigilar?: boolean | null; vigilar_motivo?: string | null }
  onCambio: (vigilar: boolean, motivo: string | null) => void
}) {
  const marcar = useMarcarVigilar()
  const vigilar = !!p.vigilar
  const [motivo, setMotivo] = useState(p.vigilar_motivo ?? '')
  const [abierto, setAbierto] = useState(vigilar)
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)   // un guardado a la vez (el campo se guarda al salir y tambien con su boton)
  const motivoCambio = motivo.trim() !== (p.vigilar_motivo ?? '').trim()
  async function guardar(fn: () => Promise<void>) {
    if (enCurso.current) return
    enCurso.current = true; setGuardando(true)
    try { await fn() } finally { enCurso.current = false; setGuardando(false) }
  }
  const cambiar = (nuevo: boolean) => guardar(async () => {
    if (await marcar(p, nuevo)) onCambio(nuevo, p.vigilar_motivo ?? null)
  })
  const guardarMotivo = () => guardar(async () => {
    if (!motivoCambio) return
    if (await marcar(p, true, motivo)) onCambio(true, motivo.trim() || null)
  })
  return (
    <details className="rounded-lg bg-zinc-900/60 px-3 py-2" open={abierto} onToggle={e => setAbierto(e.currentTarget.open)}>
      <summary className="cursor-pointer text-[13px] font-medium text-zinc-300">Opciones avanzadas</summary>
      <div className="mt-2 space-y-2">
        <Interruptor encendido={vigilar} onCambiar={() => cambiar(!vigilar)}
          etiqueta="Vigilar: mandar siempre a revisión" ayuda={AYUDA_VIGILAR} />
        <p className="nota">{AYUDA_VIGILAR} Se guarda al tocarlo.</p>
        {vigilar && (
          <div className="space-y-1">
            <label className="etiqueta block" htmlFor={`vig-${p.id}`}>¿Por qué lo vigilas? (opcional)</label>
            <div className="flex gap-2">
              <input id={`vig-${p.id}`} value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300}
                onBlur={guardarMotivo} onKeyDown={e => { if (e.key === 'Enter') guardarMotivo() }}
                placeholder="Ej. en julio hubo un fraude con este gasto" className="campo min-w-0 flex-1 px-2 py-1.5" />
              {motivoCambio && <button type="button" onClick={guardarMotivo} disabled={guardando} className="btn-secundario btn-sm">Guardar motivo</button>}
            </div>
            <p className="nota">Se guarda al salir del campo. Lo ve quien revisa el ticket; la IA no lo lee.</p>
          </div>
        )}
      </div>
    </details>
  )
}
