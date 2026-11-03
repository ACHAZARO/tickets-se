'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { comprimirConTope } from '@/lib/fotos'
import { slugify } from '@/lib/slug'
import { useOpciones, type OpcionesCuenta, type PasosEntrenamiento } from '@/lib/opciones'
import { useConfirm, useToast } from '../ui'
import { VistaCerebro } from '../cerebro/vista'

// Asistente de inicio (PLAN_BETA_AMIGOS.md): una sola pantalla, un paso a la vez, y todo se hace AQUI MISMO: sin ir a Sucursales,
// Categorias ni Cerebro y volver. Mientras dure, la cuenta esta en modo entrenamiento (PLAN_MODO_ENTRENAMIENTO.md): la IA acepta lo
// que sube el dueno y aprende. Se puede salir y volver: arranca en el primer paso que falte.

interface Plantilla { nombre: string; operativo: boolean; palomeada: boolean; obligatoria: boolean; ayuda: string | null; orden: number }
interface Estado {
  sucursales: { id: string; nombre: string; slug: string }[]
  categorias: { id: string; nombre: string }[]
  formas: { id: string; nombre: string; sale_de_caja: boolean }[]
  gerentes: { id: string; nombre: string }[]
  tickets: number
  articulos: number
}

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL
const FORMAS_BASE = [
  { nombre: 'Efectivo', sale_de_caja: true },
  { nombre: 'Tarjeta', sale_de_caja: false },
  { nombre: 'Transferencia', sale_de_caja: false },
]
const GIROS = [
  { clave: 'restaurante', nombre: 'Restaurante o cafetería' },
  { clave: 'tienda', nombre: 'Tienda o comercio' },
  { clave: 'oficina', nombre: 'Oficina o servicios' },
  { clave: 'otro', nombre: 'Otro' },
]
const TOTAL_PASOS = 7
const pesos = (n: number | null) => n == null ? '—' : '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AsistentePage() {
  const { cuentas, guardar } = useOpciones()
  const cuenta = (cuentas ?? [])[0] ?? null
  if (cuentas === null) return <Cargando />
  if (!cuenta) return <p className="py-12 text-center text-sm text-zinc-500">No encontramos tu negocio. Sal y vuelve a entrar.</p>
  if (!cuenta.entrenamiento) return <Apagado cuenta={cuenta} guardar={guardar} />
  return <Asistente key={cuenta.cuenta_id} cuenta={cuenta} guardar={guardar} />
}

function Cargando() {
  return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
}

function Apagado({ cuenta, guardar }: { cuenta: OpcionesCuenta; guardar: ReturnType<typeof useOpciones>['guardar'] }) {
  const toast = useToast()
  return (
    <div className="space-y-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Tu negocio ya está configurado</h1>
      <p className="text-[15px] leading-relaxed text-zinc-400">¿Quieres volver a enseñarle a la IA? Mientras esto esté prendido acepta lo que subas sin preguntar y aprende de eso.</p>
      <div className="flex flex-wrap gap-2">
        <a href="/admin/tickets" className="btn-primario">Ir a mis tickets</a>
        <button className="btn-secundario" onClick={async () => {
          const err = await guardar(cuenta.cuenta_id, { entrenamiento: true, entrenamiento_desde: new Date().toISOString(), bienvenida_vista: true })
          if (err) toast('No se pudo guardar: ' + err, 'error')
        }}>Volver a enseñarle</button>
      </div>
    </div>
  )
}

