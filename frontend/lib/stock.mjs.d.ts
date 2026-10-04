export interface Conteo { fecha: string; cantidad: number }
export interface Compra { fecha: string; cantidad: number; monto: number }

export function unidadesCompatibles(base: string | null | undefined): string[]
export function aUnidadBase(cantidad: number | string, unidad: string | null | undefined, base: string | null | undefined): number | null
export function conteoHasta(conteos: Conteo[], hasta: string | null): Conteo | null
export function comprasEntre(compras: Compra[], desde: string | null, hasta: string | null): { cantidad: number; monto: number }
export function existenciaEstimada(conteos: Conteo[], compras: Compra[]): { cantidad: number; conConteo: boolean; ultimo: Conteo | null }
export function consumoReal(conteos: Conteo[], compras: Compra[], d0: string, d1: string):
  { inicial: number; compras: number; final: number; consumo: number; costo: number } | null
export function baseDeRenglon(
  prod: { nombre?: string | null; unidad_default?: string | null; contiene_cantidad?: number | null; contiene_unidad?: string | null; contiene_sub_cantidad?: number | null; contiene_sub_unidad?: string | null } | null,
  row: { cantidad?: number | null; unidad?: string | null } | null,
): { cantidad: number; unidad: string | null } | { servicio: true } | null
export function unidadMasComun(cuenta: Record<string, number>): string | null
export function fechaMexico(d?: Date): string
