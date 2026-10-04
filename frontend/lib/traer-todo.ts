// Supabase (PostgREST) corta CADA respuesta en 1000 filas aunque pidas mas con .limit(8000): verificado
// el 2026-10-04 (pedir 8000 renglones devolvia exactamente 1000). Las pantallas que suman muchos renglones
// (Gasto, Precios, Entradas, Stock, Cerebro, Comercios, escaneo de fraude) deben pedir en tandas.

const TANDA = 1000

interface Paginable<R> {
  order: (columna: string, opciones?: { ascending?: boolean }) => Paginable<R>
  range: (desde: number, hasta: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>
}

/**
 * Trae todas las filas de una consulta, de 1000 en 1000. `armar` debe crear la consulta NUEVA cada vez
 * (con sus filtros). Se ordena por `id` al final para que las tandas no repitan ni salten filas.
 */
export async function traerTodo<R>(
  armar: () => unknown,
  { maximo = 50000, columnaOrden = 'id' }: { maximo?: number; columnaOrden?: string } = {},
): Promise<{ data: R[]; error: { message: string } | null }> {
  const filas: R[] = []
  for (let desde = 0; desde < maximo; desde += TANDA) {
    const q = (armar() as Paginable<R>).order(columnaOrden, { ascending: true })
    const { data, error } = await q.range(desde, Math.min(desde + TANDA, maximo) - 1)
    if (error) return { data: filas, error }
    filas.push(...(data ?? []))
    if (!data || data.length < TANDA) break
  }
  return { data: filas, error: null }
}
