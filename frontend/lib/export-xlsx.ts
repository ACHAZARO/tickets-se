// Export del gasto a Excel (.xlsx), client-side con SheetJS.
import * as XLSX from 'xlsx'

export interface TicketDetalle {
  fecha_ticket: string | null
  comercio: string | null
  producto: string | null
  categoria: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
}

export interface ResumenCategoria {
  nombre: string
  gasto: number
  pct: number // % del gasto operativo
  operativo: boolean
}

export function exportGastoXlsx(opts: {
  periodo: string
  sucursal: string
  gastoOperativo: number
  gastoNoOperativo: number
  categorias: ResumenCategoria[]
  detalle: TicketDetalle[]
}) {
  const wb = XLSX.utils.book_new()

  const resumen: (string | number)[][] = [
    ['Distribución del gasto'],
    ['Periodo', opts.periodo],
    ['Sucursal', opts.sucursal],
    ['Gasto operativo', opts.gastoOperativo],
    ['Gasto no operativo', opts.gastoNoOperativo],
    [''],
    ['Categoría', 'Gasto', '% del operativo', 'Tipo'],
    ...opts.categorias.map(c => [
      c.nombre, c.gasto, Number(c.pct.toFixed(1)), c.operativo ? 'Operativo' : 'No operativo',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')

  const detalle = [
    ['Fecha', 'Comercio', 'Producto', 'Categoria', 'Cantidad', 'Unidad', 'Monto'],
    ...opts.detalle.map(t => [
      t.fecha_ticket ?? '', t.comercio ?? '', t.producto ?? '', t.categoria ?? '',
      t.cantidad ?? '', t.unidad ?? '', t.monto ?? '',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), 'Detalle')

  XLSX.writeFile(wb, `gasto_${opts.periodo.replace(/[^\w-]/g, '_')}.xlsx`)
}

export interface ResumenComercio { nombre: string; gasto: number; tickets: number }
export interface ResumenProducto {
  nombre: string; cantidad: number; unidad: string | null
  base: number; baseUnidad: string | null; veces: number; gasto: number; reconocido: boolean
}

// Reporte mensual completo: varias hojas (Resumen, Categorías, Comercios, Productos, Detalle).
export function exportReporteMensual(opts: {
  periodo: string
  sucursal: string
  gastoOperativo: number
  gastoNoOperativo: number
  nTickets: number
  categorias: ResumenCategoria[]
  comercios: ResumenComercio[]
  productos: ResumenProducto[]
  detalle: TicketDetalle[]
}) {
  const wb = XLSX.utils.book_new()

  const resumen: (string | number)[][] = [
    ['Reporte de gasto'],
    ['Periodo', opts.periodo],
    ['Sucursal', opts.sucursal],
    ['Tickets', opts.nTickets],
    ['Gasto operativo', opts.gastoOperativo],
    ['Gasto no operativo', opts.gastoNoOperativo],
    ['Gasto total', opts.gastoOperativo + opts.gastoNoOperativo],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')

  const cats = [
    ['Categoría', 'Gasto', '% del operativo', 'Tipo'],
    ...opts.categorias.map(c => [c.nombre, c.gasto, Number(c.pct.toFixed(1)), c.operativo ? 'Operativo' : 'No operativo']),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cats), 'Categorías')

  const coms = [
    ['Comercio', 'Gasto', 'Tickets'],
    ...opts.comercios.map(c => [c.nombre, c.gasto, c.tickets]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(coms), 'Comercios')

  const prods = [
    ['Producto', 'Cantidad', 'Unidad', 'Unidades base', 'Unidad base', 'Veces', 'Gasto', 'Precio unit. prom.', 'En catálogo'],
    ...opts.productos.map(p => [
      p.nombre, p.cantidad, p.unidad ?? '', p.base || '', p.baseUnidad ?? 'Revisar', p.veces, p.gasto,
      p.cantidad > 0 ? Number((p.gasto / p.cantidad).toFixed(2)) : '', p.reconocido ? 'Sí' : 'No',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prods), 'Productos')

  const detalle = [
    ['Fecha', 'Comercio', 'Producto', 'Categoria', 'Cantidad', 'Unidad', 'Monto'],
    ...opts.detalle.map(t => [
      t.fecha_ticket ?? '', t.comercio ?? '', t.producto ?? '', t.categoria ?? '',
      t.cantidad ?? '', t.unidad ?? '', t.monto ?? '',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), 'Detalle')

  XLSX.writeFile(wb, `reporte_${opts.sucursal.replace(/[^\w-]/g, '_')}_${opts.periodo.replace(/[^\w-]/g, '_')}.xlsx`)
}
