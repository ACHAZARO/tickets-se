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
              <button onClick={() => closeConfirm(false)} autoFocus={confirmState.danger} className="btn-quieto">Cancelar</button>
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
