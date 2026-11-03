'use client'

import { useSucursal } from '@/lib/sucursal-context'
import { VistaCerebro } from './vista'

export default function CerebroPage() {
  const { sucursalId, sucursales } = useSucursal()
  // Los articulos son por sucursal: con varias, se elige arriba o se ven todos juntos.
  const fija = sucursalId || (sucursales.length === 1 ? sucursales[0].id : '')
  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Cerebro</h2>
        <p className="nota">Lo que la IA ya sabe de tu negocio. Si algo está mal, cámbialo aquí: de ahí en adelante lo hace bien.</p>
      </div>
      <VistaCerebro sucursalFija={fija} />
    </div>
  )
}
