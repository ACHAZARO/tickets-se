import test from 'node:test'
import assert from 'node:assert/strict'
import { cotejar, cuentasIncompletas, leerCsv, leerFecha, salidasDeReporte } from './faltantes.mjs'
import { calcularSugerencias } from './sugerencias.mjs'

const CSV = 'Fecha,Tienda,TPV,Número del cierre de caja,Tipo,Empleado,Comentario,Cantidad\n' +
  '30/9/26 20:58,X,X,803,Pago de salida,Ana,"Propina, tarjeta ",229.00\n' +
  '30/9/26 15:23,X,X,803,Pago de salida,Ana,Envío moto,60.00\n' +
  '29/9/26 10:00,X,X,802,Pago de entrada,Ana,Fondo,500.00\n'

test('lee el reporte de caja: comillas, fechas de Mexico y sin entradas', () => {
  const { salidas, entradasIgnoradas, error } = salidasDeReporte(leerCsv(CSV))
  assert.equal(error, null)
  assert.equal(entradasIgnoradas, 1)
  assert.equal(salidas.length, 2)
  assert.deepEqual([salidas[0].fecha, salidas[0].hora, salidas[0].concepto, salidas[0].monto], ['2026-09-30', '20:58', 'Propina, tarjeta', 229])
})

test('un archivo sin columnas conocidas se explica, no truena', () => {
  assert.match(salidasDeReporte(leerCsv('a,b\n1,2\n')).error, /columnas/)
  assert.equal(leerFecha('no es fecha'), null)
})

const s = (id, fecha, concepto, monto, extra = {}) => ({ id, fecha, concepto, monto, no_lleva: false, ticket_id: null, ...extra })
const t = (id, fecha, monto, extra = {}) => ({ id, fecha, monto, comercio: 'C', ...extra })

test('empata por monto, por dos salidas y por varios tickets; lo demas falta', () => {
  const r = cotejar(
    [s('a', '2026-09-10', 'Jugo', 210), s('b', '2026-09-26', 'Gas', 1352), s('c', '2026-09-26', 'Gas', 1000),
      s('d', '2026-09-18', 'Compras', 500), s('e', '2026-09-01', 'Hielo', 150), s('f', '2026-09-02', 'Propina tarjeta', 90), s('g', '2026-09-03', 'Sobrante', 3)],
    [t('1', '2026-09-11', 210), t('2', '2026-09-26', 2352.1), t('3', '2026-09-18', 300), t('4', '2026-09-18', 200), t('5', '2026-09-20', 999, { deCaja: true })],
  )
  assert.deepEqual(r.faltan.map(x => x.id), ['e'])
  assert.deepEqual(r.noLlevan.map(x => x.id).sort(), ['f', 'g'])
  assert.equal(r.conTicket.length, 4)
  assert.deepEqual(r.ticketsSinSalida.map(x => x.id), ['5'])
})

test('lo que el dueno aclaro se respeta', () => {
  const r = cotejar([s('a', '2026-09-10', 'Taxi', 95), s('b', '2026-09-10', 'Pan', 80, { ticket_id: '1' })], [t('1', '2026-09-30', 700)], ['taxi'])
  assert.equal(r.faltan.length, 0)
  assert.equal(r.conTicket[0].como, 'manual')
})

test('cuenta a mano: dice cuanto no se comprueba', () => {
  const r = cuentasIncompletas([
    t('1', '2026-10-08', 226.84, { compraMano: 1332.56, envioMano: 171.44 }),
    t('2', '2026-10-08', 1000), t('3', '2026-10-09', 125.18), t('4', '2026-10-20', 5000),
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].falta, 151.98)
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
