import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SCRIPT_TEMA } from '@/lib/tema-script'

export const metadata: Metadata = {
  title: 'Revisión de Tickets',
  description: 'Sistema de captura de tickets de gastos operacionales',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tickets',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F5EB' },
    { media: '(prefers-color-scheme: dark)', color: '#151912' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen min-h-[100dvh]">
        {children}
      </body>
    </html>
  )
}
