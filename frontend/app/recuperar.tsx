'use client'

import { useEffect } from 'react'

// El enlace de "Olvide mi contrasena" puede caer en la pagina de inicio (segun la configuracion de Supabase): se manda a poner la nueva.
export function RedirigirRecuperacion() {
  useEffect(() => {
    if (window.location.hash.includes('type=recovery') && !window.location.pathname.startsWith('/admin/nueva-clave')) {
      window.location.replace('/admin/nueva-clave' + window.location.hash)
    }
  }, [])
  return null
}
