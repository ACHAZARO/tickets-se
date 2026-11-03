// Tickets faltantes: el reporte de caja del punto de venta contra los tickets subidos. Sin nada propio de un negocio: las columnas se
// reconocen por nombre y lo que no lleva ticket lo dice el dueno una vez (queda en cuenta_opciones.conceptos_sin_ticket).

const quitarAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Lee un CSV con comillas y comas o punto y coma. */
export function leerCsv(texto) {
  const limpio = String(texto ?? '').replace(/^﻿/, '')
  const primera = limpio.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ','
  const filas = []
  let fila = [], campo = '', comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) { fila.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some(x => x.trim() !== '')) filas.push(fila)
      fila = []
    } else campo += c
  }
  fila.push(campo)
  if (fila.some(x => x.trim() !== '')) filas.push(fila)
  return filas
}

/** "30/9/26 20:58", "2026-09-30", "30-09-2026" -> { fecha: 'AAAA-MM-DD', hora }. El dia va primero (Mexico). */
export function leerFecha(valor) {
  const s = String(valor ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2}))?/.exec(s)
  if (m) return { fecha: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, hora: m[4] ?? null }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T,]+(\d{1,2}:\d{2}))?/.exec(s)
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3]
    return { fecha: `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, hora: m[4] ?? null }
  }
  return null
}

function leerMonto(valor) {
  const n = Number(String(valor ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const COLUMNAS = {
  fecha: ['fecha', 'date', 'dia'],
  concepto: ['comentario', 'concepto', 'descripcion', 'detalle', 'nota', 'motivo'],
  monto: ['cantidad', 'monto', 'importe', 'total', 'valor'],
  tipo: ['tipo', 'movimiento'],
  empleado: ['empleado', 'cajero', 'usuario'],
  cierre: ['numero del cierre de caja', 'cierre', 'corte'],
  tienda: ['tienda', 'sucursal', 'store'],
}

/** Filas del reporte -> salidas de caja. Devuelve { salidas, entradasIgnoradas, error }. */
export function salidasDeReporte(filas) {
  if (!filas?.length) return { salidas: [], entradasIgnoradas: 0, error: 'El archivo está vacío.' }
  const enc = filas[0].map(quitarAcentos)
  const col = {}
  for (const [k, nombres] of Object.entries(COLUMNAS)) {
    col[k] = enc.findIndex(e => nombres.some(n => e === n))
    if (col[k] < 0) col[k] = enc.findIndex(e => nombres.some(n => e.includes(n)))
  }
  if (col.fecha < 0 || col.monto < 0) return { salidas: [], entradasIgnoradas: 0, error: 'No encontré las columnas de fecha y cantidad. ¿Es el reporte de pagos de caja?' }
  const salidas = []
  const vistas = new Map()
  let entradasIgnoradas = 0
  for (const f of filas.slice(1)) {
    const tipo = col.tipo >= 0 ? quitarAcentos(f[col.tipo]) : ''
    if (tipo && /entrada|ingreso|deposit/.test(tipo)) { entradasIgnoradas++; continue }
    const fecha = leerFecha(f[col.fecha])
    const monto = leerMonto(f[col.monto])
    if (!fecha || monto === null || monto === 0) continue
    const concepto = col.concepto >= 0 ? String(f[col.concepto] ?? '').trim() : ''
    const hora = fecha.hora
    const cierre = col.cierre >= 0 ? String(f[col.cierre] ?? '').trim() : ''
    const tienda = col.tienda >= 0 ? String(f[col.tienda] ?? '').trim() || null : null
    // La misma salida escrita igual dos veces (un reporte sin hora) son dos salidas; subir el reporte otra vez da las mismas huellas.
    const base = [fecha.fecha, hora ?? '', quitarAcentos(concepto), Math.abs(monto).toFixed(2), cierre, quitarAcentos(tienda)].join('|')
    const vez = (vistas.get(base) ?? 0) + 1
    vistas.set(base, vez)
    salidas.push({
      fecha: fecha.fecha, hora, concepto, monto: Math.abs(monto),
      empleado: col.empleado >= 0 ? String(f[col.empleado] ?? '').trim() || null : null,
      huella: vez > 1 ? `${base}|${vez}` : base,
      tienda,
    })
  }
  if (!salidas.length) return { salidas, entradasIgnoradas, error: 'No encontré salidas de dinero en ese archivo.' }
  return { salidas, entradasIgnoradas, error: null }
}

const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5)
const parecido = (a, b) => Math.abs(a - b) <= Math.max(1.5, b * 0.005)
// Una suma de varios papeles tiene que dar justa: entre muchos tickets, casi cualquier cantidad se arma por casualidad.
const justo = (a, b) => Math.abs(a - b) <= 1.5

/** Lo que seguro no es una compra: "cambio" solo, pero "cambio de aceite" o "anticipo gas" si se preguntan. El dueno puede decir otras con un toque. */
const SIN_TICKET_COMUN = /\b(propinas?|bonos?|nominas?|sueldos?|quincenas?|aguinaldos?|prestamos?|turnos?)\b|^(sobrante|faltante)s?$|^(cambio|fondo|fondo de caja|retiros?)$/
// Una vuelta de compras: esa sola salida suele pagar varios tickets.
const ES_VUELTA = /\b(compras?|moto|mandados?|vuelta|insumos|super|mercado)\b/
const NO_IDENTIFICAN = new Set(['compra', 'compras', 'pago', 'pagos', 'nota', 'notas', 'servicio', 'servicios', 'envio', 'envios', 'moto', 'para', 'por', 'con', 'del', 'las', 'los', 'una', 'uno', 'sin', 'hoy', 'dia', 'dias'])

export const normalizarConcepto = s => quitarAcentos(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const palabras = s => normalizarConcepto(String(s ?? '').replace(/['’`]/g, '')).split(' ').filter(p => p.length >= 3 && !NO_IDENTIFICAN.has(p))

