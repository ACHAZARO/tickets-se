'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Categoria {
  id: string
  nombre: string
}

interface ObjetivoRow {
  id: string
  categoria_id: string
  pct_objetivo: number
}

export default function ObjetivosPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  // categoria_id -> { id?, pct string }
  const [objetivos, setObjetivos] = useState<Record<string, { id?: string; pct: string }>>({})
  const [loading, setLoading] = useState(true)
  const [savingCat, setSavingCat] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [catRes, objRes] = await Promise.all([
      supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden'),
      supabase.from('objetivos_costo').select('id, categoria_id, pct_objetivo').is('sucursal_id', null).eq('activo', true),
    ])
    setCategorias(catRes.data ?? [])
    const map: Record<string, { id?: string; pct: string }> = {}
    for (const o of (objRes.data as ObjetivoRow[] | null) ?? []) {
      map[o.categoria_id] = { id: o.id, pct: String(o.pct_objetivo) }
    }
    setObjetivos(map)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function guardar(categoriaId: string) {
    const entry = objetivos[categoriaId]
    if (!entry || entry.pct === '') return
    const pct = parseFloat(entry.pct)
    if (isNaN(pct)) return
    setSavingCat(categoriaId)
    if (entry.id) {
      await supabase.from('objetivos_costo').update({ pct_objetivo: pct }).eq('id', entry.id)
    } else {
      const { data } = await supabase
        .from('objetivos_costo')
        .insert({ categoria_id: categoriaId, sucursal_id: null, pct_objetivo: pct })
        .select('id')
        .single()
      if (data) {
        setObjetivos(prev => ({ ...prev, [categoriaId]: { id: data.id, pct: prev[categoriaId].pct } }))
      }
    }
    setSavingCat(null)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Objetivos de costo</h2>
        <p className="text-sm text-zinc-500 mt-1">% máximo de la venta que debería representar cada categoría. El dashboard marca en rojo cuando se excede.</p>
      </div>

      <div className="rounded-2xl bg-zinc-900 divide-y divide-zinc-800/50">
        {categorias.map(c => {
          const entry = objetivos[c.id] ?? { pct: '' }
          return (
            <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm text-zinc-100">{c.nombre}</span>
              <div className="inline-flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.pct}
                  onChange={e => setObjetivos(prev => ({ ...prev, [c.id]: { ...prev[c.id], pct: e.target.value } }))}
                  onBlur={() => guardar(c.id)}
                  placeholder="—"
                  className="w-20 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-right text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 outline-none"
                />
                <span className="text-zinc-500 w-4">%</span>
                {savingCat === c.id && (
                  <span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-zinc-600">Los cambios se guardan al salir de cada campo. Deja vacío una categoría sin objetivo.</p>
    </div>
  )
}
