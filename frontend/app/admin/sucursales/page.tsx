'use client'

import { useEffect, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useToast, useConfirm } from '../ui'

interface Sucursal {
  id: string
  slug: string
  nombre: string
  direccion: string | null
  activa: boolean
}

interface Empleado {
  id: string
  nombre: string
  activo: boolean
}

function slugify(s: string): string {
  // quita acentos sin usar caracteres combinantes literales en el fuente
  const sinAcentos = s.normalize('NFD').split('').filter(c => {
    const code = c.charCodeAt(0)
    return code < 0x0300 || code > 0x036f
  }).join('')
  return sinAcentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function SucursalesPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [origin, setOrigin] = useState('')

  // Modales
  const [sucForm, setSucForm] = useState<null | { id?: string; nombre: string; slug: string; direccion: string; activa: boolean }>(null)
  const [empPanel, setEmpPanel] = useState<Sucursal | null>(null)
  const [qrSuc, setQrSuc] = useState<Sucursal | null>(null)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  const fetchData = useCallback(async () => {
    const [sucRes, seRes] = await Promise.all([
      supabase.from('sucursales').select('id, slug, nombre, direccion, activa').order('nombre'),
      supabase.from('sucursal_empleados').select('sucursal_id').eq('activo', true),
    ])
    setSucursales(sucRes.data ?? [])
    const c: Record<string, number> = {}
    for (const r of seRes.data ?? []) c[r.sucursal_id] = (c[r.sucursal_id] ?? 0) + 1
    setCounts(c)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const enlace = (slug: string) => `${origin}/sucursal/${slug}`

  async function toggleActiva(s: Sucursal) {
    const { error } = await supabase.from('sucursales').update({ activa: !s.activa }).eq('id', s.id)
    if (error) { toast('No se pudo cambiar: ' + error.message, 'error'); return }
    setSucursales(prev => prev.map(x => x.id === s.id ? { ...x, activa: !x.activa } : x))
  }

  async function eliminarSucursal(s: Sucursal) {
    if (!(await confirm(`¿Eliminar la sucursal "${s.nombre}"? Esto no se puede deshacer.`, { danger: true }))) return
    const { error } = await supabase.from('sucursales').delete().eq('id', s.id)
    if (error) {
      toast('No se puede eliminar: la sucursal tiene tickets o ventas registradas. Usa "Desactivar" en su lugar.', 'error')
      return
    }
    setSucursales(prev => prev.filter(x => x.id !== s.id))
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-zinc-100">Sucursales</h2>
        <button
          onClick={() => setSucForm({ nombre: '', slug: '', direccion: '', activa: true })}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
        >+ Agregar</button>
      </div>

      <div className="space-y-3">
        {sucursales.length === 0 ? (
          <p className="text-zinc-500 text-center py-12">Aún no hay sucursales</p>
        ) : sucursales.map(s => (
          <div key={s.id} className={`rounded-2xl bg-zinc-900 p-4 ${!s.activa ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-zinc-100">{s.nombre}</h3>
                  {!s.activa && <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500">Inactiva</span>}
                </div>
                {s.direccion && <p className="text-xs text-zinc-500 mt-0.5">{s.direccion}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <code className="text-xs text-zinc-400 bg-zinc-800 rounded px-2 py-1 truncate max-w-[260px]">{enlace(s.slug)}</code>
                  <button onClick={() => navigator.clipboard?.writeText(enlace(s.slug))} className="text-xs text-blue-400 hover:text-blue-300">copiar</button>
                </div>
                <p className="text-xs text-zinc-600 mt-2">{counts[s.id] ?? 0} empleado(s)</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <BtnSec onClick={() => setEmpPanel(s)}>Empleados</BtnSec>
              <BtnSec onClick={() => setQrSuc(s)}>QR</BtnSec>
              <BtnSec onClick={() => setSucForm({ id: s.id, nombre: s.nombre, slug: s.slug, direccion: s.direccion ?? '', activa: s.activa })}>Editar</BtnSec>
              <BtnSec onClick={() => toggleActiva(s)}>{s.activa ? 'Desactivar' : 'Activar'}</BtnSec>
              <button onClick={() => eliminarSucursal(s)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-zinc-700">Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      {sucForm && <SucursalModal form={sucForm} onClose={() => setSucForm(null)} onSaved={() => { setSucForm(null); setLoading(true); fetchData() }} />}
      {empPanel && <EmpleadosModal sucursal={empPanel} onClose={() => setEmpPanel(null)} onChanged={fetchData} />}
      {qrSuc && <QRModal sucursal={qrSuc} url={enlace(qrSuc.slug)} onClose={() => setQrSuc(null)} />}
    </div>
  )
}

function BtnSec({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700">{children}</button>
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4" onClick={onClose}>
      <div className="w-full md:max-w-md rounded-t-2xl md:rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 outline-none" />
    </div>
  )
}

function SucursalModal({ form, onClose, onSaved }: {
  form: { id?: string; nombre: string; slug: string; direccion: string; activa: boolean }
  onClose: () => void; onSaved: () => void
}) {
  const [nombre, setNombre] = useState(form.nombre)
  const [slug, setSlug] = useState(form.slug)
  const [direccion, setDireccion] = useState(form.direccion)
  const [slugTouched, setSlugTouched] = useState(!!form.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function onNombre(v: string) {
    setNombre(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  async function guardar() {
    if (!nombre.trim() || !slug.trim()) { setError('Nombre y slug requeridos'); return }
    setSaving(true); setError('')
    const payload = { nombre: nombre.trim(), slug: slug.trim(), direccion: direccion.trim() || null }
    const res = form.id
      ? await supabase.from('sucursales').update(payload).eq('id', form.id)
      : await supabase.from('sucursales').insert({ ...payload, activa: true })
    setSaving(false)
    if (res.error) { setError(res.error.code === '23505' ? 'Ese slug ya existe' : res.error.message); return }
    onSaved()
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">{form.id ? 'Editar sucursal' : 'Nueva sucursal'}</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
      </div>
      <Field label="Nombre" value={nombre} onChange={onNombre} placeholder="Sucursal Centro" />
      <div>
        <Field label="Slug (URL)" value={slug} onChange={v => { setSlug(slugify(v)); setSlugTouched(true) }} placeholder="sucursal-centro" />
        <p className="text-xs text-zinc-600 mt-1">Aparece en el enlace y el QR. Solo letras, números y guiones.</p>
      </div>
      <Field label="Dirección (opcional)" value={direccion} onChange={setDireccion} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={guardar} disabled={saving} className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60">
        {saving ? 'Guardando...' : 'Guardar'}
      </button>
    </Overlay>
  )
}

function EmpleadosModal({ sucursal, onClose, onChanged }: { sucursal: Sucursal; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<null | { id?: string; nombre: string; pin: string; activo: boolean }>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sucursal_empleados')
      .select('activo, empleados:empleado_id ( id, nombre, activo )')
      .eq('sucursal_id', sucursal.id)
    const emps = (data ?? []).map((r: { empleados: unknown }) => r.empleados as Empleado).filter(Boolean)
    setEmpleados(emps)
    setLoading(false)
  }, [sucursal.id])

  useEffect(() => { load() }, [load])

  async function guardar() {
    if (!editing) return
    if (!editing.nombre.trim()) { setError('Nombre requerido'); return }
    if (!editing.id && editing.pin.trim().length < 4) { setError('PIN de al menos 4 dígitos'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.rpc('admin_guardar_empleado', {
      p_id: editing.id ?? null,
      p_nombre: editing.nombre.trim(),
      p_pin: editing.pin.trim() || null,
      p_activo: editing.activo,
      p_sucursal_id: sucursal.id,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setEditing(null)
    setLoading(true); await load(); onChanged()
  }

  async function eliminar(e: Empleado) {
    if (!(await confirm(`¿Eliminar al empleado "${e.nombre}"?`, { danger: true }))) return
    const { error } = await supabase.from('empleados').delete().eq('id', e.id)
    if (error) {
      // Tiene tickets asociados: solo quitarlo de la sucursal y desactivarlo
      await supabase.from('sucursal_empleados').delete().eq('empleado_id', e.id).eq('sucursal_id', sucursal.id)
      await supabase.from('empleados').update({ activo: false }).eq('id', e.id)
    }
    setLoading(true); await load(); onChanged()
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">Empleados · {sucursal.nombre}</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="Nombre" value={editing.nombre} onChange={v => setEditing({ ...editing, nombre: v })} />
          <Field label={editing.id ? 'Nuevo PIN (dejar vacío para no cambiar)' : 'PIN (4+ dígitos)'} type="number" value={editing.pin} onChange={v => setEditing({ ...editing, pin: v })} placeholder="••••" />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={editing.activo} onChange={e => setEditing({ ...editing, activo: e.target.checked })} className="h-4 w-4 rounded border-zinc-700 bg-zinc-800" />
            Activo
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={guardar} disabled={saving} className="flex-1 rounded-xl bg-zinc-100 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button>
            <button onClick={() => { setEditing(null); setError('') }} className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-300">Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          {loading ? (
            <div className="flex justify-center py-6"><div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
          ) : empleados.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4 text-center">Sin empleados en esta sucursal</p>
          ) : (
            <div className="space-y-1">
              {empleados.map(e => (
                <div key={e.id} className={`flex items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2 ${!e.activo ? 'opacity-50' : ''}`}>
                  <span className="text-sm text-zinc-200">{e.nombre}{!e.activo && <span className="text-xs text-zinc-500"> · inactivo</span>}</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setEditing({ id: e.id, nombre: e.nombre, pin: '', activo: e.activo })} className="text-xs text-zinc-400 hover:text-zinc-200">editar</button>
                    <button onClick={() => eliminar(e)} className="text-xs text-red-400 hover:text-red-300">eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => { setEditing({ nombre: '', pin: '', activo: true }); setError('') }} className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700">+ Agregar empleado</button>
        </>
      )}
    </Overlay>
  )
}

function QRModal({ sucursal, url, onClose }: { sucursal: Sucursal; url: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then(setDataUrl).catch(() => setDataUrl(''))
  }, [url])

  function descargar() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `qr-${sucursal.slug}.png`
    a.click()
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">QR · {sucursal.nombre}</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
      </div>
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`QR ${sucursal.nombre}`} className="w-56 h-56 rounded-xl bg-white p-2" />
        ) : (
          <div className="w-56 h-56 flex items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" /></div>
        )}
        <code className="text-xs text-zinc-400 break-all text-center">{url}</code>
        <button onClick={descargar} disabled={!dataUrl} className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60">Descargar PNG</button>
      </div>
    </Overlay>
  )
}