/** Dos textos que hablan de lo mismo: "Compras Costco" y "COSTCO WHOLESALE", "Jugo tropick" y "JUGOTROPICK". */
export function seRelacionan(a, b) {
  const otras = palabras(b)
  return palabras(a).some(x => otras.some(y => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))))
}

const mismoComercio = ts => ts.every(t => t.comercio && normalizarConcepto(t.comercio) === normalizarConcepto(ts[0].comercio))

/** De 2 a `tope` tickets que sumen justo el monto y pasen `acepta`; primero con pocos tickets, que son los que menos se dan por casualidad. */
function combinacion(cand, monto, tope, acepta) {
  for (let tam = 2; tam <= tope; tam++) {
    let hallado = null
    const buscar = (i, suma, elegidos) => {
      if (hallado) return
      if (elegidos.length === tam) { if (justo(suma, monto) && acepta(elegidos)) hallado = elegidos; return }
      if (i >= cand.length || suma > monto + 1.5) return
      buscar(i + 1, suma + Number(cand[i].monto), [...elegidos, cand[i]])
      buscar(i + 1, suma, elegidos)
    }
    buscar(0, 0, [])
    if (hallado) return hallado
  }
  return null
}

/**
 * Empata salidas de caja con tickets de UNA sucursal.
 * salidas: [{ id, fecha, concepto, monto, no_lleva, ticket_id, tickets_extra }]
 * tickets: [{ id, fecha, monto, comercio, cuentaMano (total a mano), deCaja (se declaro efectivo de caja), otroPago (se declaro otra forma de pago) }]
 * Devuelve { faltan, conTicket, noLlevan, ticketsSinSalida }. Cada ticket se usa una vez. Mejor un faltante de mas, que se aclara con un toque, que
 * uno escondido: lo que solo cuadra por la suma no se da por bueno, va en faltan con `sugeridos` para que el dueno lo confirme.
 */
