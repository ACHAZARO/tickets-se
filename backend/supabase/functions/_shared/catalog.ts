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

export async function loadCatalog(): Promise<Catalog> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: categories } = await supabase
    .from('categorias_gasto')
    .select('id, nombre')
    .eq('activa', true)
    .order('orden')

  const { data: products } = await supabase
    .from('catalogo_productos')
    .select('id, nombre, sinonimos, unidad_default, precio_referencia, veces_matched, categorias_gasto:categoria_id(nombre)')
    .eq('activo', true)

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

export function matchProductInCatalog(
  producto: string | null,
  products: CatalogProduct[]
): CatalogProduct | null {
  if (!producto) return null
  const lower = producto.toLowerCase()
  return products.find(p =>
    p.nombre.toLowerCase() === lower ||
    p.sinonimos.some(s => s.toLowerCase() === lower) ||
    p.nombre.toLowerCase().includes(lower) ||
    lower.includes(p.nombre.toLowerCase()) ||
    p.sinonimos.some(s => lower.includes(s.toLowerCase()))
  ) ?? null
}
