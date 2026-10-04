'use client'

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

// Sistema compartido de toasts + confirmacion modal para el admin.
// Reemplaza alert()/confirm() nativos por UI consistente con el tema.

type ToastType = 'ok' | 'error' | 'info'
interface Toast { id: number; msg: string; type: ToastType }
interface ConfirmState { msg: string; danger: boolean; resolve: (v: boolean) => void }

interface Ctx {
  toast: (msg: string, type?: ToastType) => void
  confirm: (msg: string, opts?: { danger?: boolean }) => Promise<boolean>
}

const UICtx = createContext<Ctx>({ toast: () => {}, confirm: async () => false })
export function useToast() { return useContext(UICtx).toast }
export function useConfirm() { return useContext(UICtx).confirm }

export function AdminUIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const idRef = useRef(0)

  const toast = useCallback((msg: string, type: ToastType = 'ok') => {
    const id = ++idRef.current
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const confirm = useCallback((msg: string, opts?: { danger?: boolean }) =>
    new Promise<boolean>(resolve => setConfirmState({ msg, danger: !!opts?.danger, resolve })), [])

  function closeConfirm(v: boolean) {
    confirmState?.resolve(v)
    setConfirmState(null)
  }

  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[92vw]">
        {toasts.map(t => (
          <div key={t.id}
            role="status"
            className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg border animate-[fadeIn_.15s_ease] ${
              t.type === 'error' ? 'bg-red-900 border-red-800 text-red-300'
              : t.type === 'info' ? 'bg-zinc-900 border-zinc-700 text-zinc-100'
              : 'bg-emerald-900 border-emerald-800 text-emerald-300'}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm p-4" onClick={() => closeConfirm(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] leading-relaxed text-zinc-100 whitespace-pre-line">{confirmState.msg}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => closeConfirm(false)} autoFocus={confirmState.danger} className="btn-quieto">Atrás</button>
              <button onClick={() => closeConfirm(true)} autoFocus={!confirmState.danger}
                className={confirmState.danger ? 'btn-peligro-lleno' : 'btn-primario'}>
                {confirmState.danger ? 'Sí, continuar' : 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </UICtx.Provider>
  )
}

/**
 * Interruptor si/no con su etiqueta: se ve que se puede tocar y el title explica que hace.
 * Usar en vez de "chips" clicables (Activo/Inactivo) que no parecen botones.
 */
export function Interruptor({ encendido, onCambiar, etiqueta, ayuda, compacto = false }: {
  encendido: boolean; onCambiar: () => void; etiqueta: string; ayuda: string; compacto?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={encendido} onClick={onCambiar} title={ayuda}
      className={`group inline-flex items-center gap-2 rounded-lg ${compacto ? 'px-1.5 py-1' : 'px-2 py-1.5'} text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800`}>
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${encendido ? 'bg-emerald-600' : 'bg-zinc-700'}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${encendido ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      {etiqueta}
    </button>
  )
}

/** Consejo corto en azul (focito): ayuda a decidir bien sin llenar la pantalla de instrucciones. */
export function Consejo({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-blue-900 px-3 py-2 text-[13px] leading-relaxed text-blue-300">
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" />
      </svg>
      <span>{children}</span>
    </p>
  )
}
