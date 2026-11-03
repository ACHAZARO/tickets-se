// Reduce la foto antes de subir sin destruir texto chico del ticket. Mantener
// mas resolucion que antes es clave para OCR; el timeout evita que se cuelgue.
export async function comprimirImagen(file: File, maxLado = 2400, calidad = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', calidad))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

// La compresion no puede colgar el envio: si tarda mas de 8 s, va la original.
export function comprimirConTope(file: File): Promise<Blob> {
  return Promise.race<Blob>([
    comprimirImagen(file),
    new Promise<Blob>(resolve => setTimeout(() => resolve(file), 8000)),
  ])
}
