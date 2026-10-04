'use client'

import { useOpciones } from '@/lib/opciones'
import { Interruptor, useToast } from '../ui'

// Configuracion > Opciones: ajustes de cada negocio. Aqui se prenden funciones (Stock) y se decide que puede
// hacer el gerente desde su celular. Mas opciones del gerente se agregaran aqui mismo.
export default function OpcionesPage() {
  const { cuentas, guardar } = useOpciones()
  const toast = useToast()

  async function cambiar(cuentaId: string, cambios: Parameters<typeof guardar>[1], ok: string) {
    const err = await guardar(cuentaId, cambios)
    if (err) toast('No se pudo guardar: ' + err, 'error')
    else toast(ok)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Opciones</h2>
        <p className="nota max-w-2xl">Prende solo lo que vas a usar: lo apagado no aparece ni estorba.</p>
      </div>

      {cuentas === null ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      ) : cuentas.length === 0 ? (
        <p className="tarjeta px-4 py-6 text-sm text-zinc-400">No hay negocios dados de alta.</p>
      ) : cuentas.map(c => (
        <section key={c.cuenta_id} className="tarjeta divide-y divide-zinc-800">
          {cuentas.length > 1 && <h3 className="px-4 py-3 text-base font-semibold text-zinc-100">{c.nombre}</h3>}

          <div className="space-y-2 px-4 py-4">
            <h4 className="text-sm font-semibold text-zinc-300">Inventario</h4>
            <div className="-ml-2">
              <Interruptor encendido={c.usa_stock} etiqueta="Usar Stock (inventario)"
                onCambiar={() => cambiar(c.cuenta_id, { usa_stock: !c.usa_stock }, c.usa_stock ? 'Stock apagado' : 'Stock activado: ya puedes hacer tu primer conteo')}
                ayuda="Lleva el inventario contando lo que hay en físico. Con dos conteos la app calcula cuánto se consumió de verdad y cuánto costó." />
            </div>
            <p className="nota pl-0.5">Cuenta lo que hay en físico; con dos conteos ves cuánto se consumió de verdad y su costo.</p>
          </div>

          <div className="space-y-2 px-4 py-4">
            <h4 className="text-sm font-semibold text-zinc-300">Lo que puede hacer el gerente desde su celular</h4>
            <p className="nota">Además de subir tickets, que siempre puede.</p>
            <div className="-ml-2">
              <Interruptor encendido={c.gerente_conteo} etiqueta="Hacer el conteo de inventario"
                onCambiar={() => {
                  if (!c.usa_stock) { toast('Primero prende «Usar Stock»', 'error'); return }
                  cambiar(c.cuenta_id, { gerente_conteo: !c.gerente_conteo }, c.gerente_conteo ? 'El gerente ya no verá el conteo' : 'Listo: el gerente verá «Contar inventario» al entrar con su PIN')
                }}
                ayuda={c.usa_stock
                  ? 'Al entrar con su PIN, el gerente verá un botón para capturar el conteo de su sucursal.'
                  : 'Necesita «Usar Stock» encendido.'} />
            </div>
            {!c.usa_stock && <p className="nota pl-0.5">Disponible cuando prendas «Usar Stock».</p>}
          </div>
        </section>
      ))}
    </div>
  )
}
