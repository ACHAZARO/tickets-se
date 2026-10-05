'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useOpciones, type OpcionesCuenta, type PasosEntrenamiento } from '@/lib/opciones'
import { useConfirm, useToast } from '../ui'

// Configuracion > Entrenamiento (PLAN_MODO_ENTRENAMIENTO.md). Pasos para empezar con un negocio nuevo. Los que se
// pueden comprobar en la base se palomean solos; los demas con un boton. Todo es por cuenta (negocio).

interface Plantilla { nombre: string; operativo: boolean; palomeada: boolean; obligatoria: boolean; ayuda: string | null; orden: number }
interface Estado {
  sucursales: { id: string; nombre: string; slug: string }[]
  conEmpleado: boolean
  categorias: { id: string; nombre: string; sucursal_id: string | null }[]
  formas: number
  tickets: { subidos: number; aceptados: number }
}

const GIROS = [
  { clave: 'restaurante', nombre: 'Restaurante / Cafetería' },
  { clave: 'tienda', nombre: 'Tienda / Comercio' },
  { clave: 'oficina', nombre: 'Oficina / Servicios' },
  { clave: 'otro', nombre: 'Otro' },
]

export default function EntrenamientoPage() {
  const { cuentas, guardar } = useOpciones()
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const enEntrenamiento = (cuentas ?? []).filter(c => c.entrenamiento)
  const cuenta = enEntrenamiento.find(c => c.cuenta_id === cuentaId) ?? enEntrenamiento[0] ?? null

  if (cuentas === null) return <Cargando />
  if (!cuenta) return <Apagado cuentas={cuentas} guardar={guardar} />

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Entrenamiento</h2>
        <p className="nota max-w-2xl">
          Sigue los pasos para que nuestra IA conozca tu negocio. Cuando termines, desactiva el modo entrenamiento.
        </p>
      </div>
      {enEntrenamiento.length > 1 && (
        <label className="block max-w-sm space-y-1">
          <span className="etiqueta block">Negocio</span>
          <select value={cuenta.cuenta_id} onChange={e => setCuentaId(e.target.value)} className="campo w-full">
            {enEntrenamiento.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre}</option>)}
          </select>
        </label>
      )}
      <Pasos key={cuenta.cuenta_id} cuenta={cuenta} guardar={guardar} />
    </div>
  )
}

function Cargando() {
  return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
}

