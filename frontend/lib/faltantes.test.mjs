import test from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, cotejarPorSucursal, cuentasIncompletas, cuentasIncompletasPorSucursal, leerCsv, leerFecha, salidasDeReporte, seRelacionan } from './faltantes.mjs'
import { calcularSugerencias } from './sugerencias.mjs'

const CSV = 'Fecha,Tienda,TPV,Número del cierre de caja,Tipo,Empleado,Comentario,Cantidad\n' +
  '30/9/26 20:58,X,X,803,Pago de salida,Ana,"Propina, tarjeta ",229.00\n' +
  '30/9/26 15:23,X,X,803,Pago de salida,Ana,Envío moto,60.00\n' +
  '29/9/26 10:00,X,X,802,Pago de entrada,Ana,Fondo,500.00\n' +
  '29/9/26 11:00,X,X,802,Depositar,Ana,Pedido cafe,3552.00\n'

test('lee el reporte de caja: comillas, fechas de Mexico y sin entradas', () => {
  const { salidas, entradasIgnoradas, error } = salidasDeReporte(leerCsv(CSV))
  assert.equal(error, null)
  assert.equal(entradasIgnoradas, 2)
  assert.equal(salidas.length, 2)
  assert.deepEqual([salidas[0].fecha, salidas[0].hora, salidas[0].concepto, salidas[0].monto], ['2026-09-30', '20:58', 'Propina, tarjeta', 229])
})

test('un archivo sin columnas conocidas se explica, no truena', () => {
  assert.match(salidasDeReporte(leerCsv('a,b\n1,2\n')).error, /columnas/)
  assert.equal(leerFecha('no es fecha'), null)
})

const s = (id, fecha, concepto, monto, extra = {}) => ({ id, fecha, concepto, monto, no_lleva: false, ticket_id: null, ...extra })
const t = (id, fecha, monto, extra = {}) => ({ id, fecha, monto, comercio: 'C', ...extra })

test('empata por monto, por dos salidas de lo mismo y por varios tickets del mismo comercio; lo demas falta', () => {
  const r = cotejar(
    [s('a', '2026-09-10', 'Jugo', 210), s('b', '2026-09-26', 'Gas', 1352), s('c', '2026-09-26', 'Gas', 1000),
      s('d', '2026-09-18', 'Coca', 500), s('e', '2026-09-01', 'Hielo', 150), s('f', '2026-09-02', 'Propina tarjeta', 90), s('g', '2026-09-03', 'Sobrante', 3)],
    [t('1', '2026-09-11', 210), t('2', '2026-09-26', 2352.1, { comercio: 'GAS DEL ATLANTICO' }), t('3', '2026-09-18', 300, { comercio: 'Coca-Cola FEMSA' }), t('4', '2026-09-18', 200, { comercio: 'Coca-Cola FEMSA' }), t('5', '2026-09-20', 999, { deCaja: true })],
  )
  assert.deepEqual(r.faltan.map(x => x.id), ['e'])
  assert.deepEqual(r.noLlevan.map(x => x.id).sort(), ['f', 'g'])
  assert.equal(r.conTicket.length, 4)
  assert.deepEqual(r.ticketsSinSalida.map(x => x.id), ['5'])
})

test('dos salidas sin relacion no se juntan para cuadrar un ticket', () => {
  const r = cotejar([s('a', '2026-07-27', 'gas compras del mes', 1350), s('b', '2026-07-27', '2 Dias de Luis pendientes', 514)], [t('1', '2026-07-28', 1864, { comercio: 'Coca-Cola FEMSA' })])
  assert.equal(r.faltan.length, 2)
  assert.equal(r.conTicket.length, 0)
})

test('una suma de tickets sin relacion no se da por buena; en una vuelta de compras se sugiere y el dueno decide', () => {
  const tickets = [t('1', '2026-08-13', 224, { comercio: 'Farmacia' }), t('2', '2026-08-13', 510, { comercio: 'Walmart' })]
  const sinSentido = cotejar([s('a', '2026-08-12', 'Coca Cola', 734)], tickets)
  assert.equal(sinSentido.conTicket.length, 0)
  assert.equal(sinSentido.faltan[0].sugeridos, undefined)
  const vuelta = cotejar([s('a', '2026-08-12', 'Compras moto', 734)], tickets)
  assert.equal(vuelta.conTicket.length, 0)
  assert.deepEqual(vuelta.faltan[0].sugeridos.map(x => x.id).sort(), ['1', '2'])
})

test('el mismo monto lejos de la fecha y sin relacion se sugiere, no se da por bueno', () => {
  const r = cotejar([s('a', '2026-09-02', 'Coca cola', 970)], [t('1', '2026-08-28', 970, { comercio: 'ADAN MELCHOR' })])
  assert.equal(r.conTicket.length, 0)
  assert.deepEqual(r.faltan[0].sugeridos.map(x => x.id), ['1'])
  const nombrado = cotejar([s('a', '2026-09-02', 'Compras sams', 970)], [t('1', '2026-08-28', 970, { comercio: "Sam's Club" })])
  assert.equal(nombrado.conTicket.length, 1)
  const alCentavo = cotejar([s('a', '2026-07-19', 'pintura', 2422.39)], [t('1', '2026-07-14', 2422.39, { comercio: 'SERVICIOS' })])
  assert.equal(alCentavo.conTicket.length, 1)
})

