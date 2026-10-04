# DESIGN.md — Tickets SE (paleta "Pistache")

Rediseno 2026-10. Fuente de verdad del estilo. Producto (register: product). Ver `PRODUCT.md`.

## Tema dia / noche
- Colores en `frontend/app/globals.css` como variables `--c-<color>-<tono>`; `tailwind.config.ts` hace que
  `zinc`, `red`, `amber`, `emerald`, `blue` (y alias `sky`=blue, `orange`=amber) lean esas variables.
- **Se siguen usando clases Tailwind normales** (`bg-zinc-900`, `text-zinc-500`...). En modo dia la escala de
  grises se invierte sola: `zinc-950` = fondo, `zinc-900` = tarjeta, `zinc-800` = campo/control, `zinc-700` = borde,
  `zinc-500` = texto secundario, `zinc-100` = texto principal. NO usar `white`/`black` para superficies ni texto
  (excepcion: `text-white` sobre rellenos `*-600`, y el fondo blanco del QR).
- Modo: sigue al celular; `BotonTema` (`lib/tema.tsx`) lo fija en `<html data-theme>`.

## Superficies
| Rol | Clase |
|---|---|
| Fondo de pagina | `bg-zinc-950` (lo pone `body`) |
| Tarjeta / panel | `.tarjeta` = `rounded-xl border border-zinc-800 bg-zinc-900` |
| Zona dentro de tarjeta | `bg-zinc-800/50 rounded-lg` (sin borde; nunca tarjeta dentro de tarjeta con borde) |
| Campo de formulario | `.campo` (input/select/textarea) |
| Modal | `bg-zinc-900 border-zinc-800 rounded-2xl` sobre `bg-zinc-950/70 backdrop-blur-sm` |

Radios: controles `rounded-lg`, tarjetas `rounded-xl`, modales `rounded-2xl`. Nada mayor.

## Texto
| Rol | Clase |
|---|---|
| Titulo de pantalla | `text-xl font-semibold tracking-tight text-zinc-100` |
| Titulo de seccion | `text-base font-semibold text-zinc-100` (sentence case, SIN mayusculas ni tracking) |
| Texto normal / dato | `text-sm text-zinc-100` (o `text-zinc-200`) |
| Secundario / ayuda | `.nota` = `text-[13px] text-zinc-500` |
| Etiqueta de campo | `.etiqueta` = `text-[13px] font-medium text-zinc-400` |
| Minimo absoluto | `text-xs` (12 px) solo para chips y metadatos; **prohibido** `text-[10px]` y `text-[11px]` |

- `text-zinc-600` NO es texto legible (es para iconos/deshabilitado). Texto -> minimo `text-zinc-500`.
- Prohibido el "eyebrow": `uppercase tracking-widest` encima de secciones. Usar titulo de seccion normal.
- Numeros ya salen con cifras tabulares (body tiene `tnum`).

## Botones (jerarquia) — clases en globals.css
| Nivel | Clase | Cuando |
|---|---|---|
| 1 Principal | `.btn-primario` | LA accion de la tarjeta/pantalla (Confirmar, Guardar, Unificar). Una sola por grupo |
| 2 Secundario | `.btn-secundario` | Otra accion valida (Mismo insumo, Editar, Exportar) |
| 3 Ver | `.btn-texto` | Ver / abrir / consultar (Ver tickets, Ver foto). Texto verde |
| 4 Quieto | `.btn-quieto` | Cancelar, cerrar, descartar, "No son iguales", Salir |
| Peligro | `.btn-peligro` | Borrar, rechazar (texto terracota) |
| Peligro final | `.btn-peligro-lleno` | Solo en el "Si, borrar" de una confirmacion |

Agregar `btn-sm` en tarjetas/renglones densos. Botones de icono (x de cerrar): `btn-quieto` con `aria-label`.
Los colores de relleno sueltos (`bg-sky-600`, `bg-emerald-700`, `bg-amber-600`...) en botones se reemplazan por estas clases.

## Color con significado
| Significado | Chip | Texto |
|---|---|---|
| Bien / confirmado / accion positiva | `.chip-bien` | `text-emerald-400` |
| Por revisar / alerta / pendiente | `.chip-revisar` | `text-amber-400` |
| Rechazado / fraude / error | `.chip-mal` | `text-red-400` |
| Informativo | `.chip-info` | `text-blue-400` |
| Neutro | `.chip-neutro` | `text-zinc-400` |

Avisos en bloque: `rounded-lg bg-<color>-900 text-<color>-300 px-3 py-2 text-sm` (sin borde lateral grueso, prohibido).

## Tablas
Encabezado `text-[13px] font-medium text-zinc-500 border-b border-zinc-800`; filas `border-b border-zinc-800/60`,
hover `hover:bg-zinc-800/40`; numeros alineados a la derecha.

## Estados
- Cargando: spinner `border-zinc-700 border-t-emerald-500` o esqueleto `bg-zinc-800 animate-pulse rounded`.
- Vacio: una linea clara de que hacer, no "nada aqui".
- Error: `text-red-400 text-sm`, dice que paso y que hacer.

## Movimiento
150 ms ease-out en botones (ya en `.btn`), `active:scale-[0.98]`. Respeta reduced-motion (global).
