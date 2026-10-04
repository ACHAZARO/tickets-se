export interface Conteo { fecha: string; cantidad: number }
export interface Compra { fecha: string; cantidad: number; monto: number }

export function unidadesCompatibles(base: string | null | undefined): string[]
export function aUnidadBase(cantidad: number | string, unidad: string | null | undefined, base: string | null | undefined): number | null
export function conteoHasta(conteos: Conteo[], hasta: string | null): Conteo | null
export function comprasEntre(compras: Compra[], desde: string | null, hasta: string | null): { cantidad: number; monto: number }
export function existenciaEstimada(conteos: Conteo[], compras: Compra[]): { cantidad: number; conConteo: boolean; ultimo: Conteo | null }
export function consumoReal(conteos: Conteo[], compras: Compra[], d0: string, d1: string):
  { inicial: number; compras: number; final: number; consumo: number; costo: number } | null