test('un monto casi igual no le gana el ticket a la salida que si coincide', () => {
  const r = cotejar(
    [s('a', '2026-09-28', 'Coca Cola', 970), s('b', '2026-09-28', 'Compras tipico', 967)],
    [t('1', '2026-09-28', 967.15, { comercio: 'TIPICO ARAUCARIAS' })],
  )
  assert.deepEqual(r.conTicket.map(x => x.id), ['b'])
  assert.deepEqual(r.faltan.map(x => x.id), ['a'])
})

test('nombra al comercio y el monto se acerca: se sugiere', () => {
  const r = cotejar([s('a', '2026-09-05', 'gas', 550)], [t('1', '2026-09-05', 506.4, { comercio: 'GAS DE XALAPA' })])
  assert.equal(r.conTicket.length, 0)
  assert.deepEqual(r.faltan[0].sugeridos.map(x => x.id), ['1'])
})

test('la suma de varios tickets tiene que dar justa', () => {
  const r = cotejar([s('a', '2026-08-01', 'Compras', 2400)], [t('1', '2026-08-01', 1200), t('2', '2026-08-01', 1205.4)])
  assert.equal(r.conTicket.length, 0)
  assert.equal(r.faltan[0].sugeridos, undefined)
})

test('un ticket pagado con tarjeta no comprueba efectivo de la caja', () => {
  const r = cotejar([s('a', '2026-10-10', 'Compras Costco', 952)], [t('1', '2026-10-10', 952, { comercio: 'COSTCO', otroPago: true })])
  assert.equal(r.faltan.length, 1)
})

test('una sucursal no se empata con los tickets de otra, y la que no tiene reporte no cuenta', () => {
  const r = cotejarPorSucursal(
    [s('a', '2026-09-10', 'Jugo', 210, { sucursal_id: 'A' })],
    [t('1', '2026-09-10', 210, { sucursal_id: 'B', deCaja: true }), t('2', '2026-09-11', 99, { sucursal_id: 'A', deCaja: true })],
  )
  assert.deepEqual(r.faltan.map(x => x.id), ['a'])
  assert.deepEqual(r.ticketsSinSalida.map(x => x.id), ['2'])
})

test('reconoce de que habla cada concepto sin confundir palabras cortas', () => {
  assert.equal(seRelacionan('Jugo tropick', 'JUGOTROPICK'), true)
  assert.equal(seRelacionan('Compras Costco Cocina', 'COSTCO WHOLESALE'), true)
  assert.equal(seRelacionan('El gasssss Atlántico', 'GAS DEL ATLANTICO'), true)
  assert.equal(seRelacionan('Pan y envío', 'DON PANCHITO'), false)
  assert.equal(seRelacionan('Compras moto', 'Moto envío compras'), false)
})

test('lo que el dueno aclaro se respeta', () => {
  const r = cotejar([s('a', '2026-09-10', 'Taxi', 95), s('b', '2026-09-10', 'Pan', 80, { ticket_id: '1' })], [t('1', '2026-09-30', 700)], ['taxi'])
  assert.equal(r.faltan.length, 0)
  assert.equal(r.conTicket[0].como, 'manual')
  const varios = cotejar([s('c', '2026-09-10', 'Moto', 300, { ticket_id: '1', tickets_extra: ['2'] })], [t('1', '2026-09-10', 100), t('2', '2026-09-10', 200)])
  assert.deepEqual(varios.conTicket[0].tickets.map(x => x.id), ['1', '2'])
})

test('mismo comercio y suma justa sin que el concepto lo nombre: se sugiere, no se da por bueno', () => {
  const r = cotejar([s('a', '2026-08-12', 'Hielo', 1100.5)], [t('1', '2026-08-12', 400, { comercio: 'WALMART' }), t('2', '2026-08-12', 300, { comercio: 'WALMART' }), t('3', '2026-08-12', 400.5, { comercio: 'WALMART' })])
  assert.equal(r.conTicket.length, 0)
  assert.equal(r.faltan[0].sugeridos.length, 3)
})

test('en montos chicos no se sugiere: casi todo coincide', () => {
  const r = cotejar([s('a', '2026-08-12', 'Envio moto', 60)], [t('1', '2026-08-12', 25, { comercio: 'X' }), t('2', '2026-08-12', 35, { comercio: 'Y' })])
  assert.equal(r.faltan[0].sugeridos, undefined)
})

test('lo que seguro no es compra no lleva ticket; "cambio de aceite" y "anticipo gas" si se preguntan', () => {
  const r = cotejar([s('a', '2026-08-01', 'Cambio', 500), s('b', '2026-08-01', 'Cambio de aceite', 900), s('c', '2026-08-01', 'Anticipo gas', 300), s('d', '2026-08-01', 'Nomina Ana', 2000)], [])
  assert.deepEqual(r.noLlevan.map(x => x.id).sort(), ['a', 'd'])
  assert.deepEqual(r.faltan.map(x => x.id).sort(), ['b', 'c'])
})

