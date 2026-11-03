export function slugify(s: string): string {
  // quita acentos sin usar caracteres combinantes literales en el fuente
  const sinAcentos = s.normalize('NFD').split('').filter(c => {
    const code = c.charCodeAt(0)
    return code < 0x0300 || code > 0x036f
  }).join('')
  return sinAcentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
