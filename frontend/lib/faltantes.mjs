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
  let entradasIgnoradas = 0
  for (const f of filas.slice(1)) {
    const tipo = col.tipo >= 0 ? quitarAcentos(f[col.tipo]) : ''
    if (tipo && /entrada|ingreso/.test(tipo)) { entradasIgnoradas++; continue }
    const fecha = leerFecha(f[col.fecha])
    const monto = leerMonto(f[col.monto])
    if (!fecha || monto === null || monto === 0) continue
    const concepto = col.concepto >= 0 ? String(f[col.concepto] ?? '').trim() : ''
    const hora = fecha.hora
    const cierre = col.cierre >= 0 ? String(f[col.cierre] ?? '').trim() : ''
    salidas.push({
      fecha: fecha.fecha, hora, concepto, monto: Math.abs(monto),
      empleado: col.empleado >= 0 ? String(f[col.empleado] ?? '').trim() || null : null,
      huella: [fecha.fecha, hora ?? '', quitarAcentos(concepto), Math.abs(monto).toFixed(2), cierre].join('|'),
    })
  }
  if (!salidas.length) return { salidas, entradasIgnoradas, error: 'No encontré salidas de dinero en ese archivo.' }
  return { salidas, entradasIgnoradas, error: null }
}

const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5)
const parecido = (a, b) => Math.abs(a - b) <= Math.max(1.5, b * 0.005)

/** Palabras que casi nunca llevan ticket (dinero que no es una compra). El dueno puede decir otras con un toque. */
const SIN_TICKET_COMUN = /\b(propinas?|bonos?|nominas?|sueldos?|quincenas?|aguinaldos?|prestamos?|anticipos?|retiros?|depositos?|fondo|cambio|comision)\b|^(sobrante|faltante)s?$/

export const normalizarConcepto = s => quitarAcentos(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Empata salidas de caja con tickets.
 * salidas: [{ id, fecha, concepto, monto, no_lleva, ticket_id }]
 * tickets: [{ id, fecha, monto, comercio, cuentaMano (total a mano) , deCaja (se declaro efectivo de caja) }]
 * Devuelve { faltan, conTicket, noLlevan, ticketsSinSalida }. Cada ticket se usa una vez; primero lo seguro, despues sumas de varios.
 */
export function cotejar(salidas, tickets, conceptosSinTicket = []) {
  const propios = new Set(conceptosSinTicket.map(normalizarConcepto))
  const usados = new Set()
  const conTicket = [], noLlevan = [], porBuscar = []
  const porId = new Map(tickets.map(t => [t.id, t]))
  for (const s of salidas) {
    const c = normalizarConcepto(s.concepto)
    if (s.ticket_id && porId.has(s.ticket_id)) { usados.add(s.ticket_id); conTicket.push({ ...s, tickets: [porId.get(s.ticket_id)], como: 'manual' }); continue }
    if (s.no_lleva || propios.has(c) || SIN_TICKET_COMUN.test(c)) { noLlevan.push(s); continue }
    porBuscar.push(s)
  }
  const libres = (s, margen) => tickets.filter(t => !usados.has(t.id) && t.fecha && Math.abs(dias(t.fecha, s.fecha)) <= margen)

  // 1) Mismo monto, lo mas cerca posible de la fecha. Los montos grandes primero: son los que menos se confunden.
  const orden = [...porBuscar].sort((a, b) => b.monto - a.monto)
  const pendientes = []
  for (const s of orden) {
    const t = libres(s, 5).filter(x => parecido(Number(x.monto), s.monto)).sort((a, b) => Math.abs(dias(a.fecha, s.fecha)) - Math.abs(dias(b.fecha, s.fecha)))[0]
    if (t) { usados.add(t.id); conTicket.push({ ...s, tickets: [t], como: 'monto' }) } else pendientes.push(s)
  }
  // 2) La cuenta a mano de una vuelta de compras: "Total $1,504" es lo que salio de caja.
  const sigue = []
  for (const s of pendientes) {
    const t = libres(s, 5).find(x => x.cuentaMano && parecido(Number(x.cuentaMano), s.monto))
    if (t) { usados.add(t.id); conTicket.push({ ...s, tickets: [t], como: 'cuenta a mano' }) } else sigue.push(s)
  }
  // 3) Un ticket que se pago con dos salidas: "Gas $1,352" y "Gas $1,000" para el de $2,352.
  const sinPar = []
  const tomadas = new Set()
  for (const s of sigue) {
    if (tomadas.has(s)) continue
    let par = null
    for (const otra of sigue) {
      if (otra === s || tomadas.has(otra) || Math.abs(dias(otra.fecha, s.fecha)) > 2) continue
      const t = libres(s, 3).find(x => parecido(Number(x.monto), s.monto + otra.monto))
      if (t) { par = { otra, t }; break }
    }
    if (par) {
      tomadas.add(s); tomadas.add(par.otra); usados.add(par.t.id)
      conTicket.push({ ...s, tickets: [par.t], como: 'dos salidas' }, { ...par.otra, tickets: [par.t], como: 'dos salidas' })
    } else sinPar.push(s)
  }
  // 4) Una salida que paga varios tickets de esos dias (de 2 a 4).
  const faltan = []
  for (const s of sinPar.filter(x => !tomadas.has(x))) {
    const cand = libres(s, 2).filter(t => Number(t.monto) > 0 && Number(t.monto) < s.monto).slice(0, 14)
    let hallado = null
    const buscar = (i, suma, elegidos) => {
      if (hallado) return
      if (elegidos.length >= 2 && parecido(suma, s.monto)) { hallado = elegidos; return }
      if (elegidos.length === 4 || i >= cand.length || suma > s.monto + 1) return
      buscar(i + 1, suma + Number(cand[i].monto), [...elegidos, cand[i]])
      buscar(i + 1, suma, elegidos)
    }
    buscar(0, 0, [])
    if (hallado) { for (const t of hallado) usados.add(t.id); conTicket.push({ ...s, tickets: hallado, como: 'varios tickets' }) } else faltan.push(s)
  }
  faltan.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const ticketsSinSalida = tickets.filter(t => t.deCaja && !usados.has(t.id)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  return { faltan, conTicket, noLlevan, ticketsSinSalida }
}

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
