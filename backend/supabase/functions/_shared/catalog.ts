import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface CatalogProduct {
  id: string
  nombre: string
  sinonimos: string[]
  categoria_nombre: string
  unidad_default: string | null
  precio_referencia: number | null
  veces_matched: number
}

export interface CatalogCategory {
  id: string
  nombre: string
}

export interface Catalog {
  products: CatalogProduct[]
  categories: CatalogCategory[]
}

// Carga el catalogo aplicable a una sucursal: lo global (sucursal_id NULL)
// mas lo especifico de esa sucursal. Sin sucursalId, solo lo global.
export async function loadCatalog(sucursalId?: string | null): Promise<Catalog> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const scope = sucursalId ? `sucursal_id.is.null,sucursal_id.eq.${sucursalId}` : null

  let catQ = supabase.from('categorias_gasto').select('id, nombre').eq('activa', true).order('orden')
  catQ = scope ? catQ.or(scope) : catQ.is('sucursal_id', null)
  const { data: categories } = await catQ

  let prodQ = supabase.from('catalogo_productos')
    .select('id, nombre, sinonimos, unidad_default, precio_referencia, veces_matched, categorias_gasto:categoria_id(nombre)')
    .eq('activo', true)
  prodQ = scope ? prodQ.or(scope) : prodQ.is('sucursal_id', null)
  const { data: products } = await prodQ

  return {
    categories: categories ?? [],
    products: (products ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      nombre: p.nombre as string,
      sinonimos: (p.sinonimos as string[]) ?? [],
      categoria_nombre: (p.categorias_gasto as { nombre: string })?.nombre ?? '',
      unidad_default: p.unidad_default as string | null,
      precio_referencia: p.precio_referencia as number | null,
      veces_matched: (p.veces_matched as number) ?? 0,
    })),
  }
}

export function buildCatalogPromptContext(catalog: Catalog): string {
  const catList = catalog.categories.map(c => c.nombre).join(', ')

  if (catalog.products.length === 0) {
    return `Categorias validas: ${catList}\n\nNo hay productos en el catalogo aun. Clasifica libremente usando las categorias anteriores.`
  }

  const prodLines = catalog.products.map(p => {
    const synonyms = p.sinonimos.length > 0 ? ` (tambien: ${p.sinonimos.join(', ')})` : ''
    const unit = p.unidad_default ? ` | unidad: ${p.unidad_default}` : ''
    return `- ${p.nombre}${synonyms} | categoria: ${p.categoria_nombre}${unit}`
  }).join('\n')

  return `Categorias validas: ${catList}\n\nProductos conocidos (usa estos para clasificar si aplican):\n${prodLines}`
}

export function resolveCategoria(
  name: string | null,
  categories: CatalogCategory[]
): CatalogCategory | null {
  if (!name) return null
  const n = name.trim().toLowerCase()
  if (!n) return null
  return (
    categories.find(c => c.nombre.toLowerCase() === n) ??
    categories.find(c => {
      const cn = c.nombre.toLowerCase()
      return cn.includes(n) || n.includes(cn)
    }) ??
    null
  )
}

// Normaliza: minusculas, sin acentos, solo letras/numeros/espacios.
function normaliza(s: string): string {
  const nfd = s.normalize('NFD')
  let out = ''
  for (const ch of nfd) {
    const code = ch.charCodeAt(0)
    if (code >= 0x300 && code <= 0x36f) continue // diacriticos
    out += /[a-zA-Z0-9 ]/.test(ch) ? ch : ' '
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function matchProductInCatalog(
  producto: string | null,
  products: CatalogProduct[]
): CatalogProduct | null {
  if (!producto) return null
  const d = normaliza(producto)
  if (!d) return null
  const dTokens = d.split(' ').filter(t => t.length >= 3)
  for (const p of products) {
    const candidatos = [p.nombre, ...p.sinonimos].map(normaliza).filter(Boolean)
    for (const c of candidatos) {
      if (d === c) return p
      if (d.includes(c) || c.includes(d)) return p
      // coincidencia por palabra: un token del catalogo (>=4) aparece en la descripcion
      const cTokens = c.split(' ').filter(t => t.length >= 4)
      if (cTokens.some(ct => dTokens.includes(ct) || d.includes(ct))) return p
    }
  }
  return null
}
