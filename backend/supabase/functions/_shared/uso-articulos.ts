// Articulos OCASIONALES y NO AUTORIZADOS (migraciones 094/096, decision Alejandro 05-oct-2026).
//  * no_autorizado -> la BASE (trigger de ticket_items, 096) deja el renglon 'pendiente' y pone la alerta
//    articulo_no_autorizado (sale en Fraude). Aqui solo se le agrega a la alerta que articulos son.
//  * ocasional     -> el ticket lleva la alerta articulo_ocasional (Por revisar, se acepta con un clic).
// FALLA CERRADO: si no se puede revisar, devuelve 'error_uso' para que el ticket NO se apruebe solo.
// deno-lint-ignore no-explicit-any
type SB = any

export async function revisarUsoArticulos(supabase: SB, registroId: string): Promise<string[]> {
  const { data, error } = await supabase.from('ticket_items')
    .select('id, monto, autorizacion, catalogo_productos:producto_catalogo_id(nombre, uso)')
    .eq('registro_ticket_id', registroId)
  if (error) { console.error('revisarUsoArticulos:', error.message); return ['error_uso'] }
  type Fila = { id: string; monto: number | null; autorizacion: string; catalogo_productos: { nombre: string; uso: string | null } | null }
  const filas = (data ?? []) as Fila[]
  const noAut = filas.filter(f => f.catalogo_productos?.uso === 'no_autorizado')
  const ocas = filas.filter(f => f.catalogo_productos?.uso === 'ocasional')
  const creadas: string[] = []
  const articulos = (l: Fila[]) => ({ articulos: l.map(f => ({ nombre: f.catalogo_productos!.nombre, monto: f.monto })) })
  if (noAut.length) {
    // Por si el trigger no corrio (no deberia pasar): se marca aqui tambien.
    const sinMarcar = noAut.filter(f => f.autorizacion === 'normal').map(f => f.id)
    if (sinMarcar.length) {
      const { error: e1 } = await supabase.from('ticket_items').update({ autorizacion: 'pendiente' }).in('id', sinMarcar)
      if (e1) { console.error('marcar pendiente fallo:', e1.message); creadas.push('error_uso') }
    }
    const { data: ya } = await supabase.from('alertas_tickets').select('id')
      .eq('registro_ticket_id', registroId).eq('tipo', 'articulo_no_autorizado').eq('resuelta', false).limit(1)
    const { error: e2 } = ya?.length
      ? await supabase.from('alertas_tickets').update({ correccion: articulos(noAut) }).eq('id', ya[0].id)
      : await supabase.from('alertas_tickets').insert({ registro_ticket_id: registroId, tipo: 'articulo_no_autorizado', correccion: articulos(noAut) })
    if (e2) console.error('alerta no autorizado fallo:', e2.message)
    creadas.push('articulo_no_autorizado')
  }
  if (ocas.length) {
    const { error: e3 } = await supabase.from('alertas_tickets').insert({
      registro_ticket_id: registroId, tipo: 'articulo_ocasional', correccion: articulos(ocas),
    })
    if (e3) { console.error('alerta ocasional fallo:', e3.message); creadas.push('error_uso') }
    creadas.push('articulo_ocasional')
  }
  return creadas
}
