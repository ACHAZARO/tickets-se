// Deteccion de tickets sospechosos (revision de fraude).
// Funcion PURA: recibe tickets normalizados y devuelve, por ticket, los motivos
// de sospecha y una "clave de grupo" (para ligar tickets relacionados).
//
// ticket = { id, comercio, fecha: 'YYYY-MM-DD', monto: number, items: [{ pid, desc, cantidad, monto }] }
// retorna { [id]: { motivos: string[], groupKey: string|null } }

function diasEntre(a, b) {
  const da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z')
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity
  return Math.abs(da - db) / 86400000
}

function firmaCanasta(t) {
  const claves = (t.items || [])
    .map(it => (it.pid ? `p:${it.pid}` : (it.desc ? `d:${String(it.desc).trim().toLowerCase()}` : '')))
    .filter(Boolean)
  return [...new Set(claves)].sort().join('|')
}

function add(acc, id, motivo, groupKey) {
  const e = acc[id] || (acc[id] = { motivos: [], groupKey: null })
  if (!e.motivos.includes(motivo)) e.motivos.push(motivo)
  if (groupKey && !e.groupKey) e.groupKey = groupKey
}

export function detectarSospechas(tickets, opts = {}) {
  const ventanaCanasta = opts.ventanaCanastaDias ?? 7
  const ventanaDup = opts.ventanaDuplicadoDias ?? 2
  const factorPrecio = opts.factorPrecio ?? 1.6
  const factorMonto = opts.factorMonto ?? 2
  const minMuestras = opts.minMuestras ?? 3
  const acc = {}

  // --- R1: canasta repetida (mismos productos, distinto total, fechas cercanas) ---
  const porFirma = {}
  for (const t of tickets) {
    const f = firmaCanasta(t)
    if (!f) continue
    ;(porFirma[f] || (porFirma[f] = [])).push(t)
  }
  for (const [firma, grupo] of Object.entries(porFirma)) {
    if (grupo.length < 2) continue
    const fechas = grupo.map(t => t.fecha).filter(Boolean).sort()
    const span = fechas.length >= 2 ? diasEntre(fechas[0], fechas[fechas.length - 1]) : 0
    const montos = new Set(grupo.map(t => Math.round(Number(t.monto) || 0)))
    if (span <= ventanaCanasta && montos.size >= 2) {
      for (const t of grupo) add(acc, t.id, 'Misma canasta, distinto total', `canasta:${firma}`)
    }
  }

  // --- R2: posible duplicado (mismo comercio + mismo total, fechas cercanas) ---
  const porDup = {}
  for (const t of tickets) {
    const com = (t.comercio || '').trim().toLowerCase()
    const monto = Math.round(Number(t.monto) || 0)
    if (!com || !monto) continue
    const k = `${com}|${monto}`
    ;(porDup[k] || (porDup[k] = [])).push(t)
  }
  for (const [k, grupo] of Object.entries(porDup)) {
    if (grupo.length < 2) continue
    const fechas = grupo.map(t => t.fecha).filter(Boolean).sort()
    const span = fechas.length >= 2 ? diasEntre(fechas[0], fechas[fechas.length - 1]) : 0
    if (span <= ventanaDup) {
      for (const t of grupo) add(acc, t.id, 'Posible duplicado (mismo comercio y total, fechas cercanas)', `dup:${k}`)
    }
  }

  // --- R3: salto de precio (precio unitario muy arriba del historico del producto) ---
  const preciosPorProd = {}
  for (const t of tickets) for (const it of (t.items || [])) {
    const cant = Number(it.cantidad), monto = Number(it.monto)
    if (!it.pid || !(cant > 0) || !(monto > 0)) continue
    const u = monto / cant
    ;(preciosPorProd[it.pid] || (preciosPorProd[it.pid] = [])).push(u)
  }
  const promProd = {}
  for (const [pid, arr] of Object.entries(preciosPorProd)) {
    if (arr.length >= minMuestras) promProd[pid] = arr.reduce((s, x) => s + x, 0) / arr.length
  }
  for (const t of tickets) for (const it of (t.items || [])) {
    const cant = Number(it.cantidad), monto = Number(it.monto)
    if (!it.pid || !(cant > 0) || !(monto > 0) || !promProd[it.pid]) continue
    const u = monto / cant
    if (u > promProd[it.pid] * factorPrecio) {
      const ratio = (u / promProd[it.pid]).toFixed(1)
      add(acc, t.id, `Precio de "${it.desc ?? 'producto'}" arriba del historico (x${ratio})`, null)
    }
  }

  // --- R4: monto atipico (total muy arriba del promedio del comercio) ---
  const montosPorComercio = {}
  for (const t of tickets) {
    const com = (t.comercio || '').trim().toLowerCase()
    const monto = Number(t.monto)
    if (!com || !(monto > 0)) continue
    ;(montosPorComercio[com] || (montosPorComercio[com] = [])).push(monto)
  }
  const promComercio = {}
  for (const [com, arr] of Object.entries(montosPorComercio)) {
    if (arr.length >= minMuestras) promComercio[com] = arr.reduce((s, x) => s + x, 0) / arr.length
  }
  for (const t of tickets) {
    const com = (t.comercio || '').trim().toLowerCase()
    const monto = Number(t.monto)
    if (!com || !(monto > 0) || !promComercio[com]) continue
    if (monto > promComercio[com] * factorMonto) {
      const ratio = (monto / promComercio[com]).toFixed(1)
      add(acc, t.id, `Monto muy arriba del promedio de "${t.comercio}" (x${ratio})`, null)
    }
  }

  return acc
}
