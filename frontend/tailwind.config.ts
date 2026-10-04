import type { Config } from 'tailwindcss'

// Paleta "Pistache": cada tono lee una variable CSS (ver app/globals.css), asi el modo dia/noche cambia solo.
const escala = (nombre: string) => Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(n => [n, `rgb(var(--c-${nombre}-${n}) / <alpha-value>)`]),
)

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        zinc: escala('zinc'),
        red: escala('red'),
        amber: escala('amber'),
        emerald: escala('emerald'),
        blue: escala('blue'),
        sky: escala('blue'),
        orange: escala('amber'),
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-6px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
      },
    },
  },
  plugins: [],
}

export default config