function Apagado({ cuentas, guardar }: { cuentas: OpcionesCuenta[]; guardar: ReturnType<typeof useOpciones>['guardar'] }) {
  const toast = useToast()
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-100">Entrenamiento</h2>
      <div className="tarjeta space-y-3 px-4 py-4">
        <p className="text-sm text-zinc-300">El modo entrenamiento está apagado.</p>
        <p className="nota">Préndelo para empezar con un negocio nuevo: la IA acepta los tickets que subes y aprende tus artículos, comercios y categorías.</p>
        {cuentas.map(c => (
          <button key={c.cuenta_id} className="btn-secundario btn-sm"
            onClick={async () => {
              const err = await guardar(c.cuenta_id, { entrenamiento: true, bienvenida_vista: true })
              toast(err ? 'No se pudo guardar: ' + err : 'Modo entrenamiento activo', err ? 'error' : 'ok')
            }}>
            Prender{cuentas.length > 1 ? ` en ${c.nombre}` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

function Pasos({ cuenta, guardar }: { cuenta: OpcionesCuenta; guardar: ReturnType<typeof useOpciones>['guardar'] }) {
  const router = useRouter()
  const toast = useToast()
  const confirmar = useConfirm()
  const [estado, setEstado] = useState<Estado | null>(null)

  const cargar = useCallback(async () => {
    const { data: sucs } = await supabase.from('sucursales').select('id, nombre, slug')
      .eq('cuenta_id', cuenta.cuenta_id).eq('activa', true).order('nombre')
    const sucursales = (sucs as Estado['sucursales'] | null) ?? []
    const ids = sucursales.map(s => s.id)
    const sinIds = ['00000000-0000-0000-0000-000000000000']
    const [emp, cats, formas, subidos, aceptados] = await Promise.all([
      supabase.from('sucursal_empleados').select('id', { count: 'exact', head: true }).in('sucursal_id', ids.length ? ids : sinIds).eq('activo', true),
      supabase.from('categorias_gasto').select('id, nombre, sucursal_id').eq('activa', true).in('sucursal_id', ids.length ? ids : sinIds),
      supabase.from('formas_pago').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuenta.cuenta_id).eq('activa', true),
      supabase.from('registros_tickets').select('id', { count: 'exact', head: true }).in('sucursal_id', ids.length ? ids : sinIds)
        .gte('created_at', cuenta.entrenamiento_desde ?? '1970-01-01'),
      supabase.from('registros_tickets').select('id', { count: 'exact', head: true }).in('sucursal_id', ids.length ? ids : sinIds)
        .eq('entrenamiento', true).eq('estado', 'confirmado'),
    ])
    setEstado({
      sucursales,
      conEmpleado: (emp.count ?? 0) > 0,
      categorias: (cats.data as Estado['categorias'] | null) ?? [],
      formas: formas.count ?? 0,
      tickets: { subidos: subidos.count ?? 0, aceptados: aceptados.count ?? 0 },
    })
  }, [cuenta.cuenta_id, cuenta.entrenamiento_desde])
  useEffect(() => { cargar() }, [cargar])

  async function marcar(cambio: PasosEntrenamiento, ok: string) {
    const err = await guardar(cuenta.cuenta_id, { entrenamiento_pasos: { ...cuenta.entrenamiento_pasos, ...cambio } })
    toast(err ? 'No se pudo guardar: ' + err : ok, err ? 'error' : 'ok')
  }

  async function desactivar() {
    if (!await confirmar('¿Desactivar el modo entrenamiento?\n\nDesde ahora la IA mandará a revisión o a fraude lo que no conozca.', { si: 'Desactivar', no: 'Todavía no' })) return
    const err = await guardar(cuenta.cuenta_id, { entrenamiento: false })
    if (err) { toast('No se pudo guardar: ' + err, 'error'); return }
    toast('Modo entrenamiento desactivado')
    router.push('/admin/tickets')
  }

  if (!estado) return <Cargando />

  const p = cuenta.entrenamiento_pasos
  const hecho = [
    estado.sucursales.length > 0 && estado.conEmpleado,
    estado.categorias.length > 0,
    estado.formas > 0,
    !!p.articulos,
    !!p.tickets,
    !!p.cerebro,
  ]
  const todos = hecho.every(Boolean)
  const slug = estado.sucursales[0]?.slug

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">{hecho.filter(Boolean).length} de {hecho.length} pasos listos</p>

      <Paso n={1} listo={hecho[0]} titulo="Tu sucursal y tu PIN">
        <p>Crea tu sucursal y <b className="text-zinc-200">date de alta tú mismo como empleado</b> con tu propio PIN
          (por ejemplo «Tú (administrador)»). Con ese PIN subirás los tickets de entrenamiento. Ahí mismo descargas el QR para tus gerentes.</p>
        <Link href="/admin/sucursales" className="btn-texto btn-sm -ml-2">Ir a Sucursales</Link>
      </Paso>

      <Paso n={2} listo={hecho[1]} titulo="Categorías de tu gasto">
        <p>Crea las categorías en que quieres ver tu gasto. Nuestra IA clasificará cada artículo y solo te preguntará
          cuando tenga duda. Después, en Cerebro, puedes revisar cómo conectó todo y reorganizarlo.</p>
        {estado.sucursales.length === 0
          ? <p className="nota">Primero crea tu sucursal (paso 1).</p>
          : hecho[1]
            ? <p>Ya tienes {estado.categorias.length} categorías. Puedes agregar más en <Link href="/admin/catalogo" className="text-emerald-400 underline underline-offset-2">Artículos</Link>.</p>
            : <ElegirCategorias cuenta={cuenta} guardar={guardar} sucursales={estado.sucursales} alTerminar={cargar} />}
      </Paso>

      <Paso n={3} listo={hecho[2]} titulo="Formas de pago">
        <p>Cómo pagas tus compras (efectivo, tarjeta, transferencia…). Al subir un ticket se elige una.</p>
        <Link href="/admin/formas-pago" className="btn-texto btn-sm -ml-2">Ir a Formas de pago</Link>
      </Paso>

      <Paso n={4} listo={hecho[3]} titulo="Tus artículos: elige cómo empezar">
        <div className="grid gap-3 sm:grid-cols-2">
          <Camino elegido={p.articulos === 'B'} titulo="Más rápido (recomendado)"
            texto="La IA arma tu catálogo leyendo tus tickets; los nombres quedan como vienen en el ticket. Después los renombras y, desde ese momento, cada vez que la IA lea ese artículo lo mandará al nombre que elegiste."
            onElegir={() => marcar({ articulos: 'B' }, 'Listo: la IA armará tu catálogo con tus tickets')} />
          <Camino elegido={p.articulos === 'A'} titulo="Más control"
            texto="Primero creas tu lista de artículos en Artículos. La IA reconoce los artículos de cada ticket y los manda solos al que corresponde; los que no tengas, los crea."
            onElegir={() => marcar({ articulos: 'A' }, 'Listo: crea tu lista en Artículos')} />
        </div>
        {p.articulos === 'A' && <Link href="/admin/catalogo" className="btn-texto btn-sm -ml-2">Ir a Artículos</Link>}
      </Paso>

      <Paso n={5} listo={hecho[4]} titulo="Sube tus tickets">
        <div className="space-y-2 rounded-lg border border-amber-800/60 bg-amber-950/50 px-3 py-3 text-amber-200">
          <p className="font-semibold">Antes de subir</p>
          <p>Usa tu PIN de administrador y toma tú las fotos. Sube solo tickets que ya revisaste: sin fraude y solo con
            artículos de la operación normal de tu negocio. En este modo la IA acepta todo, porque está aprendiendo cómo
            es tu negocio. Cuando lo apagues, lo que no conozca irá a revisión o a fraude.</p>
        </div>
        <p>Sube los tickets de un mes, o del periodo que quieras que la IA reconozca.</p>
        <p className="nota">Llevas {estado.tickets.subidos} tickets subidos en entrenamiento; {estado.tickets.aceptados} ya aceptados.
          Si la IA no pudo leer bien uno (borroso, sin fecha o sin total), te lo deja en Tickets para revisarlo.</p>
        <div className="flex flex-wrap gap-2">
          {slug && <a href={`/sucursal/${slug}`} target="_blank" rel="noreferrer" className="btn-secundario btn-sm">Abrir la página para subir</a>}
          {!p.tickets && <button onClick={() => marcar({ tickets: true }, 'Paso listo')} className="btn-texto btn-sm">Ya subí mis tickets</button>}
        </div>
      </Paso>

      <Paso n={6} listo={hecho[5]} titulo="Revisa lo que aprendió la IA">
        <p>En Cerebro ves cómo quedó todo conectado: categorías, comercios y artículos. Renombra artículos, muévelos de
          categoría y acomoda los que quedaron sin clasificar.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/cerebro" className="btn-secundario btn-sm">Abrir Cerebro</Link>
          {!p.cerebro && <button onClick={() => marcar({ cerebro: true }, 'Paso listo')} className="btn-texto btn-sm">Ya lo revisé</button>}
        </div>
      </Paso>

      <Paso n={7} listo={false} titulo={todos ? 'Terminaste' : 'Al terminar'} destacado={todos}>
        <p>{todos
          ? '¡Listo! ¿Desactivamos el modo entrenamiento? Desde ese momento la IA mandará a revisión o a fraude lo que no conozca.'
          : 'Cuando termines los pasos, desactiva el modo entrenamiento. Lo puedes hacer aquí o en Configuración → Opciones.'}</p>
        <button onClick={desactivar} className={todos ? 'btn-primario btn-sm' : 'btn-quieto btn-sm -ml-2'}>
          Desactivar modo entrenamiento
        </button>
      </Paso>
    </div>
  )
}

function Paso({ n, listo, titulo, destacado = false, children }: { n: number; listo: boolean; titulo: string; destacado?: boolean; children: ReactNode }) {
  return (
    <section className={`tarjeta space-y-3 px-4 py-4 ${destacado ? 'border-emerald-700' : ''}`}>
      <h3 className="flex items-center gap-3 text-base font-semibold text-zinc-100">
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
          listo ? 'bg-emerald-600 text-white' : 'border border-zinc-700 text-zinc-400'}`}>
          {listo ? '✓' : n}
        </span>
        {titulo}
        {listo && <span className="sr-only">(listo)</span>}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  )
}

function Camino({ elegido, titulo, texto, onElegir }: { elegido: boolean; titulo: string; texto: string; onElegir: () => void }) {
  return (
    <div className={`space-y-2 rounded-lg border px-3 py-3 ${elegido ? 'border-emerald-600 bg-emerald-950/40' : 'border-zinc-800'}`}>
      <p className="font-semibold text-zinc-200">{titulo}</p>
      <p>{texto}</p>
      {elegido ? <p className="text-[13px] font-medium text-emerald-400">Elegido</p>
        : <button onClick={onElegir} className="btn-secundario btn-sm">Elegir</button>}
    </div>
  )
}

/** Giro + plantilla: categorias sugeridas ya palomeadas; se desmarcan o se agregan otras. */
function ElegirCategorias({ cuenta, guardar, sucursales, alTerminar }: {
  cuenta: OpcionesCuenta; guardar: ReturnType<typeof useOpciones>['guardar']
  sucursales: Estado['sucursales']; alTerminar: () => void
}) {
  const toast = useToast()
  const giroInicial = cuenta.giro?.startsWith('otro') ? 'otro' : cuenta.giro
  const [giro, setGiro] = useState<string | null>(giroInicial)
  const [otroGiro, setOtroGiro] = useState(cuenta.giro?.startsWith('otro:') ? cuenta.giro.slice(5) : '')
  const [plantilla, setPlantilla] = useState<Plantilla[]>([])
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [nueva, setNueva] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!giro) return
    supabase.from('plantillas_categorias').select('nombre, operativo, palomeada, obligatoria, ayuda, orden')
      .eq('giro', giro).order('orden').then(({ data }) => {
        const filas = (data as Plantilla[] | null) ?? []
        setPlantilla(filas)
        setMarcadas(new Set(filas.filter(f => f.palomeada || f.obligatoria).map(f => f.nombre)))
      })
  }, [giro])

  function alternar(nombre: string) {
    setMarcadas(m => { const n = new Set(m); if (n.has(nombre)) n.delete(nombre); else n.add(nombre); return n })
  }

  function agregar() {
    const nombre = nueva.trim().replace(/\s+/g, ' ')
    if (!nombre) return
    if (plantilla.some(f => f.nombre.toLowerCase() === nombre.toLowerCase())) { toast('Esa categoría ya está en la lista', 'info'); setNueva(''); return }
    setPlantilla(ps => [...ps, { nombre, operativo: true, palomeada: true, obligatoria: false, ayuda: 'Creada por ti', orden: 1000 + ps.length }])
    setMarcadas(m => new Set(m).add(nombre))
    setNueva('')
  }

  async function guardarCategorias() {
    const elegidas = plantilla.filter(f => marcadas.has(f.nombre) || f.obligatoria)
    if (!elegidas.length) { toast('Elige al menos una categoría', 'error'); return }
    setGuardando(true)
    // Se copian como categorias PROPIAS de cada sucursal del negocio (nunca globales). Las que ya existen
    // (propias o generales con el mismo nombre) no se repiten.
    const ids = sucursales.map(s => s.id)
    const { data: existentes } = await supabase.from('categorias_gasto').select('nombre, sucursal_id, orden')
      .or(`sucursal_id.is.null,sucursal_id.in.(${ids.join(',')})`)
    const ex = (existentes as { nombre: string; sucursal_id: string | null; orden: number }[] | null) ?? []
    let orden = Math.max(0, ...ex.map(e => e.orden ?? 0))
    const filas = sucursales.flatMap(s => elegidas
      .filter(f => !ex.some(e => e.nombre.toLowerCase() === f.nombre.toLowerCase() && (e.sucursal_id === null || e.sucursal_id === s.id)))
      .map(f => ({ nombre: f.nombre, cuenta_operativo: f.operativo, sucursal_id: s.id, orden: ++orden, activa: true })))
    if (filas.length) {
      const { error } = await supabase.from('categorias_gasto').insert(filas)
      if (error) { setGuardando(false); toast('No se pudieron crear: ' + error.message, 'error'); return }
    }
    const err = await guardar(cuenta.cuenta_id, { giro: giro === 'otro' && otroGiro.trim() ? `otro:${otroGiro.trim()}` : giro })
    setGuardando(false)
    if (err) toast('Las categorías se crearon, pero no se guardó el giro: ' + err, 'error')
    else toast(`Listo: ${elegidas.length} categorías`)
    alTerminar()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="etiqueta">¿Cuál es tu giro?</p>
        <div className="flex flex-wrap gap-2">
          {GIROS.map(g => (
            <button key={g.clave} onClick={() => setGiro(g.clave)} aria-pressed={giro === g.clave}
              className={giro === g.clave ? 'btn-opcion btn-sm' : 'btn-secundario btn-sm'}>{g.nombre}</button>
          ))}
        </div>
        {giro === 'otro' && (
          <label className="block max-w-sm space-y-1">
            <span className="etiqueta block">¿Cuál? (opcional)</span>
            <input value={otroGiro} onChange={e => setOtroGiro(e.target.value)} placeholder="Ej. taller mecánico" className="campo w-full" maxLength={60} />
            <span className="nota block">Te sugerimos las categorías contables más comunes; ajústalas a tu negocio.</span>
          </label>
        )}
      </div>

      {giro && plantilla.length > 0 && (
        <div className="space-y-3">
          <p className="etiqueta">Ya vienen marcadas las más usadas. Desmarca las que no uses o agrega las tuyas.</p>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {plantilla.map(f => (
              <li key={f.nombre}>
                <label className={`flex items-start gap-3 px-3 py-2.5 ${f.obligatoria ? '' : 'cursor-pointer hover:bg-zinc-800/50'}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" checked={marcadas.has(f.nombre) || f.obligatoria}
                    disabled={f.obligatoria} onChange={() => alternar(f.nombre)} />
                  <span className="min-w-0">
                    <span className="block text-zinc-200">{f.nombre}
                      {!f.operativo && <span className="ml-2 text-[12px] text-zinc-500">no suma al gasto de operación</span>}</span>
                    {f.ayuda && <span className="block text-[13px] text-zinc-500">{f.ayuda}{f.obligatoria ? ' · la IA la necesita' : ''}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <form onSubmit={e => { e.preventDefault(); agregar() }} className="flex max-w-md gap-2">
            <input value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Crear otra categoría" className="campo min-w-0 flex-1" maxLength={60} />
            <button type="submit" className="btn-secundario btn-sm" disabled={!nueva.trim()}>Agregar</button>
          </form>
          <p className="nota">Puedes agregar más categorías después, en Artículos.</p>
          <button onClick={guardarCategorias} disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : 'Guardar categorías'}
          </button>
        </div>
      )}
    </div>
  )
}