function Asistente({ cuenta, guardar }: { cuenta: OpcionesCuenta; guardar: ReturnType<typeof useOpciones>['guardar'] }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [paso, setPaso] = useState<number | null>(null)
  // El PIN recien escrito se queda en memoria para no pedirlo otra vez al subir los tickets (nunca se guarda en el navegador).
  const pinEnMemoria = useRef('')

  const cargar = useCallback(async () => {
    const { data: sucs } = await supabase.from('sucursales').select('id, nombre, slug').eq('cuenta_id', cuenta.cuenta_id).eq('activa', true).order('nombre')
    const sucursales = (sucs as Estado['sucursales'] | null) ?? []
    const ids = sucursales.map(s => s.id)
    const sinIds = ['00000000-0000-0000-0000-000000000000']
    const conIds = ids.length ? ids : sinIds
    const [cats, formas, emp, tick, art] = await Promise.all([
      supabase.from('categorias_gasto').select('id, nombre').eq('cuenta_id', cuenta.cuenta_id).eq('activa', true).order('orden'),
      supabase.from('formas_pago').select('id, nombre, sale_de_caja').eq('cuenta_id', cuenta.cuenta_id).eq('activa', true).order('orden'),
      supabase.from('empleados').select('id, nombre').eq('cuenta_id', cuenta.cuenta_id).eq('activo', true).order('nombre'),
      supabase.from('registros_tickets').select('id', { count: 'exact', head: true }).in('sucursal_id', conIds),
      supabase.from('catalogo_productos').select('id', { count: 'exact', head: true }).in('sucursal_id', conIds).eq('activo', true),
    ])
    const nuevo: Estado = {
      sucursales,
      categorias: (cats.data as Estado['categorias'] | null) ?? [],
      formas: (formas.data as Estado['formas'] | null) ?? [],
      gerentes: ((emp.data as Estado['gerentes'] | null) ?? []).filter(e => e.id !== cuenta.entrenamiento_pasos.pin_admin),
      tickets: tick.count ?? 0,
      articulos: art.count ?? 0,
    }
    setEstado(nuevo)
    return nuevo
  }, [cuenta.cuenta_id, cuenta.entrenamiento_pasos.pin_admin])

  useEffect(() => {
    cargar().then(e => {
      const p = cuenta.entrenamiento_pasos
      // Arranca en el primer paso que falte.
      setPaso(prev => prev ?? (!e.sucursales.length ? 1 : !e.categorias.length ? 2 : !e.formas.length ? 3 : !p.pin_admin ? 4 : !p.tickets ? 5 : !p.cerebro ? 6 : 7))
    })
    // Solo al entrar: despues avanza la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function marcar(cambio: PasosEntrenamiento) {
    await guardar(cuenta.cuenta_id, { entrenamiento_pasos: { ...cuenta.entrenamiento_pasos, ...cambio } })
  }
  async function siguiente() {
    await cargar()
    setPaso(p => Math.min((p ?? 1) + 1, TOTAL_PASOS))
    window.scrollTo({ top: 0 })
  }
  const atras = () => { setPaso(p => Math.max((p ?? 1) - 1, 1)); window.scrollTo({ top: 0 }) }

  if (!estado || paso === null) return <Cargando />

  return (
    <div className="space-y-5 pb-4">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-zinc-400">Paso {paso} de {TOTAL_PASOS}</p>
          <a href="/admin/tickets" onClick={() => sessionStorage.setItem('asistente_visto', '1')} className="btn-quieto btn-sm -mr-2">Salir, sigo después</a>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_PASOS} aria-valuenow={paso}>
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${(paso / TOTAL_PASOS) * 100}%` }} />
        </div>
      </header>

      {paso === 1 && <PasoNegocio cuenta={cuenta} estado={estado} guardar={guardar} onListo={siguiente} />}
      {paso === 2 && <PasoCategorias cuenta={cuenta} estado={estado} onListo={siguiente} onAtras={atras} />}
      {paso === 3 && <PasoPagos cuenta={cuenta} estado={estado} onListo={siguiente} onAtras={atras} />}
      {paso === 4 && <PasoPin cuenta={cuenta} estado={estado} guardar={guardar} pinEnMemoria={pinEnMemoria} onListo={siguiente} onAtras={atras} />}
      {paso === 5 && <PasoTickets cuenta={cuenta} estado={estado} pinEnMemoria={pinEnMemoria} onListo={async () => { await marcar({ tickets: true }); await siguiente() }} onAtras={atras} />}
      {paso === 6 && <PasoAprendio estado={estado} onListo={async () => { await marcar({ cerebro: true }); await siguiente() }} onAtras={atras} />}
      {paso === 7 && <PasoGerentes cuenta={cuenta} estado={estado} guardar={guardar} recargar={cargar} onAtras={atras} />}
    </div>
  )
}

function Titulo({ children, ayuda }: { children: ReactNode; ayuda?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{children}</h1>
      {ayuda && <p className="text-[15px] leading-relaxed text-zinc-400">{ayuda}</p>}
    </div>
  )
}

function Pie({ onAtras, children }: { onAtras?: () => void; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur safe-bottom sm:-mx-6 sm:px-6">
      {onAtras && <button type="button" onClick={onAtras} className="btn-quieto">Atrás</button>}
      <div className="ml-auto flex flex-1 justify-end gap-2">{children}</div>
    </div>
  )
}

/** Paso 1: a que se dedica y como se llama su local. Con eso ya se crea su sucursal. */
function PasoNegocio({ cuenta, estado, guardar, onListo }: {
  cuenta: OpcionesCuenta; estado: Estado; guardar: ReturnType<typeof useOpciones>['guardar']; onListo: () => void
}) {
  const toast = useToast()
  const yaHay = estado.sucursales[0] ?? null
  const [giro, setGiro] = useState<string | null>(cuenta.giro?.startsWith('otro') ? 'otro' : cuenta.giro)
  const [nombre, setNombre] = useState(yaHay?.nombre ?? cuenta.nombre)
  const [guardando, setGuardando] = useState(false)

  async function seguir(e: React.FormEvent) {
    e.preventDefault()
    if (!giro) { toast('Elige a qué se dedica tu negocio', 'error'); return }
    if (!nombre.trim()) { toast('Escribe el nombre de tu local', 'error'); return }
    setGuardando(true)
    await ensureFreshSession()
    if (yaHay) {
      if (nombre.trim() !== yaHay.nombre) await supabase.from('sucursales').update({ nombre: nombre.trim() }).eq('id', yaHay.id)
    } else {
      // El enlace para subir sale del nombre; si ya lo usa otro negocio se le agrega un numero.
      const base = slugify(nombre) || 'sucursal'
      let error = null
      for (let i = 0; i < 4; i++) {
        const slug = i === 0 ? base : `${base}-${Math.floor(100 + Math.random() * 900)}`
        ;({ error } = await supabase.from('sucursales').insert({ nombre: nombre.trim(), slug, activa: true, cuenta_id: cuenta.cuenta_id }))
        if (!error || error.code !== '23505') break
      }
      if (error) { setGuardando(false); toast('No se pudo crear: ' + error.message, 'error'); return }
    }
    const err = await guardar(cuenta.cuenta_id, { giro })
    setGuardando(false)
    if (err) { toast('No se pudo guardar: ' + err, 'error'); return }
    onListo()
  }

  return (
    <form onSubmit={seguir} className="space-y-6">
      <Titulo ayuda="En unos minutos la IA ya va a conocer tu negocio. Empecemos por lo básico.">Hola, vamos a preparar tu negocio</Titulo>
      <div className="space-y-2">
        <p className="etiqueta">¿A qué se dedica?</p>
        <div className="grid grid-cols-2 gap-2">
          {GIROS.map(g => (
            <button key={g.clave} type="button" onClick={() => setGiro(g.clave)} aria-pressed={giro === g.clave}
              className={`rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors ${giro === g.clave ? 'border-emerald-500 bg-emerald-950/60 text-emerald-200' : 'border-zinc-800 text-zinc-200 hover:border-zinc-600'}`}>
              {g.nombre}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1">
        <span className="etiqueta block">¿Cómo se llama tu local?</span>
        <input value={nombre} onChange={e => setNombre(e.target.value)} className="campo w-full px-4 py-3" maxLength={80} />
        <span className="nota block">Si tienes más de uno, los agregas después en Configuración.</span>
      </label>
      <Pie><button type="submit" disabled={guardando} className="btn-primario px-6">{guardando ? 'Guardando…' : 'Continuar'}</button></Pie>
    </form>
  )
}

/** Paso 2: categorias sugeridas segun el giro, ya palomeadas. Son de todo el negocio, no de una sucursal. */
function PasoCategorias({ cuenta, estado, onListo, onAtras }: { cuenta: OpcionesCuenta; estado: Estado; onListo: () => void; onAtras: () => void }) {
  const toast = useToast()
  const giro = cuenta.giro?.startsWith('otro') || !cuenta.giro ? 'otro' : cuenta.giro
  const [plantilla, setPlantilla] = useState<Plantilla[]>([])
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [nueva, setNueva] = useState('')
  const [guardando, setGuardando] = useState(false)
  const yaHay = estado.categorias

  useEffect(() => {
    supabase.from('plantillas_categorias').select('nombre, operativo, palomeada, obligatoria, ayuda, orden').eq('giro', giro).order('orden').then(({ data }) => {
      const existentes = new Set(yaHay.map(c => c.nombre.toLowerCase()))
      const filas = (data as Plantilla[] | null) ?? []
      setPlantilla(filas)
      setMarcadas(new Set(filas.filter(f => existentes.size ? existentes.has(f.nombre.toLowerCase()) : f.palomeada || f.obligatoria).map(f => f.nombre)))
    })
  }, [giro, yaHay])

  const lista: Plantilla[] = [...plantilla, ...yaHay.filter(c => !plantilla.some(f => f.nombre.toLowerCase() === c.nombre.toLowerCase()))
    .map((c, i) => ({ nombre: c.nombre, operativo: true, palomeada: true, obligatoria: false, ayuda: null, orden: 900 + i }))]
  const alternar = (n: string) => setMarcadas(m => { const c = new Set(m); if (c.has(n)) c.delete(n); else c.add(n); return c })

  function agregar() {
    const nombre = nueva.trim().replace(/\s+/g, ' ')
    if (!nombre) return
    if (lista.some(f => f.nombre.toLowerCase() === nombre.toLowerCase())) { toast('Esa ya está en la lista', 'info'); setNueva(''); return }
    setPlantilla(ps => [...ps, { nombre, operativo: true, palomeada: true, obligatoria: false, ayuda: null, orden: 1000 + ps.length }])
    setMarcadas(m => new Set(m).add(nombre))
    setNueva('')
  }

  async function seguir() {
    const elegidas = lista.filter(f => marcadas.has(f.nombre) || f.obligatoria)
    if (!elegidas.length) { toast('Deja al menos una categoría', 'error'); return }
    setGuardando(true)
    await ensureFreshSession()
    const existentes = new Set(yaHay.map(c => c.nombre.toLowerCase()))
    let orden = yaHay.length
    const filas = elegidas.filter(f => !existentes.has(f.nombre.toLowerCase()))
      .map(f => ({ nombre: f.nombre, cuenta_operativo: f.operativo, sucursal_id: null, cuenta_id: cuenta.cuenta_id, orden: ++orden, activa: true }))
    if (filas.length) {
      const { error } = await supabase.from('categorias_gasto').insert(filas)
      if (error) { setGuardando(false); toast('No se pudieron crear: ' + error.message, 'error'); return }
    }
    // Las que se desmarcaron y ya existian se apagan (no se borran: pueden tener gasto).
    const apagar = yaHay.filter(c => !elegidas.some(f => f.nombre.toLowerCase() === c.nombre.toLowerCase())).map(c => c.id)
    if (apagar.length) await supabase.from('categorias_gasto').update({ activa: false }).in('id', apagar)
    setGuardando(false)
    onListo()
  }

  return (
    <div className="space-y-5">
      <Titulo ayuda="Son los grupos en que vas a ver lo que gastas. La IA acomoda cada compra sola. Ya marcamos las más comunes: quita las que no uses.">¿En qué grupos quieres ver tu gasto?</Titulo>
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {lista.map(f => (
          <li key={f.nombre}>
            <label className={`flex items-start gap-3 px-3 py-3 ${f.obligatoria ? '' : 'cursor-pointer hover:bg-zinc-800/50'}`}>
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600" checked={marcadas.has(f.nombre) || f.obligatoria} disabled={f.obligatoria} onChange={() => alternar(f.nombre)} />
              <span className="min-w-0">
                <span className="block text-[15px] text-zinc-200">{f.nombre}</span>
                {(f.ayuda || f.obligatoria) && <span className="block text-[13px] text-zinc-500">{f.obligatoria ? 'La IA la necesita' : f.ayuda}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={e => { e.preventDefault(); agregar() }} className="flex gap-2">
        <input value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Agregar otra…" aria-label="Agregar otra categoría" className="campo min-w-0 flex-1" maxLength={60} />
        <button type="submit" className="btn-secundario" disabled={!nueva.trim()}>Agregar</button>
      </form>
      <Pie onAtras={onAtras}><button onClick={seguir} disabled={guardando} className="btn-primario px-6">{guardando ? 'Guardando…' : 'Continuar'}</button></Pie>
    </div>
  )
}

/** Paso 3: formas de pago. Solo Efectivo usa el dinero de la caja. */
function PasoPagos({ cuenta, estado, onListo, onAtras }: { cuenta: OpcionesCuenta; estado: Estado; onListo: () => void; onAtras: () => void }) {
  const toast = useToast()
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(FORMAS_BASE.map(f => f.nombre)))
  const [otra, setOtra] = useState('')
  const [guardando, setGuardando] = useState(false)
  const yaHay = estado.formas

  async function seguir() {
    if (yaHay.length) { onListo(); return }
    const elegidas = FORMAS_BASE.filter(f => marcadas.has(f.nombre))
    const extra = otra.trim()
    if (!elegidas.length && !extra) { toast('Elige al menos una', 'error'); return }
    setGuardando(true)
    await ensureFreshSession()
    const filas = [...elegidas, ...(extra ? [{ nombre: extra, sale_de_caja: false }] : [])]
      .map((f, i) => ({ cuenta_id: cuenta.cuenta_id, nombre: f.nombre, sale_de_caja: f.sale_de_caja, orden: i + 1 }))
    const { error } = await supabase.from('formas_pago').insert(filas)
    setGuardando(false)
    if (error) { toast('No se pudieron crear: ' + error.message, 'error'); return }
    onListo()
  }

  return (
    <div className="space-y-5">
      <Titulo ayuda="Quien suba un ticket va a elegir una de estas. Así sabes cuánto salió de la caja y cuánto no.">¿Cómo pagas tus compras?</Titulo>
      {yaHay.length ? (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {yaHay.map(f => <li key={f.id} className="px-3 py-3 text-[15px] text-zinc-200">{f.nombre} {f.sale_de_caja && <span className="text-[13px] text-zinc-500">· sale de la caja</span>}</li>)}
        </ul>
      ) : (
        <>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {FORMAS_BASE.map(f => (
              <li key={f.nombre}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-zinc-800/50">
                  <input type="checkbox" className="h-5 w-5 accent-emerald-600" checked={marcadas.has(f.nombre)}
                    onChange={() => setMarcadas(m => { const c = new Set(m); if (c.has(f.nombre)) c.delete(f.nombre); else c.add(f.nombre); return c })} />
                  <span className="text-[15px] text-zinc-200">{f.nombre}</span>
                  {f.sale_de_caja && <span className="text-[13px] text-zinc-500">sale de la caja</span>}
                </label>
              </li>
            ))}
          </ul>
          <input value={otra} onChange={e => setOtra(e.target.value)} placeholder="¿Otra? Ej. Tarjeta del negocio" aria-label="Otra forma de pago" className="campo w-full" maxLength={60} />
        </>
      )}
      <Pie onAtras={onAtras}><button onClick={seguir} disabled={guardando} className="btn-primario px-6">{guardando ? 'Guardando…' : 'Continuar'}</button></Pie>
    </div>
  )
}

/** Paso 4: el PIN con el que el dueno sube sus tickets. Es un empleado "Administrador" en todas las sucursales. */
function PasoPin({ cuenta, estado, guardar, pinEnMemoria, onListo, onAtras }: {
  cuenta: OpcionesCuenta; estado: Estado; guardar: ReturnType<typeof useOpciones>['guardar']
  pinEnMemoria: React.MutableRefObject<string>; onListo: () => void; onAtras: () => void
}) {
  const toast = useToast()
  const existente = cuenta.entrenamiento_pasos.pin_admin ?? null
  const [pin, setPin] = useState('')
  const [ver, setVer] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function seguir(e: React.FormEvent) {
    e.preventDefault()
    if (existente && !pin) { onListo(); return }
    if (!/^\d{4,6}$/.test(pin)) { toast('El PIN debe tener de 4 a 6 números', 'error'); return }
    setGuardando(true)
    try {
      await ensureFreshSession()
      const { data: id, error } = await supabase.rpc('admin_guardar_empleado', {
        p_id: existente, p_nombre: 'Administrador', p_pin: pin, p_activo: true, p_sucursal_id: estado.sucursales[0]?.id ?? null,
      })
      if (error || !id) { toast('No se pudo guardar el PIN: ' + (error?.message ?? ''), 'error'); return }
      for (const s of estado.sucursales.slice(1)) {
        await supabase.rpc('admin_guardar_empleado', { p_id: id, p_nombre: 'Administrador', p_pin: null, p_activo: true, p_sucursal_id: s.id })
      }
      const err = await guardar(cuenta.cuenta_id, { entrenamiento_pasos: { ...cuenta.entrenamiento_pasos, pin_admin: id as string } })
      if (err) { toast('No se pudo guardar: ' + err, 'error'); return }
      pinEnMemoria.current = pin
      onListo()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={seguir} className="space-y-5">
      <Titulo ayuda="Con este número vas a subir tickets, sin contraseña. Tus gerentes tendrán el suyo.">Inventa tu PIN</Titulo>
      {existente && <p className="rounded-lg bg-emerald-900/50 px-3 py-2 text-sm text-emerald-300">Ya tienes un PIN. Escribe otro solo si quieres cambiarlo.</p>}
      <div className="flex items-center gap-2">
        <input type={ver ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} autoFocus
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 a 6 números" aria-label="Tu PIN"
          className="campo w-48 px-4 py-3 text-center text-xl tracking-[0.3em] placeholder:text-base placeholder:tracking-normal" />
        <button type="button" onClick={() => setVer(v => !v)} className="btn-quieto">{ver ? 'Ocultar' : 'Ver'}</button>
      </div>
      <Pie onAtras={onAtras}><button type="submit" disabled={guardando || (!existente && pin.length < 4)} className="btn-primario px-6">{guardando ? 'Guardando…' : 'Continuar'}</button></Pie>
    </form>
  )
}

interface TicketSubido { id: string; comercio: string | null; monto: number | null; estado: string; leyendo: boolean; renglones: number }

/** Paso 5: subir aqui mismo. Se ve como la IA va leyendo cada uno. Desde la computadora tambien hay un QR para hacerlo con el celular. */
function PasoTickets({ cuenta, estado, pinEnMemoria, onListo, onAtras }: {
  cuenta: OpcionesCuenta; estado: Estado; pinEnMemoria: React.MutableRefObject<string>; onListo: () => void; onAtras: () => void
}) {
  const sucursal = estado.sucursales[0]
  const [formaId, setFormaId] = useState<string>(estado.formas[0]?.id ?? '')
  const [pin, setPin] = useState(pinEnMemoria.current)
  const [pedirPin, setPedirPin] = useState(false)
  const [subiendo, setSubiendo] = useState<{ hechos: number; total: number } | null>(null)
  const [aviso, setAviso] = useState('')
  const [tickets, setTickets] = useState<TicketSubido[]>([])
  const [cuantos, setCuantos] = useState(estado.tickets)
  const [qr, setQr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const token = useRef<string | null>(null)
  const enlace = typeof window !== 'undefined' && sucursal ? `${window.location.origin}/sucursal/${sucursal.slug}?varias=1` : ''

  useEffect(() => { if (enlace) QRCode.toDataURL(enlace, { width: 320, margin: 2 }).then(setQr).catch(() => setQr('')) }, [enlace])

  const refrescar = useCallback(async () => {
    if (!sucursal) return
    const ids = estado.sucursales.map(s => s.id)
    const { data, count } = await supabase.from('registros_tickets')
      .select('id, comercio, monto, estado, gemini_raw, ticket_items(id)', { count: 'exact' })
      .in('sucursal_id', ids).order('created_at', { ascending: false }).limit(30)
    type F = { id: string; comercio: string | null; monto: number | null; estado: string; gemini_raw: Record<string, unknown> | null; ticket_items: { id: string }[] }
    setTickets(((data as unknown as F[] | null) ?? []).map(t => ({
      id: t.id, comercio: t.comercio, monto: t.monto, estado: t.estado,
      leyendo: typeof t.gemini_raw?._ia_en_proceso === 'string' && Date.now() - Date.parse(t.gemini_raw._ia_en_proceso as string) < 10 * 60_000,
      renglones: t.ticket_items?.length ?? 0,
    })))
    setCuantos(count ?? 0)
  }, [estado.sucursales, sucursal])

  // Mientras este paso esta abierto se va viendo lo que la IA lee (tambien lo que suban desde el celular con el QR).
  useEffect(() => {
    refrescar()
    const t = setInterval(refrescar, 4000)
    return () => clearInterval(t)
  }, [refrescar])

  async function conseguirToken(): Promise<boolean> {
    if (token.current) return true
    if (!pin) { setPedirPin(true); return false }
    const res = await fetch(`${EDGE_FUNCTIONS_URL}/verificar-pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: sucursal.slug, pin }),
    }).catch(() => null)
    const d: { valid?: boolean; session_token?: string } = res ? await res.json().catch(() => ({})) : {}
    if (d.valid && d.session_token) { token.current = d.session_token; setPedirPin(false); return true }
    setAviso(res?.status === 429 ? 'Demasiados intentos. Espera un minuto.' : 'Ese PIN no es correcto.')
    setPedirPin(true)
    return false
  }

  async function abrirCamara() {
    setAviso('')
    if (await conseguirToken()) inputRef.current?.click()
  }

  async function subir(archivos: File[]) {
    if (!archivos.length) return
    const pagos = formaId ? JSON.stringify([{ forma_pago_id: formaId, monto: null }]) : ''
    let hechos = 0, fallos = 0, repetidos = 0, tope = ''
    setSubiendo({ hechos: 0, total: archivos.length })
    // De dos en dos: rapido, sin ahogar el celular.
    let siguiente = 0
    async function trabajador() {
      while (siguiente < archivos.length && !tope) {
        const f = archivos[siguiente++]
        const imagen = await comprimirConTope(f)
        const fd = new FormData()
        fd.append('imagen', imagen, 'ticket.jpg')
        if (pagos) fd.append('pagos', pagos)
        const res = await fetch(`${EDGE_FUNCTIONS_URL}/procesar-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}` }, body: fd }).catch(() => null)
        const d: { recibido?: boolean; duplicado?: boolean; tope?: boolean; error?: string } = res ? await res.json().catch(() => ({})) : {}
        if (res?.ok && d.recibido) hechos++
        else if (d.duplicado) repetidos++
        else if (d.tope) tope = d.error ?? 'Se llegó al tope de tickets.'
        else fallos++
        setSubiendo({ hechos: hechos + repetidos + fallos, total: archivos.length })
      }
    }
    await Promise.all([trabajador(), trabajador()])
    setSubiendo(null)
    if (inputRef.current) inputRef.current.value = ''
    setAviso(tope || [repetidos ? `${repetidos} ya estaban subidos.` : '', fallos ? `${fallos} no se pudieron enviar: revisa tu internet e inténtalo otra vez.` : ''].filter(Boolean).join(' '))
    refrescar()
  }

  const leyendo = tickets.filter(t => t.leyendo).length

  return (
    <div className="space-y-5">
      <Titulo ayuda="Junta tickets de compras que ya sabes que están bien y tómales foto, uno por uno. Con 10 a 30 la IA ya conoce tu negocio. Aquí acepta todo y aprende de eso, así que no subas nada raro.">Sube tus primeros tickets</Titulo>

      {estado.formas.length > 1 && (
        <div className="space-y-2">
          <p className="etiqueta">¿Cómo los pagaste?</p>
          <div className="flex flex-wrap gap-2">
            {estado.formas.map(f => (
              <button key={f.id} type="button" onClick={() => setFormaId(f.id)} aria-pressed={formaId === f.id}
                className={formaId === f.id ? 'btn-opcion' : 'btn-secundario'}>{f.nombre}</button>
            ))}
          </div>
          <p className="nota">Si pagaste unos de una forma y otros de otra, súbelos por grupos.</p>
        </div>
      )}

      {pedirPin && (
        <form onSubmit={e => { e.preventDefault(); abrirCamara() }} className="flex flex-wrap items-center gap-2">
          <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Tu PIN" aria-label="Tu PIN" autoFocus className="campo w-32 px-3 py-2 text-center tracking-[0.2em]" />
          <button type="submit" className="btn-secundario" disabled={pin.length < 4}>Seguir</button>
        </form>
      )}

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => subir(Array.from(e.target.files ?? []))} />
      <button type="button" onClick={abrirCamara} disabled={!!subiendo}
        className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-emerald-700 bg-emerald-950/30 px-4 py-7 transition-colors hover:bg-emerald-950/60 disabled:opacity-60">
        <span className="text-lg font-semibold text-emerald-300">{subiendo ? `Enviando ${subiendo.hechos} de ${subiendo.total}…` : 'Tomar foto o elegir fotos'}</span>
        <span className="text-[13px] text-zinc-400">{subiendo ? 'No cierres esta pantalla' : 'Puedes elegir muchas a la vez'}</span>
      </button>
      {aviso && <p role="alert" className="rounded-lg bg-amber-900 px-3 py-2 text-sm text-amber-300">{aviso}</p>}

      {qr && (
        <details className="hidden rounded-xl border border-zinc-800 px-4 py-3 md:block">
          <summary className="cursor-pointer text-sm font-medium text-zinc-300">¿Las fotos están en tu celular? Escanea este código</summary>
          <div className="mt-3 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Código para abrir en el celular" className="h-36 w-36 rounded-lg bg-white p-1" />
            <p className="text-[13px] leading-relaxed text-zinc-400">Se abre en tu celular; escribes tu PIN y subes. Lo vas a ver llegar aquí abajo.</p>
          </div>
        </details>
      )}

      {tickets.length > 0 && (
        <section aria-live="polite" className="space-y-1">
          <p className="text-sm font-medium text-zinc-300">{cuantos} {cuantos === 1 ? 'ticket subido' : 'tickets subidos'}{leyendo ? ` · la IA está leyendo ${leyendo}` : ''}</p>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {tickets.slice(0, 8).map(t => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {t.leyendo
                  ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" aria-hidden />
                  : <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${t.estado === 'confirmado' ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-zinc-200">{t.leyendo ? 'Leyendo…' : t.comercio ?? 'Nota a mano'}{!t.leyendo && t.renglones ? <span className="text-zinc-500"> · {t.renglones} {t.renglones === 1 ? 'artículo' : 'artículos'}</span> : null}</span>
                {!t.leyendo && <span className="whitespace-nowrap text-zinc-300">{pesos(t.monto)}</span>}
              </li>
            ))}
          </ul>
          {tickets.some(t => t.estado === 'pendiente' && !t.leyendo) && <p className="nota">Los de punto amarillo no se pudieron leer bien: te quedan en Tickets para revisarlos, sin prisa.</p>}
        </section>
      )}

      <Pie onAtras={onAtras}>
        <button onClick={onListo} className={cuantos > 0 ? 'btn-primario px-6' : 'btn-quieto'}>{cuantos > 0 ? 'Ya terminé de subir' : 'Lo hago después'}</button>
      </Pie>
    </div>
  )
}

