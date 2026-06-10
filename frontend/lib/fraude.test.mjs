import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectarSospechas } from './fraude.mjs'

describe('detectarSospechas', () => {
  it('R1: misma canasta con distinto total en dias cercanos', () => {
    const tickets = [
      { id: 'a', comercio: 'Costco', fecha: '2026-06-08', monto: 100, items: [{ pid: 'x', cantidad: 1, monto: 100 }] },
      { id: 'b', comercio: 'Costco', fecha: '2026-06-09', monto: 130, items: [{ pid: 'x', cantidad: 1, monto: 130 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(r['a'] && r['b'])
    assert.ok(r['a'].motivos.some(m => /canasta/i.test(m)))
    assert.equal(r['a'].groupKey, r['b'].groupKey) // mismo grupo
  })

  it('no marca si el total es igual (no es anomalia de canasta)', () => {
    const tickets = [
      { id: 'a', comercio: 'X', fecha: '2026-06-08', monto: 100, items: [{ pid: 'x', cantidad: 1, monto: 100 }] },
      { id: 'b', comercio: 'Y', fecha: '2026-06-08', monto: 100, items: [{ pid: 'x', cantidad: 1, monto: 100 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(!r['a'] || !r['a'].motivos.some(m => /canasta/i.test(m)))
  })

  it('R1: un ticket viejo NO arrastra; solo el par cercano se marca', () => {
    const tickets = [
      { id: 'viejo', comercio: 'Costco', fecha: '2023-01-01', monto: 90, items: [{ pid: 'x', cantidad: 1, monto: 90 }] },
      { id: 'a', comercio: 'Costco', fecha: '2026-06-08', monto: 100, items: [{ pid: 'x', cantidad: 1, monto: 100 }] },
      { id: 'b', comercio: 'Costco', fecha: '2026-06-09', monto: 130, items: [{ pid: 'x', cantidad: 1, monto: 130 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(r['a'] && r['b'] && r['a'].groupKey === r['b'].groupKey)
    assert.ok(!r['viejo']) // su fecha esta lejos -> cluster propio de 1 -> no se marca
  })

  it('no cruza sucursales distintas', () => {
    const tickets = [
      { id: 'a', suc: 's1', comercio: 'X', fecha: '2026-06-08', monto: 100, items: [{ pid: 'x', cantidad: 1, monto: 100 }] },
      { id: 'b', suc: 's2', comercio: 'X', fecha: '2026-06-09', monto: 130, items: [{ pid: 'x', cantidad: 1, monto: 130 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(!r['a'] && !r['b']) // distinta sucursal -> no es la misma compra
  })

  it('R2: posible duplicado mismo comercio y total en fechas cercanas', () => {
    const tickets = [
      { id: 'a', comercio: 'OXXO', fecha: '2026-06-08', monto: 250, items: [{ pid: 'p', cantidad: 1, monto: 250 }] },
      { id: 'b', comercio: 'OXXO', fecha: '2026-06-08', monto: 250, items: [{ pid: 'q', cantidad: 1, monto: 250 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(r['a'].motivos.some(m => /duplicado/i.test(m)))
    assert.equal(r['a'].groupKey, r['b'].groupKey)
  })

  it('R3: salto de precio sobre el historico del producto', () => {
    const tickets = [
      { id: '1', comercio: 'A', fecha: '2026-06-01', monto: 10, items: [{ pid: 'leche', cantidad: 1, monto: 10 }] },
      { id: '2', comercio: 'A', fecha: '2026-06-02', monto: 10, items: [{ pid: 'leche', cantidad: 1, monto: 10 }] },
      { id: '3', comercio: 'A', fecha: '2026-06-03', monto: 10, items: [{ pid: 'leche', cantidad: 1, monto: 10 }] },
      { id: '4', comercio: 'A', fecha: '2026-06-04', monto: 30, items: [{ pid: 'leche', desc: 'Leche', cantidad: 1, monto: 30 }] },
    ]
    const r = detectarSospechas(tickets)
    assert.ok(r['4'] && r['4'].motivos.some(m => /Precio/i.test(m)))
  })
})
