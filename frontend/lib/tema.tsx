'use client'

import { useEffect, useState } from 'react'
import { CLAVE_TEMA as CLAVE } from './tema-script'

// Modo dia / noche. "auto" sigue al celular; "light" o "dark" lo fijan (se guarda en localStorage "tema").
// El script SCRIPT_TEMA (tema-script.ts) corre en <head> antes de pintar, asi no hay parpadeo al abrir.
export type Tema = 'auto' | 'light' | 'dark'

function aplicar(t: Tema) {
  const html = document.documentElement
  if (t === 'auto') delete html.dataset.theme
  else html.dataset.theme = t
  try {
    if (t === 'auto') localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, t)
  } catch { /* modo privado: solo dura esta visita */ }
}

function oscuroAhora(t: Tema) {
  if (t === 'dark') return true
  if (t === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Boton que alterna dia/noche. Muestra a que modo te lleva. */
export function BotonTema({ className = '' }: { className?: string }) {
  const [oscuro, setOscuro] = useState<boolean | null>(null)

  useEffect(() => {
    let t: Tema = 'auto'
    try { const g = localStorage.getItem(CLAVE); if (g === 'light' || g === 'dark') t = g } catch { /* sin storage */ }
    setOscuro(oscuroAhora(t))
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const alCambiar = () => { if (!document.documentElement.dataset.theme) setOscuro(mq.matches) }
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  function alternar() {
    const siguiente = !oscuro
    // Si el modo elegido coincide con el del celular, vuelve a "auto" para seguirlo en adelante.
    const delCelular = window.matchMedia('(prefers-color-scheme: dark)').matches
    aplicar(siguiente === delCelular ? 'auto' : siguiente ? 'dark' : 'light')
    setOscuro(siguiente)
  }

  if (oscuro === null) return <span className={`inline-block h-9 w-9 ${className}`} aria-hidden />
  return (
    <button type="button" onClick={alternar}
      aria-label={oscuro ? 'Cambiar a modo dia' : 'Cambiar a modo noche'}
      title={oscuro ? 'Modo dia' : 'Modo noche'}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 ${className}`}>
      {oscuro ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  )
}
