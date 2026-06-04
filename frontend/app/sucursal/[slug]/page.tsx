'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface PageProps {
  params: { slug: string }
}

type PinState = 'idle' | 'loading' | 'error'

const EDGE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL

export default function PinPage({ params }: PageProps) {
  const { slug } = params
  const router = useRouter()

  const [sucursalNombre, setSucursalNombre] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [pin, setPin] = useState<string>('')
  const [state, setState] = useState<PinState>('idle')
  const [shake, setShake] = useState(false)

  // Fetch sucursal name
  useEffect(() => {
    async function fetchSucursal() {
      const { data, error } = await supabase
        .from('sucursales')
        .select('nombre')
        .eq('slug', slug)
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        setSucursalNombre(data.nombre)
      }
    }
    fetchSucursal()
  }, [slug])

  const triggerShake = useCallback(() => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }, [])

  const handleKey = useCallback(
    (value: string) => {
      if (state === 'loading') return

      if (value === 'del') {
        setPin((prev) => prev.slice(0, -1))
        return
      }

      if (pin.length >= 6) return
      setPin((prev) => prev + value)
    },
    [pin, state]
  )

  const handleConfirm = useCallback(async () => {
    if (pin.length < 4 || state === 'loading') return

    setState('loading')

    try {
      const res = await fetch(`${EDGE_FUNCTIONS_URL}/verificar-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, pin }),
      })

      const data = await res.json().catch(() => ({}))
      // Solo entra si el PIN es VALIDO y vino el token de sesion.
      // verificar-pin responde HTTP 200 con {valid:false} cuando el PIN es
      // incorrecto, asi que NO basta con res.ok.
      if (res.ok && data.valid === true && data.session_token) {
        sessionStorage.setItem(
          `auth_${slug}`,
          JSON.stringify({ empleadoId: data.empleado_id, sessionToken: data.session_token, timestamp: Date.now() })
        )
        router.push(`/sucursal/${slug}/subir`)
      } else {
        // PIN incorrecto o sucursal invalida
        setState('error')
        setPin('')
        triggerShake()
        setTimeout(() => setState('idle'), 1500)
      }
    } catch {
      setState('error')
      setPin('')
      triggerShake()
      setTimeout(() => setState('idle'), 1500)
    }
  }, [pin, slug, state, router, triggerShake])

  // Auto-confirm when PIN reaches max length (6 digits) or 4+ on confirm tap
  // No auto-submit — user must tap confirmar

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']

  if (notFound) {
    return (
      <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="text-center">
          <p className="text-4xl">404</p>
          <p className="mt-2 text-zinc-400">Sucursal no encontrada</p>
          <p className="mt-1 font-mono text-sm text-zinc-600">{slug}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-between px-4 pb-8 pt-12 safe-top safe-bottom">
      {/* Header */}
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Sucursal</p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-100">
          {sucursalNombre ?? (
            <span className="inline-block h-5 w-32 animate-pulse rounded bg-zinc-800" />
          )}
        </h1>
      </div>

      {/* PIN dots + status */}
      <div className="flex flex-col items-center gap-6">
        <p className="text-sm text-zinc-400">Ingresa tu PIN</p>

        {/* Dots */}
        <div
          className={`flex gap-4 ${shake ? 'animate-shake' : ''}`}
          aria-label={`PIN ingresado: ${pin.length} dígitos`}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                i < pin.length
                  ? state === 'error'
                    ? 'border-red-500 bg-red-500'
                    : 'border-zinc-100 bg-zinc-100'
                  : 'border-zinc-600 bg-transparent'
              }`}
            />
          ))}
        </div>

        {state === 'error' && (
          <p className="text-sm font-medium text-red-400">PIN incorrecto. Intenta de nuevo.</p>
        )}
      </div>

      {/* Numeric keypad */}
      <div className="w-full max-w-xs">
        <div className="grid grid-cols-3 gap-3">
          {keys.map((key) => {
            const isDel = key === 'del'
            const isOk = key === 'ok'
            const isDisabled =
              state === 'loading' ||
              (isOk && pin.length < 4) ||
              (isDel && pin.length === 0)

            return (
              <button
                key={key}
                onClick={() => {
                  if (isOk) {
                    handleConfirm()
                  } else {
                    handleKey(key)
                  }
                }}
                disabled={isDisabled}
                aria-label={isDel ? 'Borrar' : isOk ? 'Confirmar' : key}
                className={`
                  flex min-h-[72px] items-center justify-center rounded-2xl text-lg font-medium
                  transition-all duration-100 active:scale-95
                  ${
                    isOk
                      ? 'bg-zinc-100 text-zinc-900 disabled:bg-zinc-800 disabled:text-zinc-500'
                      : isDel
                      ? 'bg-zinc-800 text-zinc-300 disabled:opacity-30'
                      : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-600'
                  }
                  disabled:cursor-not-allowed
                `}
              >
                {isDel ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
                    />
                  </svg>
                ) : isOk ? (
                  state === 'loading' ? (
                    <svg
                      className="h-5 w-5 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8z"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )
                ) : (
                  key
                )}
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