export function cotejar(salidas, tickets, conceptosSinTicket = []) {
  const propios = new Set(conceptosSinTicket.map(normalizarConcepto))
  const usados = new Set()
  const conTicket = [], noLlevan = [], porBuscar = []
  const porId = new Map(tickets.map(t => [t.id, t]))
  for (const s of salidas) {
    const c = normalizarConcepto(s.concepto)
    const ligados = [s.ticket_id, ...(s.tickets_extra ?? [])].filter(id => id && porId.has(id))
    if (ligados.length) {
      const papeles = ligados.map(id => porId.get(id))
      for (const id of ligados) usados.add(id)
      // Lo que los tickets no alcanzan a comprobar sigue faltando, salvo que el dueno diga que eso no lleva ticket.
      const resto = s.no_lleva ? 0 : Math.round((s.monto - papeles.reduce((n, x) => n + (Number(x.monto) || 0), 0)) * 100) / 100
      conTicket.push({ ...s, tickets: papeles, como: 'manual', resto: resto > 1.5 ? resto : 0 })
      continue
    }
    if (s.no_lleva || propios.has(c) || SIN_TICKET_COMUN.test(c)) { noLlevan.push(s); continue }
    porBuscar.push(s)
  }
  // Un ticket pagado con tarjeta o transferencia no comprueba efectivo que salio de la caja. Y el que el dueno dijo que no es, no se vuelve a proponer.
  const libres = (s, margen) => tickets.filter(t => !usados.has(t.id) && !t.otroPago && !(s.no_es ?? []).includes(t.id) && t.fecha && Math.abs(dias(t.fecha, s.fecha)) <= margen)
  const lejania = (t, s) => Math.abs(dias(t.fecha, s.fecha))

  // 1) Mismo monto, en pasadas: lo mas seguro primero para que una coincidencia no le gane su ticket a la salida correcta. En cada pasada se juntan primero
  // las parejas mas cercanas en fecha, asi el resultado no depende del orden en que llegan las filas.
  let pendientes = [...porBuscar].sort((a, b) => (b.monto - a.monto) || a.fecha.localeCompare(b.fecha) || String(a.hora ?? '').localeCompare(String(b.hora ?? '')) || String(a.id).localeCompare(String(b.id)))
  const pasada = acepta => {
    const parejas = []
    for (const s of pendientes) for (const t of libres(s, 5)) if (acepta(s, t)) parejas.push([s, t])
    parejas.sort(([a, x], [b, y]) => (lejania(x, a) - lejania(y, b)) || (Math.abs(Number(x.monto) - a.monto) - Math.abs(Number(y.monto) - b.monto)) || ((y.deCaja ? 1 : 0) - (x.deCaja ? 1 : 0))
      || a.fecha.localeCompare(b.fecha) || String(a.hora ?? '').localeCompare(String(b.hora ?? '')) || String(x.id).localeCompare(String(y.id)))
    const listas = new Set()
    for (const [s, t] of parejas) {
      if (listas.has(s) || usados.has(t.id)) continue
      listas.add(s); usados.add(t.id)
      conTicket.push({ ...s, tickets: [t], como: 'monto' })
    }
    pendientes = pendientes.filter(s => !listas.has(s))
  }
  // Un monto con centavos que coincide exacto casi no se da por casualidad (.50 es redondo).
  const alCentavo = (s, t) => Math.round(s.monto * 100) % 50 !== 0 && Math.abs(Number(t.monto) - s.monto) < 0.01
  pasada((s, t) => justo(Number(t.monto), s.monto) && seRelacionan(s.concepto, t.comercio))
  pasada((s, t) => justo(Number(t.monto), s.monto) && (lejania(t, s) <= 2 || alCentavo(s, t)))
  pasada((s, t) => parecido(Number(t.monto), s.monto) && seRelacionan(s.concepto, t.comercio))
  // 2) La cuenta a mano de una vuelta de compras: "Total $1,504" es lo que salio de caja.
  const sigue = []
  for (const s of pendientes) {
    const t = libres(s, 5).find(x => x.cuentaMano && parecido(Number(x.cuentaMano), s.monto) && (lejania(x, s) <= 2 || seRelacionan(s.concepto, x.comercio)))
    if (t) { usados.add(t.id); conTicket.push({ ...s, tickets: [t], como: 'cuenta a mano' }) } else sigue.push(s)
  }
  // 3) Un ticket que se pago con dos salidas de lo mismo: "Gas $1,352" y "Gas $1,000" para el de Gas de $2,352.
  const sinPar = []
  const tomadas = new Set()
  for (const s of sigue) {
    if (tomadas.has(s)) continue
    let par = null
    for (const otra of sigue) {
      if (otra === s || tomadas.has(otra) || Math.abs(dias(otra.fecha, s.fecha)) > 2 || !seRelacionan(s.concepto, otra.concepto)) continue
      const t = libres(s, 3).find(x => justo(Number(x.monto), s.monto + otra.monto) && seRelacionan(s.concepto, x.comercio) && !(otra.no_es ?? []).includes(x.id))
      if (t) { par = { otra, t }; break }
    }
    if (par) {
      tomadas.add(s); tomadas.add(par.otra); usados.add(par.t.id)
      conTicket.push({ ...s, tickets: [par.t], como: 'dos salidas' }, { ...par.otra, tickets: [par.t], como: 'dos salidas' })
    } else sinPar.push(s)
  }
  // 4) Una salida que paga varios tickets de esos dias (de 2 a 4). Solo se da por buena si el concepto los nombra a todos: "coca" y dos de Coca-Cola.
  const candidatos = s => libres(s, 2).filter(t => Number(t.monto) > 0 && Number(t.monto) < s.monto).sort((a, b) => lejania(a, s) - lejania(b, s)).slice(0, 14)
  const sinTicket = []
  for (const s of sinPar.filter(x => !tomadas.has(x))) {
    const seguro = combinacion(candidatos(s).filter(t => seRelacionan(s.concepto, t.comercio)), s.monto, 4, () => true)
    if (seguro) { for (const t of seguro) usados.add(t.id); conTicket.push({ ...s, tickets: seguro, como: 'varios tickets' }) } else sinTicket.push(s)
  }
  // Lo demas falta. Se le sugiere al dueno, nunca se da por bueno solo: un ticket del mismo monto aunque este lejos de la fecha; una suma justa si el concepto
  // nombra alguno, si son del mismo comercio o si es una vuelta de compras de esos dias; o el comercio nombrado con un monto cercano. En montos chicos casi todo coincide: no se sugiere.
  const faltan = []
  const sugeridos = new Set()
  for (const s of sinTicket) {
    if (s.monto < 100) { faltan.push(s); continue }
    const sueltos = libres(s, 5).filter(t => !sugeridos.has(t.id))
    const igual = sueltos.filter(t => justo(Number(t.monto), s.monto)).sort((a, b) => lejania(a, s) - lejania(b, s))[0]
    const cercano = sueltos.filter(t => seRelacionan(s.concepto, t.comercio) && Math.abs(Number(t.monto) - s.monto) <= s.monto * 0.15 && lejania(t, s) <= 3).sort((a, b) => Math.abs(Number(a.monto) - s.monto) - Math.abs(Number(b.monto) - s.monto))[0]
    const vuelta = ES_VUELTA.test(normalizarConcepto(s.concepto))
    const suma = s.monto < 300 ? null : combinacion(candidatos(s).filter(t => !sugeridos.has(t.id)), s.monto, 4, ts => ts.some(t => seRelacionan(s.concepto, t.comercio)) || mismoComercio(ts) || (vuelta && ts.every(t => lejania(t, s) <= 1)))
    const posible = igual ? [igual] : suma ?? (cercano ? [cercano] : null)
    if (posible) { for (const t of posible) sugeridos.add(t.id); faltan.push({ ...s, sugeridos: posible }) } else faltan.push(s)
  }
  faltan.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const ticketsSinSalida = tickets.filter(t => t.deCaja && !usados.has(t.id) && !sugeridos.has(t.id)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  return { faltan, conTicket, noLlevan, ticketsSinSalida }
}

const porSucursal = lista => {
  const grupos = new Map()
  for (const x of lista) {
    const k = x.sucursal_id ?? ''
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(x)
  }
  return grupos
}

/** Cada sucursal se coteja sola: una salida de una tienda nunca se empata con el ticket de otra, y la que no tiene reporte del mes no cuenta. */
export function cotejarPorSucursal(salidas, tickets, conceptosSinTicket = []) {
  const deTickets = porSucursal(tickets)
  const total = { faltan: [], conTicket: [], noLlevan: [], ticketsSinSalida: [] }
  for (const [suc, lista] of porSucursal(salidas)) {
    const r = cotejar(lista, deTickets.get(suc) ?? [], conceptosSinTicket)
    for (const k of Object.keys(total)) total[k].push(...r[k])
  }
  total.faltan.sort((a, b) => a.fecha.localeCompare(b.fecha))
  total.ticketsSinSalida.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  return total
}

export const cuentasIncompletasPorSucursal = tickets => [...porSucursal(tickets).values()].flatMap(cuentasIncompletas).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))

