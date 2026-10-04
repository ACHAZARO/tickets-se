// Formas de pago que declara el gerente al subir (tablas formas_pago / ticket_pagos, migracion 085).
// Una sola forma = todo el ticket (monto null). Varias = monto por cada una; si no suman el total leido
// (diferencia >= $1) el ticket lleva la alerta `pagos_no_cuadran` y no se aprueba solo.

// deno-lint-ignore no-explicit-any
type SB = any

export interface FormaPago { id: string; nombre: string; sale_de_caja: boolean }
export interface PagoDeclarado { forma_pago_id: string; monto: number | null }

const TOLERANCIA = 1 // pesos: centavos de redondeo no cuentan

// Formas activas de la cuenta, en el orden que eligio el admin.
export async function formasDeCuenta(supabase: SB, cuentaId: string): Promise<FormaPago[]> {
  const { data, error } = await supabase.from('formas_pago')
    .select('id, nombre, sale_de_caja').eq('cuenta_id', cuentaId).eq('activa', true)
    .order('orden').order('nombre')
  if (error) throw new Error('formas de pago: ' + error.message)
  return (data ?? []) as FormaPago[]
}

// Campo `pagos` del formulario: JSON [{forma_pago_id, monto}]. Devuelve los pagos limpios o un error para el gerente.
// Sin campo = [] (no registrado), para no tumbar una pantalla vieja abierta antes del cambio.
export function leerPagos(valor: FormDataEntryValue | null, formas: FormaPago[]): { pagos: PagoDeclarado[] } | { error: string } {
  if (typeof valor !== 'string' || !valor.trim()) return { pagos: [] }
  let crudo: unknown
  try { crudo = JSON.parse(valor) } catch { return { error: 'pagos no es JSON valido' } }
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > 10) return { error: 'pagos debe traer de 1 a 10 formas' }
  const validas = new Set(formas.map(f => f.id))
  const vistos = new Set<string>()
  const pagos: PagoDeclarado[] = []
  for (const p of crudo) {
    const id = typeof (p as { forma_pago_id?: unknown })?.forma_pago_id === 'string' ? (p as { forma_pago_id: string }).forma_pago_id : ''
    if (!validas.has(id)) return { error: 'Forma de pago no valida para este negocio' }
    if (vistos.has(id)) return { error: 'Forma de pago repetida' }
    vistos.add(id)
    const m = (p as { monto?: unknown }).monto
    const monto = typeof m === 'number' && Number.isFinite(m) ? Math.round(m * 100) / 100 : null
    pagos.push({ forma_pago_id: id, monto })
  }
  if (pagos.length === 1) {
    pagos[0].monto = null // una sola forma = todo el ticket
  } else if (pagos.some(p => p.monto === null || p.monto <= 0 || p.monto > 10_000_000)) {
    return { error: 'Con varias formas de pago escribe el monto de cada una' }
  }
  return { pagos }
}

// Guarda los pagos de un ticket (no bloquea: si falla, el ticket queda como "no registrado" y se registra en logs).
export async function guardarPagos(supabase: SB, registroId: string, pagos: PagoDeclarado[]): Promise<void> {
  if (!pagos.length) return
  const { error } = await supabase.from('ticket_pagos')
    .insert(pagos.map(p => ({ registro_ticket_id: registroId, forma_pago_id: p.forma_pago_id, monto: p.monto })))
  if (error) console.error('ticket_pagos insert fallo:', error.message)
}

// true si el ticket tiene montos declarados (pago mixto) que no suman su total.
export function pagosNoCuadran(pagos: { monto: number | null }[], total: number | null): boolean {
  const conMonto = pagos.filter(p => p.monto !== null)
  if (!conMonto.length) return false
  if (total === null || !Number.isFinite(Number(total))) return true
  const suma = conMonto.reduce((s, p) => s + Number(p.monto), 0)
  return Math.abs(suma - Number(total)) >= TOLERANCIA
}

export async function revisarPagos(supabase: SB, registroId: string, total: number | null): Promise<boolean> {
  const { data, error } = await supabase.from('ticket_pagos').select('monto').eq('registro_ticket_id', registroId)
  if (error) { console.error('ticket_pagos select fallo:', error.message); return false }
  return pagosNoCuadran(((data ?? []) as { monto: number | null }[]).map(p => ({ monto: p.monto === null ? null : Number(p.monto) })), total)
}
