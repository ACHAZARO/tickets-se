'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import { SucursalProvider, SucursalSelector } from '@/lib/sucursal-context'
import { BotonTema } from '@/lib/tema'
import { AdminUIProvider } from './ui'
import { CerebroBadge } from './unificar'

// Menu en 3 grupos para saber donde vive cada cosa: lo que hay que REVISAR, los NUMEROS y los AJUSTES.
const GRUPOS = [
  { nombre: 'Revisar', paginas: [
    { href: '/admin/tickets', label: 'Tickets' },
    { href: '/admin/cerebro', label: 'Cerebro' },
  ] },
  { nombre: 'Números', paginas: [
    { href: '/admin/dashboard', label: 'Gasto' },
    { href: '/admin/precios', label: 'Precios' },
    { href: '/admin/inventario', label: 'Entradas' },
    { href: '/admin/stock', label: 'Stock' },
  ] },
  { nombre: 'Ajustes', paginas: [
    { href: '/admin/catalogo', label: 'Catálogo' },
    { href: '/admin/comercios', label: 'Comercios' },
    { href: '/admin/sucursales', label: 'Sucursales' },
  ] },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && pathname !== '/admin/login') {
        router.replace('/admin/login')
      } else {
        setUser(session?.user ?? null)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && pathname !== '/admin/login') {
        router.replace('/admin/login')
      }
      setUser(session?.user ?? null)
    })

    // Al volver a la pestana (tras dejarla horas en segundo plano) refrescamos la
    // sesion: getSession() renueva el token si vencio, evitando que el primer
    // "Confirmar" o "Guardar y ensenar" falle con 401 / bloqueo RLS silencioso.
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') supabase.auth.getSession()
    }
    document.addEventListener('visibilitychange', refreshOnVisible)
    window.addEventListener('focus', refreshOnVisible)

    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', refreshOnVisible)
      window.removeEventListener('focus', refreshOnVisible)
    }
  }, [router, pathname])

  if (loading) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
      </main>
    )
  }

  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  if (!user) return null

  const grupoActivo = GRUPOS.find(g => g.paginas.some(p => pathname.startsWith(p.href))) ?? GRUPOS[0]

  return (
    <SucursalProvider>
    <AdminUIProvider>
    <div className="min-h-screen min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur safe-top">
        <div className="mx-auto max-w-6xl px-4 pt-3 space-y-3 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold tracking-tight text-zinc-100">Tickets</span>
            <div className="flex items-center gap-1">
              <SucursalSelector />
              <BotonTema />
              <button
                onClick={() => supabase.auth.signOut().then(() => router.replace('/admin/login'))}
                className="btn-quieto btn-sm"
              >
                Salir
              </button>
            </div>
          </div>

          {/* Grupo arriba, sus pantallas abajo */}
          <nav aria-label="Secciones" className="space-y-1.5">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              {GRUPOS.map(g => {
                const activo = g === grupoActivo
                return (
                  <Link key={g.nombre} href={g.paginas[0].href} aria-current={activo ? 'true' : undefined}
                    className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                      activo ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-100'}`}>
                    {g.nombre}
                    {g.nombre === 'Revisar' && !activo && <CerebroBadge pathname={pathname} />}
                  </Link>
                )
              })}
            </div>
            <div className="flex gap-1 overflow-x-auto scrollbar-none -mx-1 px-1">
              {grupoActivo.paginas.map(item => {
                const activo = pathname.startsWith(item.href)
                return (
                  <Link key={item.href} href={item.href} aria-current={activo ? 'page' : undefined}
                    className={`relative shrink-0 whitespace-nowrap px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors ${
                      activo ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                    {item.label}
                    {item.href === '/admin/cerebro' && <CerebroBadge pathname={pathname} />}
                    {activo && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-emerald-500" />}
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 md:px-6 md:py-6 max-w-6xl mx-auto w-full">
        {children}
      </main>
    </div>
    </AdminUIProvider>
    </SucursalProvider>
  )
}