/** Cuenta a mano de una vuelta contra los tickets de esos dias: cuanto no se comprueba. */
export function cuentasIncompletas(tickets) {
  const salida = []
  for (const t of tickets) {
    const compra = Number(t.compraMano)
    if (!(compra > 0) || !t.fecha) continue
    const propio = Math.max(0, Number(t.monto) - (Number(t.envioMano) || 0))
    const otros = tickets.filter(x => x.id !== t.id && x.fecha && Math.abs(dias(x.fecha, t.fecha)) <= 1 && Number(x.monto) > 0 && !x.compraMano).slice(0, 18)
    // La mejor suma que no se pasa de la compra (por pesos, sin recorrer todas las combinaciones).
    const tope = Math.round(compra)
    const alcance = new Map([[Math.round(propio), propio]])
    for (const o of otros) {
      for (const [r, exacto] of [...alcance]) {
        const nuevo = r + Math.round(Number(o.monto))
        if (nuevo <= tope + 1 && !alcance.has(nuevo)) alcance.set(nuevo, exacto + Number(o.monto))
      }
    }
    const mejor = Math.max(...alcance.values())
    const falta = Math.round((compra - mejor) * 100) / 100
    if (falta > 2) salida.push({ ...t, compra, comprobado: Math.round(mejor * 100) / 100, falta })
  }
  return salida.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
}
