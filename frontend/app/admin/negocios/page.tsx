'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useConfirm, useToast } from '../ui'

// Negocios (solo super admin): quien esta usando la app, cuanto, y las invitaciones para entrar. Cada invitacion es un enlace de un
// solo uso que se manda por WhatsApp; el invitado crea su cuenta ahi mismo.

interface Negocio {
  id: string; nombre: string; estado: string; es_prueba: boolean; limite_tickets_mes: number | null; creada: string; duenos: string | null
  sucursales: number; tickets_mes: number; tickets_total: number; ultimo_ticket: string | null; entrenamiento: boolean
}
interface Invitacion { id: string; codigo: string; nota: string | null; limite_tickets_mes: number | null; expira: string }

const fechaCorta = (s: string | null) => s ? new Date(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'

export default function NegociosPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [permitido, setPermitido] = useState<boolean | null>(null)
  const [negocios, setNegocios] = useState<Negocio[]>([])
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([])
  const [nota, setNota] = useState('')
  const [limite, setLimite] = useState('300')
  const [creando, setCreando] = useState(false)
  const [nueva, setNueva] = useState<string | null>(null)
  const [origen, setOrigen] = useState('')

  const cargar = useCallback(async () => {
    await ensureFreshSession()
    const [{ data: n, error }, { data: i }] = await Promise.all([
      supabase.rpc('negocios_resumen'),
      supabase.from('invitaciones').select('id, codigo, nota, limite_tickets_mes, expira').is('usada_en', null).gt('expira', new Date().toISOString()).order('created_at', { ascending: false }),
    ])
    setPermitido(!error)
    setNegocios((n as Negocio[] | null) ?? [])
    setInvitaciones((i as Invitacion[] | null) ?? [])
  }, [])

  useEffect(() => { setOrigen(window.location.origin); cargar() }, [cargar])

  const enlace = (codigo: string) => `${origen}/registro?inv=${codigo}`
  const textoWhats = (codigo: string) => `Te invito a probar la app para llevar tus tickets de gastos. Crea tu cuenta aquí: ${enlace(codigo)}`

  async function crearInvitacion(e: React.FormEvent) {
    e.preventDefault()
    setCreando(true)
    const tope = Number(limite)
    const { data, error } = await supabase.rpc('crear_invitacion', { p_nota: nota.trim() || null, p_limite: Number.isFinite(tope) && tope > 0 ? tope : null, p_es_prueba: false })
    setCreando(false)
    if (error) { toast('No se pudo crear: ' + error.message, 'error'); return }
    setNueva(data as string)
    setNota('')
    cargar()
  }

  async function copiar(codigo: string) {
    await navigator.clipboard?.writeText(enlace(codigo))
    toast('Enlace copiado')
  }

  async function borrarInvitacion(i: Invitacion) {
    if (!(await confirm(`¿Cancelar esta invitación${i.nota ? ` (${i.nota})` : ''}? El enlace deja de servir.`, { danger: true }))) return
    const { error } = await supabase.from('invitaciones').delete().eq('id', i.id)
    if (error) { toast('No se pudo: ' + error.message, 'error'); return }
    if (nueva === i.codigo) setNueva(null)
    cargar()
  }

  async function entrar(n: Negocio) {
    const { error } = await supabase.rpc('elegir_cuenta', { p_cuenta: n.id })
    if (error) { toast('No se pudo: ' + error.message, 'error'); return }
    window.location.href = '/admin/tickets'
  }

  async function cambiarEstado(n: Negocio) {
    const suspender = n.estado === 'activa'
    if (suspender && !(await confirm(`¿Suspender «${n.nombre}»? Ni sus gerentes ni sus dueños podrán entrar hasta que lo actives.`, { danger: true }))) return
    const { error } = await supabase.rpc('negocio_cambiar', { p_cuenta: n.id, p_estado: suspender ? 'suspendida' : 'activa', p_limite: null })
    if (error) { toast('No se pudo: ' + error.message, 'error'); return }
    cargar()
  }

  async function cambiarLimite(n: Negocio, valor: string) {
    const t = valor.trim()
    const nuevo = t === '' ? -1 : Number(t)
    if (!Number.isFinite(nuevo)) return
    if ((n.limite_tickets_mes ?? -1) === nuevo) return
    const { error } = await supabase.rpc('negocio_cambiar', { p_cuenta: n.id, p_estado: null, p_limite: nuevo })
    if (error) { toast('No se pudo: ' + error.message, 'error'); return }
    toast('Tope guardado')
    cargar()
  }

  if (permitido === null) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
  if (!permitido) return <p className="py-12 text-center text-sm text-zinc-500">Esta pantalla es solo para quien administra la plataforma.</p>

  return (
    <div className="max-w-4xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Invitar a un negocio</h2>
        <form onSubmit={crearInvitacion} className="tarjeta flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-[200px] flex-1 space-y-1">
            <span className="etiqueta block">¿Para quién es? (para que te acuerdes)</span>
            <input value={nota} onChange={e => setNota(e.target.value)} className="campo w-full" maxLength={80} placeholder="Ej. Juan, taquería" />
          </label>
          <label className="w-32 space-y-1">
            <span className="etiqueta block">Tickets al mes</span>
            <input type="number" min={1} inputMode="numeric" value={limite} onChange={e => setLimite(e.target.value)} className="campo w-full" />
          </label>
          <button type="submit" disabled={creando} className="btn-primario">{creando ? 'Creando…' : 'Crear enlace'}</button>
        </form>
        {nueva && (
          <div className="space-y-2 rounded-xl bg-emerald-900/50 p-4">
            <p className="text-sm font-medium text-emerald-300">Listo. Mándale este enlace; solo sirve una vez.</p>
            <code className="block break-all text-xs text-zinc-200">{enlace(nueva)}</code>
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(textoWhats(nueva))}`} target="_blank" rel="noreferrer" className="btn-primario btn-sm">Mandar por WhatsApp</a>
              <button onClick={() => copiar(nueva)} className="btn-secundario btn-sm">Copiar enlace</button>
            </div>
          </div>
        )}
        {invitaciones.length > 0 && (
          <div className="space-y-1">
            <p className="etiqueta">Invitaciones sin usar</p>
            {invitaciones.map(i => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-800/50 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-200">{i.nota ?? 'Sin nombre'}</span>
                <span className="text-xs text-zinc-500">vence {fechaCorta(i.expira)}</span>
                <button onClick={() => copiar(i.codigo)} className="btn-texto btn-sm">Copiar</button>
                <button onClick={() => borrarInvitacion(i)} className="btn-quieto btn-sm">Cancelar</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Negocios <span className="font-normal text-zinc-500">· {negocios.length}</span></h2>
        <div className="space-y-2">
          {negocios.map(n => (
            <div key={n.id} className={`tarjeta space-y-2 p-4 ${n.estado !== 'activa' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-100">{n.nombre}</h3>
                {n.es_prueba && <span className="chip-neutro">Prueba</span>}
                {n.entrenamiento && <span className="chip-info">En entrenamiento</span>}
                {n.estado !== 'activa' && <span className="chip-mal">Suspendido</span>}
              </div>
              <p className="text-xs text-zinc-500 break-all">{n.duenos ?? 'Sin dueño'}</p>
              <p className="text-sm text-zinc-300">
                {n.tickets_mes} tickets este mes{n.limite_tickets_mes != null ? ` de ${n.limite_tickets_mes}` : ''} · {n.tickets_total} en total · {n.sucursales} {Number(n.sucursales) === 1 ? 'sucursal' : 'sucursales'} · último {fechaCorta(n.ultimo_ticket)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => entrar(n)} className="btn-secundario btn-sm">Entrar a verlo</button>
                <label className="flex items-center gap-1.5 text-[13px] text-zinc-400">Tope al mes
                  <input type="number" min={0} inputMode="numeric" defaultValue={n.limite_tickets_mes ?? ''} placeholder="sin tope" aria-label={`Tope de tickets de ${n.nombre}`}
                    onBlur={e => cambiarLimite(n, e.target.value)} className="campo w-24 px-2 py-1" />
                </label>
                <button onClick={() => cambiarEstado(n)} className={n.estado === 'activa' ? 'btn-quieto btn-sm' : 'btn-secundario btn-sm'}>{n.estado === 'activa' ? 'Suspender' : 'Activar'}</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
