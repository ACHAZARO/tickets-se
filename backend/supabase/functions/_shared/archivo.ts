// deno-lint-ignore no-explicit-any
type SB = any

// La foto que sube un gerente es evidencia: nunca se pierde (regla de Alejandro, 19-sep).
// Al confirmar, la foto se COPIA de 'por-revisar' a 'archivo/AAAA-MM/' y se verifica (mismo tamano). El original solo se
// quita despues, cuando el ticket ya apunta a la copia (quitarDePorRevisar). Si algo falla, la foto se queda en
// 'por-revisar' y el ticket la sigue mostrando desde ahi.
// Devuelve la ruta en 'archivo' solo si la copia quedo verificada; si no, null.
export async function copiarAArchivo(supabase: SB, origen: string, fecha: Date): Promise<string | null> {
  const mes = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
  const nombre = origen.split('/').pop() || origen
  const ruta = `${mes}/${nombre}`
  const { data: foto, error: bajarErr } = await supabase.storage.from('por-revisar').download(origen)
  if (bajarErr || !foto) {
    console.error('copiarAArchivo: no se pudo leer la foto', origen, bajarErr?.message)
    return null
  }
  const bytes = await foto.arrayBuffer()
  const { error: subirErr } = await supabase.storage.from('archivo')
    .upload(ruta, bytes, { contentType: foto.type || 'image/jpeg', upsert: true })
  if (subirErr) {
    console.error('copiarAArchivo: no se pudo copiar a archivo', ruta, subirErr.message)
    return null
  }
  const { data: lista, error: listaErr } = await supabase.storage.from('archivo').list(mes, { search: nombre, limit: 10 })
  const copia = ((lista ?? []) as { name: string; metadata?: { size?: number } | null }[]).find(o => o.name === nombre)
  if (listaErr || Number(copia?.metadata?.size) !== bytes.byteLength) {
    console.error('copiarAArchivo: copia sin verificar, el ticket sigue con el original', ruta, listaErr?.message)
    return null
  }
  return ruta
}

// Quita el original de 'por-revisar'. Llamar SOLO con la copia verificada y el ticket ya guardado apuntando a ella.
export async function quitarDePorRevisar(supabase: SB, origen: string): Promise<void> {
  const { error } = await supabase.storage.from('por-revisar').remove([origen])
  if (error) console.error('quitarDePorRevisar: el original se queda en por-revisar', origen, error.message)
}
