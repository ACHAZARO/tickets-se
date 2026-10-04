'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSucursal } from '@/lib/sucursal-context'
import { PanelDuplicados } from '../unificar'

// "Articulos por revisar": parejas del catalogo que parecen el mismo producto o el mismo insumo en otro tamano.
// La base las detecta (sugerir_unificaciones) y aqui se PREGUNTA; nada se une solo.

const AYUDA: { boton: string; estilo: string; texto: string }[] = [
  { boton: 'Unificar', estilo: 'btn-opcion', texto: 'Son el mismo artículo con otro nombre. Eliges con qué nombre se queda y la IA usará ese de ahora en adelante.' },
  { boton: 'Mismo insumo, distinto tamaño', estilo: 'btn-opcion', texto: 'Son dos tamaños de lo mismo (Sal 1 kg y Sal 500 g). Quedan los dos, cada uno con su precio, y el inventario los suma.' },
  { boton: 'No son iguales', estilo: 'btn-opcion', texto: 'Cada uno se queda con su nombre, separados. La IA los seguirá clasificando por separado.' },
  { boton: 'Ver tickets', estilo: 'btn-texto !px-0', texto: 'Muestra una foto de cada uno para compararlos antes de decidir.' },
]

export default function InsumosPage() {
  const { sucursalId } = useSucursal()
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([])

  const cargarCategorias = useCallback(async () => {
    let q = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
    q = sucursalId ? q.or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`) : q
    const { data } = await q
    setCategorias((data as { id: string; nombre: string }[] | null) ?? [])
  }, [sucursalId])
  useEffect(() => { cargarCategorias() }, [cargarCategorias])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Artículos por revisar</h2>
        <p className="nota max-w-2xl">Productos que parecen repetidos. Nada cambia hasta que respondas.</p>
      </div>

      <dl className="tarjeta grid gap-4 p-4 sm:grid-cols-2">
        {AYUDA.map(a => (
          <div key={a.boton} className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
            <dt className="shrink-0">
              <span aria-hidden className={`${a.estilo} btn-sm pointer-events-none`}>{a.boton}</span>
              <span className="sr-only">{a.boton}</span>
            </dt>
            <dd className="text-[13px] leading-relaxed text-zinc-400">{a.texto}</dd>
          </div>
        ))}
      </dl>

      <PanelDuplicados categorias={categorias} onCambio={cargarCategorias} />
    </div>
  )
}
