'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Conteo de inventario del GERENTE (celular). Solo aparece si su negocio lo permite (Configuracion > Opciones).
// Lista armada por la edge function conteo-gerente con lo que se ha comprado en la sucursal; guarda el conteo de hoy.
const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

interface Articulo {
  clave: string
  nombre: string
  unidad: string
  unidades: string[]
  ultimo: { fecha: string; cantidad: number; unidad: string | null } | null
}

const num = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fechaLarga = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

export default function ConteoGerentePage({ params }: { params: { slug: string } }) {
  const { slug } = params
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'apagado' | 'error' | 'guardado'>('cargando')
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [fecha, setFecha] = useState('')
  const [captura, setCaptura] = useState<Record<string, { cantidad: string; unidad: string }>>({})
  const [buscar, setBuscar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [guardados, setGuardados] = useState(0)

  // Misma sesion del PIN que la pantalla de subir tickets (30 min).
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(`auth_${slug}`) ?? 'null')
      if (!s?.sessionToken || Date.now() - s.timestamp > 30 * 60 * 1000) { router.replace(`/sucursal/${slug}`); return }
      setToken(s.sessionToken)
    } catch { router.replace(`/sucursal/${slug}`) }
  }, [slug, router])

  useEffect(() => {
    if (!token) return
    fetch(`${EDGE_FUNCTIONS_URL}/conteo-gerente`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (r.status === 401) { sessionStorage.removeItem(`auth_${slug}`); router.replace(`/sucursal/${slug}`); return }
        const d = await r.json().catch(() => null)
        if (!r.ok || !d) { setEstado('error'); return }
        if (!d.habilitado) { setEstado('apagado'); return }
        setArticulos(d.articulos as Articulo[])
        setFecha(d.fecha)
        setEstado('listo')
      })
      .catch(() => setEstado('error'))
  }, [token, slug, router])

  const capturados = Object.values(captura).filter(c => c.cantidad.trim() !== '').length

  async function guardar() {
    setError('')
    const renglones = Object.entries(captura)
      .filter(([, c]) => c.cantidad.trim() !== '')
      .map(([clave, c]) => ({ clave, cantidad: Number(c.cantidad), unidad: c.unidad }))
    if (renglones.length === 0) { setError('Escribe al menos una cantidad.'); return }
    if (renglones.some(r => !Number.isFinite(r.cantidad) || r.cantidad < 0)) { setError('Revisa las cantidades: solo números de 0 en adelante.'); return }
    setGuardando(true)
    try {
      const r = await fetch(`${EDGE_FUNCTIONS_URL}/conteo-gerente`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ renglones }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { setError('Tu sesión venció. Vuelve a entrar con tu PIN; lo capturado se perderá.'); return }
      if (!r.ok) { setError(d.error ?? 'No se pudo guardar. Intenta de nuevo.'); return }
      setGuardados(d.guardados ?? renglones.length)
      setEstado('guardado')
    } catch {
      setError('Sin conexión. Revisa tu internet e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const volver = () => router.push(`/sucursal/${slug}/subir`)
  const lista = articulos.filter(a => !buscar || a.nombre.toLowerCase().includes(buscar.toLowerCase()))

  return (
    <main className="mx-auto flex min-h-screen min-h-[100dvh] max-w-lg flex-col px-4 pb-28 pt-8 safe-top">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={volver} className="btn-quieto h-11 w-11 px-0" aria-label="Volver">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Contar inventario</h1>
          {fecha && <p className="text-xs text-zinc-500">Conteo del {fechaLarga(fecha)}</p>}
        </div>
      </div>

      {estado === 'cargando' && (
        <div className="flex flex-1 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" /></div>
      )}
      {estado === 'apagado' && (
        <div className="tarjeta space-y-3 p-5 text-center">
          <p className="text-sm text-zinc-300">El conteo desde el celular no está activado para tu negocio.</p>
          <button onClick={volver} className="btn-primario w-full py-3">Volver</button>
        </div>
      )}
      {estado === 'error' && (
        <div className="tarjeta space-y-3 p-5 text-center">
          <p className="text-sm text-red-400">No se pudo cargar la lista. Revisa tu internet.</p>
          <button onClick={() => location.reload()} className="btn-primario w-full py-3">Intentar de nuevo</button>
        </div>
      )}
      {estado === 'guardado' && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-900">
            <svg className="h-8 w-8 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12 5 5L20 7" /></svg>
          </div>
          <p className="text-lg font-semibold text-zinc-100">Conteo guardado</p>
          <p className="nota mt-1">{guardados} {guardados === 1 ? 'artículo' : 'artículos'}. Gracias.</p>
          <button onClick={volver} className="btn-primario mt-8 w-full max-w-xs py-3.5 text-base">Listo</button>
        </div>
      )}

      {estado === 'listo' && (
        <>
          <p className="mb-3 rounded-lg bg-blue-900 px-3 py-2 text-[13px] leading-relaxed text-blue-300">
            Cuenta lo que hay en físico. Si algo ya no hay, pon 0. Lo que dejes vacío no se cuenta.
          </p>
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar artículo…" aria-label="Buscar artículo"
            className="campo mb-3 w-full py-3 text-base" />
          {articulos.length === 0 ? (
            <p className="tarjeta p-5 text-sm text-zinc-400">Aún no hay artículos comprados en tu sucursal.</p>
          ) : (
            <div className="tarjeta divide-y divide-zinc-800/60">
              {lista.map(a => {
                const c = captura[a.clave] ?? { cantidad: '', unidad: a.unidades[0] ?? a.unidad }
                return (
                  <div key={a.clave} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] text-zinc-100 break-words">{a.nombre}</p>
                      {a.ultimo && <p className="text-xs text-zinc-500">Último: {num(a.ultimo.cantidad)} {a.ultimo.unidad ?? ''}</p>}
                    </div>
                    <input type="number" inputMode="decimal" min={0} value={c.cantidad} placeholder="0" aria-label={`Cuánto hay de ${a.nombre}`}
                      onChange={e => setCaptura(cs => ({ ...cs, [a.clave]: { ...c, cantidad: e.target.value } }))}
                      className="campo w-24 py-2.5 text-right text-base" />
                    {a.unidades.length > 1 ? (
                      <select value={c.unidad} aria-label={`Unidad de ${a.nombre}`}
                        onChange={e => setCaptura(cs => ({ ...cs, [a.clave]: { ...c, unidad: e.target.value } }))}
                        className="campo w-16 px-1.5 py-2.5 text-base">
                        {a.unidades.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    ) : <span className="w-16 text-center text-sm text-zinc-400">{a.unidad}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Barra fija abajo: siempre a la mano */}
          <div className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur safe-bottom">
            <div className="mx-auto max-w-lg space-y-2">
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button onClick={guardar} disabled={guardando || capturados === 0} className="btn-primario w-full py-3.5 text-base">
                {guardando ? 'Guardando…' : capturados === 0 ? 'Escribe lo que hay' : `Guardar conteo (${capturados})`}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
