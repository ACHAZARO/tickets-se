'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Categoria {
  id: string
  nombre: string
}

interface Producto {
  id: string
  nombre: string
  sinonimos: string[]
  categoria_id: string
  unidad_default: string | null
  precio_referencia: number | null
  veces_matched: number
  activo: boolean
  categorias_gasto: { nombre: string } | null
}

const UNIDADES = ['kg', 'pz', 'ml', 'lt', 'caja', 'bulto', 'rollo', 'paquete', 'galon', 'otro']

interface FormState {
  nombre: string
  categoriaId: string
  unidad: string
  precioRef: string
  sinonimos: string
  activo: boolean
}

const EMPTY_FORM: FormState = {
  nombre: '',
  categoriaId: '',
  unidad: '',
  precioRef: '',
  sinonimos: '',
  activo: true,
}

export default function CatalogoPage() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null) // null = closed, 'new' = adding
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    const [prodRes, catRes] = await Promise.all([
      supabase
        .from('catalogo_productos')
        .select('id, nombre, sinonimos, categoria_id, unidad_default, precio_referencia, veces_matched, activo, categorias_gasto:categoria_id ( nombre )')
        .order('nombre'),
      supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden'),
    ])
    setProductos((prodRes.data as unknown as Producto[]) ?? [])
    setCategorias(catRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function openNew() {
    setForm({ ...EMPTY_FORM, categoriaId: categorias[0]?.id ?? '' })
    setEditingId('new')
  }

  function openEdit(p: Producto) {
    setForm({
      nombre: p.nombre,
      categoriaId: p.categoria_id,
      unidad: p.unidad_default ?? '',
      precioRef: p.precio_referencia?.toString() ?? '',
      sinonimos: p.sinonimos.join(', '),
      activo: p.activo,
    })
    setEditingId(p.id)
  }

  function closeForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    if (!form.nombre.trim() || !form.categoriaId) return
    setSaving(true)

    const payload = {
      nombre: form.nombre.trim(),
      categoria_id: form.categoriaId,
      unidad_default: form.unidad || null,
      precio_referencia: form.precioRef ? parseFloat(form.precioRef) : null,
      sinonimos: form.sinonimos
        ? form.sinonimos.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      activo: form.activo,
    }

    if (editingId === 'new') {
      await supabase.from('catalogo_productos').insert(payload)
    } else {
      await supabase.from('catalogo_productos').update(payload).eq('id', editingId)
    }

    setSaving(false)
    closeForm()
    setLoading(true)
    fetchData()
  }

  async function toggleActivo(p: Producto) {
    await supabase.from('catalogo_productos').update({ activo: !p.activo }).eq('id', p.id)
    setProductos(prev => prev.map(x => (x.id === p.id ? { ...x, activo: !x.activo } : x)))
  }

  const filtered = productos.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.nombre.toLowerCase().includes(q) ||
      p.sinonimos.some(s => s.toLowerCase().includes(q)) ||
      (p.categorias_gasto?.nombre ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-zinc-100">Catalogo de productos</h2>
        <button
          onClick={openNew}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
        >
          + Agregar
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por nombre, sinonimo o categoria..."
        className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">
          {productos.length === 0 ? 'Aun no hay productos en el catalogo' : 'Sin coincidencias'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <div
              key={p.id}
              className={`flex items-center gap-4 rounded-xl bg-zinc-900 p-4 ${!p.activo ? 'opacity-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-zinc-100 truncate">{p.nombre}</p>
                  {p.unidad_default && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{p.unidad_default}</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate">
                  {p.categorias_gasto?.nombre ?? 'Sin categoria'}
                  {p.precio_referencia != null && ` · ref $${p.precio_referencia}`}
                  {p.veces_matched > 0 && ` · ${p.veces_matched} usos`}
                  {p.sinonimos.length > 0 && ` · ${p.sinonimos.join(', ')}`}
                </p>
              </div>

              <button
                onClick={() => toggleActivo(p)}
                title={p.activo ? 'Desactivar' : 'Activar'}
                className={`text-xs font-medium px-2 py-1 rounded-lg ${
                  p.activo ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {p.activo ? 'Activo' : 'Inactivo'}
              </button>
              <button
                onClick={() => openEdit(p)}
                className="text-sm text-zinc-400 hover:text-zinc-200 px-2"
              >
                Editar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Add panel */}
      {editingId && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4"
          onClick={closeForm}
        >
          <div
            className="w-full md:max-w-md rounded-t-2xl md:rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 max-h-[90dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">
                {editingId === 'new' ? 'Nuevo producto' : 'Editar producto'}
              </h3>
              <button onClick={closeForm} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            <Field label="Nombre" value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} />

            <div>
              <label className="text-xs text-zinc-500 block mb-1">Categoria</label>
              <select
                value={form.categoriaId}
                onChange={e => setForm(f => ({ ...f, categoriaId: e.target.value }))}
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Seleccionar...</option>
                {categorias.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Unidad default</label>
                <select
                  value={form.unidad}
                  onChange={e => setForm(f => ({ ...f, unidad: e.target.value }))}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="">Ninguna</option>
                  {UNIDADES.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <Field
                label="Precio referencia"
                value={form.precioRef}
                onChange={v => setForm(f => ({ ...f, precioRef: v }))}
                type="number"
              />
            </div>

            <Field
              label="Sinonimos"
              value={form.sinonimos}
              onChange={v => setForm(f => ({ ...f, sinonimos: v }))}
              placeholder="aceite, aceite cocina (separados por coma)"
            />

            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-800"
              />
              Activo
            </label>

            <button
              onClick={handleSave}
              disabled={saving || !form.nombre.trim() || !form.categoriaId}
              className="w-full rounded-xl bg-zinc-100 py-3 text-base font-semibold text-zinc-900 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
      />
    </div>
  )
}
