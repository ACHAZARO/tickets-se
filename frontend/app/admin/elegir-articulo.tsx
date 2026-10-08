'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'

// Campo para NOMBRAR un articulo/insumo: mientras escribes sugiere los que ya existen. Si eliges uno existente
// el campo se ve como pastilla verde ("ya existe"); si el nombre es nuevo, abajo avisa que se creara.
// La lista va en el flujo (empuja el contenido) para que no la recorten tarjetas con overflow-hidden.

// oculta: articulo ocasional o no autorizado (094). No se sugiere al escribir, pero si escribes su nombre exacto se reconoce.
export interface OpcionArticulo { id: string; nombre: string; detalle?: string; oculta?: boolean }

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function ElegirArticulo({
  opciones, valorInicial = '', onCambio, name, placeholder, ariaLabel, notaNuevo, notaExistente, max = 8,
}: {
  opciones: OpcionArticulo[]
  valorInicial?: string
  onCambio: (texto: string, elegida: OpcionArticulo | null) => void
  name?: string
  placeholder?: string
  ariaLabel: string
  notaNuevo?: (texto: string) => ReactNode    // aviso cuando el nombre no existe
  notaExistente?: (o: OpcionArticulo) => ReactNode
  max?: number
}) {
  const idLista = useId()
  const [texto, setTexto] = useState(valorInicial)
  const [abierta, setAbierta] = useState(false)
  const [activa, setActiva] = useState(0)

  const elegida = useMemo(() => {
    const t = normal(texto)
    return t ? opciones.find(o => normal(o.nombre) === t) ?? null : null
  }, [texto, opciones])

  const sugerencias = useMemo(() => {
    const t = normal(texto)
    if (!t) return []
    const empiezan: OpcionArticulo[] = [], contienen: OpcionArticulo[] = []
    for (const o of opciones) {
      const n = normal(o.nombre)
      if (n === t || o.oculta) continue
      if (n.startsWith(t)) empiezan.push(o)
      else if (n.includes(t)) contienen.push(o)
    }
    return [...empiezan, ...contienen].slice(0, max)
  }, [texto, opciones, max])

  function cambiar(v: string) {
    setTexto(v)
    setAbierta(true)
    setActiva(0)
    const t = normal(v)
    onCambio(v, t ? opciones.find(o => normal(o.nombre) === t) ?? null : null)
  }
  function elegir(o: OpcionArticulo) {
    setTexto(o.nombre)
    setAbierta(false)
    onCambio(o.nombre, o)
  }

  // Resalta lo que coincide con lo escrito (sin acentos ni mayusculas).
  const resaltar = (nombre: string) => {
    const i = normal(nombre).indexOf(normal(texto))
    if (i < 0 || !texto.trim()) return nombre
    const largo = normal(texto).length
    return <>{nombre.slice(0, i)}<b className="font-semibold text-zinc-100">{nombre.slice(i, i + largo)}</b>{nombre.slice(i + largo)}</>
  }

  const mostrarLista = abierta && sugerencias.length > 0
  return (
    <div className="space-y-1.5">
      <div className="relative">
        {elegida && (
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-300">
            <path d="m5 12 5 5L20 7" />
          </svg>
        )}
        <input
          name={name}
          value={texto}
          onChange={e => cambiar(e.target.value)}
          onFocus={() => setAbierta(true)}
          onBlur={() => setAbierta(false)}
          onKeyDown={e => {
            if (!mostrarLista) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiva(a => Math.min(a + 1, sugerencias.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); elegir(sugerencias[activa]) }
            else if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setAbierta(false) }
          }}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={mostrarLista}
          aria-controls={idLista}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          className={`campo w-full py-1.5 transition-colors ${elegida
            ? 'border-emerald-800 bg-emerald-900 pl-8 pr-20 font-medium text-emerald-200 focus:border-emerald-600'
            : ''}`}
        />
        {elegida && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-300">ya existe</span>
        )}
      </div>

      {mostrarLista && (
        <ul id={idLista} role="listbox" aria-label="Artículos que ya existen"
          className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-sm">
          {sugerencias.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === activa}
              onMouseDown={e => { e.preventDefault(); elegir(o) }}
              onMouseEnter={() => setActiva(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm transition-colors ${i === activa ? 'bg-zinc-800' : ''}`}>
              <span className="min-w-0 text-zinc-300 break-words">{resaltar(o.nombre)}</span>
              {o.detalle && <span className="shrink-0 text-xs text-zinc-500">{o.detalle}</span>}
            </li>
          ))}
        </ul>
      )}

      {elegida && notaExistente && <p className="text-[13px] text-emerald-400">{notaExistente(elegida)}</p>}
      {!elegida && texto.trim() && notaNuevo && (
        <p className="text-[13px] text-zinc-400">
          {notaNuevo(texto.trim())}
        </p>
      )}
    </div>
  )
}