test('el ticket que el dueno dijo que no es ya no se empata ni se sugiere para esa salida', () => {
  const r = cotejar([s('a', '2026-09-10', 'Jugo', 210, { no_es: ['1'] })], [t('1', '2026-09-10', 210)])
  assert.equal(r.conTicket.length, 0)
  assert.equal(r.faltan[0].sugeridos, undefined)
})

test('tickets que no alcanzan: lo demas sigue faltando hasta que el dueno diga que no lleva ticket', () => {
  const tk = [t('1', '2026-09-10', 2400)]
  assert.equal(cotejar([s('a', '2026-09-10', 'Compras', 3000, { ticket_id: '1' })], tk).conTicket[0].resto, 600)
  assert.equal(cotejar([s('a', '2026-09-10', 'Compras', 3000, { ticket_id: '1', no_lleva: true })], tk).conTicket[0].resto, 0)
})

test('un ticket sugerido no se reporta como pagado de caja sin salida', () => {
  const r = cotejar([s('a', '2026-09-02', 'Hielo', 970)], [t('1', '2026-08-28', 970, { deCaja: true })])
  assert.deepEqual(r.faltan[0].sugeridos.map(x => x.id), ['1'])
  assert.equal(r.ticketsSinSalida.length, 0)
})

test('la misma salida escrita igual dos veces son dos, y subir otra vez da las mismas huellas', () => {
  const csv = 'Fecha,Comentario,Cantidad\n2026-09-01,Propina,100\n2026-09-01,Propina,100\n'
  const a = salidasDeReporte(leerCsv(csv)).salidas.map(x => x.huella)
  assert.equal(new Set(a).size, 2)
  assert.deepEqual(salidasDeReporte(leerCsv(csv)).salidas.map(x => x.huella), a)
})

test('la huella distingue tiendas', () => {
  const r = salidasDeReporte(leerCsv('Fecha,Tienda,Comentario,Cantidad\n2026-09-01,A,Taxi,100\n2026-09-01,B,Taxi,100\n')).salidas
  assert.notEqual(r[0].huella, r[1].huella)
  assert.deepEqual(r.map(x => x.tienda), ['A', 'B'])
})

test('el resultado no depende del orden de las filas y el ticket va a la salida mas cercana', () => {
  const salidas = [s('a', '2026-10-01', 'Hielo', 210), s('b', '2026-10-06', 'Hielo', 210), s('c', '2026-10-20', 'Taxi', 95)]
  const tickets = [t('1', '2026-10-06', 210), t('2', '2026-10-02', 210)]
  const fotos = [salidas, [...salidas].reverse(), [salidas[1], salidas[2], salidas[0]]].map(l => cotejar(l, tickets))
  for (const r of fotos) {
    assert.deepEqual(Object.fromEntries(r.conTicket.map(x => [x.id, x.tickets[0].id])), { a: '2', b: '1' })
    assert.deepEqual(r.faltan.map(x => x.id), ['c'])
  }
})

test('cuenta a mano: dice cuanto no se comprueba', () => {
  const r = cuentasIncompletas([
    t('1', '2026-10-08', 226.84, { compraMano: 1332.56, envioMano: 171.44 }),
    t('2', '2026-10-08', 1000), t('3', '2026-10-09', 125.18), t('4', '2026-10-20', 5000),
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].falta, 151.98)
})

test('cuenta a mano: no se comprueba con tickets de otra sucursal', () => {
  const r = cuentasIncompletasPorSucursal([
    t('1', '2026-10-08', 100, { compraMano: 1100, sucursal_id: 'A' }), t('2', '2026-10-08', 1000, { sucursal_id: 'B' }),
  ])
  assert.equal(r[0].falta, 1000)
})

test('sugiere el tamano o comercio mas barato por unidad base, no por presentacion', () => {
  const f = (articulo, comercio, fecha, monto, cant) => ({ grupo: 'harina', nombreGrupo: 'Harina', articulo, comercio, fecha, monto, cantidadBase: cant, unidadBase: 'kg' })
  const r = calcularSugerencias([f('Harina 4 kg', 'Costco', '2026-10-01', 85.82, 4), f('Harina 1 kg', 'Walmart', '2026-10-20', 37.5, 1), f('Harina 1 kg', 'Walmart', '2026-10-25', 75, 2)], '2026-11-03', { minPesos: 10 })
  assert.equal(r.length, 1)
  assert.equal(r[0].mejor.comercio, 'Costco')
  assert.equal(Math.round(r[0].ahorroPct), 43)
})

test('una diferencia de mas de 5 veces no se sugiere: es una medida mal capturada', () => {
  const f = (articulo, fecha, monto) => ({ grupo: 'g', nombreGrupo: 'G', articulo, comercio: articulo, fecha, monto, cantidadBase: 1, unidadBase: 'kg' })
  assert.equal(calcularSugerencias([f('A', '2026-10-01', 10), f('B', '2026-10-20', 100)], '2026-11-03').length, 0)
})
