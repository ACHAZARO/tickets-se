'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useOpciones } from '@/lib/opciones'
import { Interruptor, useConfirm, useToast } from '../ui'

// Configuracion > Opciones: ajustes de cada negocio. Aqui se prenden funciones (Stock) y se decide que puede
// hacer el gerente desde su celular. Mas opciones del gerente se agregaran aqui mismo.
export default function OpcionesPage() {
  const { cuentas, guardar } = useOpciones()
  const toast = useToast()
  const confirmar = useConfirm()
  // Categorias de cada cuenta (las globales + las de sus sucursales) para elegir la de "gasto extra".
  const [cats, setCats] = useState<{ id: string; nombre: string; sucursal_id: string | null }[]>([])
  const [sucCuenta, setSucCuenta] = useState<Record<string, string>>({})
  useEffect(() => {
    Promise.all([
      supabase.from('categorias_gasto').select('id, nombre, sucursal_id').eq('activa', true).order('orden'),
      supabase.from('sucursales').select('id, cuenta_id'),
    ]).then(([c, s]) => {
      setCats((c.data as { id: string; nombre: string; sucursal_id: string | null }[] | null) ?? [])
      setSucCuenta(Object.fromEntries(((s.data as { id: string; cuenta_id: string | null }[] | null) ?? []).filter(x => x.cuenta_id).map(x => [x.id, x.cuenta_id!])))
    })
  }, [])
  const catsDe = (cuentaId: string) => {
    const vistos = new Set<string>()
    return cats.filter(k => (k.sucursal_id === null || sucCuenta[k.sucursal_id] === cuentaId) && !vistos.has(k.nombre.toLowerCase()) && vistos.add(k.nombre.toLowerCase()))
  }

  async function cambiar(cuentaId: string, cambios: Parameters<typeof guardar>[1], ok: string) {
    const err = await guardar(cuentaId, cambios)
    if (err) toast('No se pudo guardar: ' + err, 'error')
    else toast(ok)
  }

  return (
    <div className="max-w-3xl space-y-6">
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
            <h4 className="text-sm font-semibold text-zinc-300">Modo entrenamiento</h4>
            <div className="-ml-2">
              <Interruptor encendido={c.entrenamiento} etiqueta="Modo entrenamiento"
                onCambiar={async () => {
                  if (!c.entrenamiento && !await confirmar('Mientras esté prendido, la IA acepta TODOS los tickets de este negocio (también los de tus gerentes) sin mandar nada a revisión ni a fraude.\n\nPréndelo solo para empezar, y sube tú los tickets que ya revisaste.', { si: 'Prender', no: 'Cancelar' })) return
                  cambiar(c.cuenta_id, { entrenamiento: !c.entrenamiento, bienvenida_vista: true },
                  c.entrenamiento ? 'Modo entrenamiento apagado: la IA vuelve a mandar a revisión lo que no conoce' : 'Modo entrenamiento activo: sigue los pasos en Configuración → Entrenamiento')
                }}
                ayuda="Para empezar: la IA acepta los tickets que subes y aprende tus artículos, comercios y categorías." />
            </div>
            <p className="nota pl-0.5">
              {c.entrenamiento
                ? 'Activo: la IA acepta todo lo que subes y no manda nada a revisión ni a fraude. Cuando termines los pasos, apágalo aquí.'
                : 'Para empezar con la app: subes tickets ya revisados por ti y la IA aprende cómo es tu negocio. Mientras está prendido no manda nada a revisión ni a fraude.'}
            </p>
          </div>

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

          <div className="space-y-2 px-4 py-4">
            <h4 className="text-sm font-semibold text-zinc-300">Pagos</h4>
            <div className="-ml-2">
              <Interruptor encendido={c.tarjeta_repone_caja} etiqueta="El gerente paga con su tarjeta y toma el efectivo de la caja"
                onCambiar={() => cambiar(c.cuenta_id, { tarjeta_repone_caja: !c.tarjeta_repone_caja },
                  c.tarjeta_repone_caja ? 'Listo: te preguntaremos cuando el papel diga tarjeta y se registre efectivo' : 'Listo: ya no se pregunta por esos tickets')}
                ayuda="Si el papel dice tarjeta y el gerente registró efectivo, se toma como correcto y no te preguntamos." />
            </div>
            <p className="nota pl-0.5">Si el papel dice tarjeta y el gerente registró efectivo, se toma como correcto y no te preguntamos.</p>
          </div>

          <div className="space-y-3 px-4 py-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-zinc-300">Artículos no autorizados</h4>
              <p className="nota">Los que marcas como «No autorizado» en Artículos: si aparecen en un ticket van a Fraude. Tú decides si se aprueban.</p>
            </div>
            <label className="block max-w-sm space-y-1">
              <span className="etiqueta block">Lo que apruebes cuenta en</span>
              <select value={c.categoria_extra_id ?? ''} className="campo w-full"
                onChange={e => cambiar(c.cuenta_id, { categoria_extra_id: e.target.value || null }, 'Listo: lo aprobado irá a esa categoría')}>
                <option value="">La categoría «Extras» (si existe)</option>
                {catsDe(c.cuenta_id).map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
              </select>
            </label>
            <div className="-ml-2">
              <Interruptor encendido={c.avisar_gerente_no_autorizado} etiqueta="Avisarle al gerente lo que no se aprobó"
                onCambiar={() => cambiar(c.cuenta_id, { avisar_gerente_no_autorizado: !c.avisar_gerente_no_autorizado },
                  c.avisar_gerente_no_autorizado ? 'El gerente ya no verá esos avisos' : 'Listo: el gerente lo verá al entrar con su PIN')}
                ayuda="Al entrar con su PIN, el gerente ve cada artículo que no se aprobó: no cuenta en sus tickets y debe reponer ese dinero." />
            </div>
            <p className="nota pl-0.5">Si lo prendes, en su siguiente sesión verá: «Este artículo no está aprobado y no pertenece a la operación. No se cuenta en el total de tus tickets y debes reponer ese dinero, o se tomará como hurto. Para autorizarlo, habla con el administrador».</p>
          </div>
        </section>
      ))}
    </div>
  )
}
