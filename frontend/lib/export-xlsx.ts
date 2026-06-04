// Export del arqueo a Excel (.xlsx), client-side con SheetJS.
import * as XLSX from 'xlsx'
import type { ResultadoArqueo } from './arqueo'

export interface TicketDetalle {
  fecha_ticket: string | null
  comercio: string | null
  producto: string | null
  categoria: string | null
  cantidad: number | null
  unidad: string | null
  monto: number | null
}

const estadoLabel: Record<string, string> = {
  ok: 'Dentro',
  excede: 'EXCEDE',
  sin_objetivo: 'Sin objetivo',
  sin_venta: 'Sin venta',
}

export function exportArqueoXlsx(
  arqueo: ResultadoArqueo,
  detalle: TicketDetalle[],
  meta: { periodo: string; sucursal: string }
) {
  const wb = XLSX.utils.book_new()

  // Hoja resumen
  const resumenRows: (string | number)[][] = [
    ['Arqueo de costos'],
    ['Periodo', meta.periodo],
    ['Sucursal', meta.sucursal],
    ['Venta total', arqueo.ventaTotal],
    ['Gasto total', arqueo.gastoTotal],
    ['Gasto % de venta', arqueo.pctGastoTotal != null ? Number(arqueo.pctGastoTotal.toFixed(2)) : 's/venta'],
    arqueo.estimado ? ['Nota', 'Ventas estimadas por prorrateo (rango libre)'] : [''],
    [''],
    ['Categoria', 'Gasto', '% de venta', 'Objetivo %', 'Estado'],
    ...arqueo.filas.map(f => [
      f.categoria_nombre,
      f.gasto,
      f.pct_venta != null ? Number(f.pct_venta.toFixed(2)) : '',
      f.pct_objetivo != null ? f.pct_objetivo : '',
      estadoLabel[f.estado] ?? f.estado,
    ]),
  ]
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows)
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

  // Hoja detalle de tickets
  const detalleRows = [
    ['Fecha', 'Comercio', 'Producto', 'Categoria', 'Cantidad', 'Unidad', 'Monto'],
    ...detalle.map(t => [
      t.fecha_ticket ?? '',
      t.comercio ?? '',
      t.producto ?? '',
      t.categoria ?? '',
      t.cantidad ?? '',
      t.unidad ?? '',
      t.monto ?? '',
    ]),
  ]
  const wsDetalle = XLSX.utils.aoa_to_sheet(detalleRows)
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle')

  const nombre = `arqueo_${meta.periodo.replace(/[^\w-]/g, '_')}.xlsx`
  XLSX.writeFile(wb, nombre)
}
