import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {/* Logo / Icon */}
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-800">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-zinc-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-100">
          Revisión de Tickets
        </h1>
        <p className="mb-10 text-sm text-zinc-400">
          Escanea el código QR de tu sucursal para comenzar, o ingresa el slug directamente.
        </p>

        {/* Direct slug entry hint */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-left">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">
            URL de acceso
          </p>
          <p className="font-mono text-sm text-zinc-300">
            /sucursal/<span className="text-zinc-500">[slug]</span>
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            Cada sucursal tiene su propio enlace único. Usa el QR asignado a tu local.
          </p>
        </div>

        <p className="mt-8 text-xs text-zinc-600">
          Sistema interno &mdash; solo personal autorizado
        </p>
      </div>
    </main>
  )
}