/** Paso 6: lo que aprendio, para corregir en el momento. Es el mismo Cerebro de siempre. */
function PasoAprendio({ estado, onListo, onAtras }: { estado: Estado; onListo: () => void; onAtras: () => void }) {
  return (
    <div className="space-y-5">
      <Titulo ayuda={estado.tickets ? 'Revisa que cada artículo esté en el grupo correcto. Si uno está mal, cámbialo: de ahí en adelante la IA lo hace bien. No tiene que quedar perfecto: lo puedes corregir cuando quieras en Cerebro.' : 'Todavía no hay tickets. Aquí vas a ver lo que la IA aprenda de ellos.'}>
        Esto aprendió la IA
      </Titulo>
      {estado.tickets > 0 && <VistaCerebro soloArticulos sucursalFija={estado.sucursales.length === 1 ? estado.sucursales[0].id : ''} />}
      <Pie onAtras={onAtras}><button onClick={onListo} className="btn-primario px-6">Continuar</button></Pie>
    </div>
  )
}

/** Paso 7: quien mas sube tickets y como les llega el enlace. Al terminar se apaga el entrenamiento. */
function PasoGerentes({ cuenta, estado, guardar, recargar, onAtras }: {
  cuenta: OpcionesCuenta; estado: Estado; guardar: ReturnType<typeof useOpciones>['guardar']; recargar: () => Promise<unknown>; onAtras: () => void
}) {
  const toast = useToast()
  const confirmar = useConfirm()
  const sucursal = estado.sucursales[0]
  const [nombre, setNombre] = useState('')
  const [pin, setPin] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [qr, setQr] = useState('')
  const enlace = typeof window !== 'undefined' && sucursal ? `${window.location.origin}/sucursal/${sucursal.slug}` : ''

  useEffect(() => { if (enlace) QRCode.toDataURL(enlace, { width: 512, margin: 2 }).then(setQr).catch(() => setQr('')) }, [enlace])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) { toast('Escribe su nombre', 'error'); return }
    if (!/^\d{4,6}$/.test(pin)) { toast('El PIN debe tener de 4 a 6 números', 'error'); return }
    setGuardando(true)
    await ensureFreshSession()
    // Dos personas con el mismo PIN en una sucursal: la app no sabria quien subio el ticket.
    const res = await fetch(`${EDGE_FUNCTIONS_URL}/verificar-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: sucursal.slug, pin }) }).catch(() => null)
    const d: { valid?: boolean } = res ? await res.json().catch(() => ({})) : {}
    if (d.valid) { setGuardando(false); toast('Ese PIN ya lo usa alguien más. Elige otro.', 'error'); return }
    const { error } = await supabase.rpc('admin_guardar_empleado', { p_id: null, p_nombre: nombre.trim(), p_pin: pin, p_activo: true, p_sucursal_id: sucursal.id })
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast(`Listo: ${nombre.trim()} ya puede subir tickets`)
    setNombre(''); setPin('')
    recargar()
  }

  async function terminar() {
    if (!(await confirmar('¿Terminamos?\n\nDesde ahora la IA aprueba sola lo que conoce y te pregunta solo lo raro, en Tickets.', { si: 'Sí, terminar', no: 'Todavía no' }))) return
    setTerminando(true)
    const err = await guardar(cuenta.cuenta_id, { entrenamiento: false })
    if (err) { setTerminando(false); toast('No se pudo guardar: ' + err, 'error'); return }
    sessionStorage.setItem('asistente_visto', '1')
    window.location.href = '/admin/tickets'
  }

  const textoWhats = `Entra aquí para subir los tickets de compras: ${enlace} . Tu PIN te lo doy yo.`

  return (
    <div className="space-y-6">
      <Titulo ayuda="Cada quien tiene su PIN, para saber quién subió cada ticket. Si solo tú subes tickets, sáltate esto.">¿Quién más va a subir tickets?</Titulo>

      {estado.gerentes.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {estado.gerentes.map(g => <li key={g.id} className="px-3 py-2.5 text-[15px] text-zinc-200">{g.nombre}</li>)}
        </ul>
      )}
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[160px] flex-1 space-y-1">
          <span className="etiqueta block">Nombre</span>
          <input value={nombre} onChange={e => setNombre(e.target.value)} className="campo w-full" maxLength={60} autoComplete="off" />
        </label>
        <label className="w-28 space-y-1">
          <span className="etiqueta block">PIN</span>
          <input inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="campo w-full" maxLength={6} autoComplete="off" placeholder="4 a 6" />
        </label>
        <button type="submit" disabled={guardando} className="btn-secundario">{guardando ? 'Guardando…' : 'Agregar'}</button>
      </form>

      <section className="space-y-3 rounded-xl border border-zinc-800 p-4">
        <p className="text-sm font-medium text-zinc-200">Así le llega a tu gente</p>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="Código para subir tickets" className="h-32 w-32 rounded-lg bg-white p-1" />}
          <div className="min-w-[180px] flex-1 space-y-2">
            <p className="text-[13px] leading-relaxed text-zinc-400">Mándales el enlace o pega el código donde compran. Abren, ponen su PIN y toman la foto. Nada que instalar.</p>
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer" className="btn-secundario btn-sm">Mandar por WhatsApp</a>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(enlace); toast('Enlace copiado') }} className="btn-quieto btn-sm">Copiar enlace</button>
              {qr && <a href={qr} download={`qr-${sucursal?.slug}.png`} className="btn-quieto btn-sm">Descargar código</a>}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-xl bg-emerald-950/40 p-4">
        <p className="text-sm font-medium text-emerald-300">Ya casi. De aquí en adelante:</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-zinc-300">
          <li>Tu gente toma la foto y listo.</li>
          <li>La IA aprueba sola lo que ya conoce.</li>
          <li>Lo raro te lo pregunta en <b className="font-medium">Tickets → Por revisar</b>.</li>
        </ul>
      </section>

      <Pie onAtras={onAtras}><button onClick={terminar} disabled={terminando} className="btn-primario px-6">{terminando ? 'Terminando…' : 'Terminar'}</button></Pie>
    </div>
  )
}
