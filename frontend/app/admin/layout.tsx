'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import { SucursalProvider, SucursalSelector } from '@/lib/sucursal-context'
import { AdminUIProvider } from './ui'

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Gasto' },
  { href: '/admin/tickets', label: 'Tickets' },
  { href: '/admin/cerebro', label: 'Cerebro' },
  { href: '/admin/precios', label: 'Precios' },
  { href: '/admin/inventario', label: 'Entradas' },
  { href: '/admin/catalogo', label: 'Catalogo' },
  { href: '/admin/comercios', label: 'Comercios' },
  { href: '/admin/sucursales', label: 'Sucursales' },
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

    return () => subscription.unsubscribe()
  }, [router, pathname])

  if (loading) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
      </main>
    )
  }

  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  if (!user) return null

  return (
    <SucursalProvider>
    <AdminUIProvider>
    <div className="min-h-screen min-h-[100dvh] flex flex-col">
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-6 flex-wrap">
          <h1 className="text-base font-semibold text-zinc-100">Tickets SE</h1>
          <nav className="flex gap-1 overflow-x-auto max-w-full -mx-1 px-1 scrollbar-none">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  pathname.startsWith(item.href)
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <SucursalSelector />
          <button
            onClick={() => supabase.auth.signOut().then(() => router.replace('/admin/login'))}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Salir
          </button>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
        {children}
      </main>
    </div>
    </AdminUIProvider>
    </SucursalProvider>
  )
}
