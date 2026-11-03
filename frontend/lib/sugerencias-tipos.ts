export interface FilaSugerencia {
  grupo: string; nombreGrupo: string; articulo: string; comercio: string | null; fecha: string | null
  monto: number; cantidadBase: number; unidadBase: string | null
}
export interface OpcionCompra { articulo: string; comercio: string; precio: number; fecha: string }
export interface Sugerencia { nombre: string; unidad: string; mejor: OpcionCompra; ultima: OpcionCompra; ahorroPct: number; ahorroPesos: number }
