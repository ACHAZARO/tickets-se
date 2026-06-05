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

export interface CatalogComercio {
  nombre: string
  // categoria fijada manualmente por el admin (override fuerte). null = no forzada.
  categoriaForzada: string | null
  // categorias que la IA ya ha visto en ese comercio (puede ser mas de una; ej. Costco).
  categoriasObservadas: string[]
}

export interface Catalog {
  products: CatalogProduct[]
  categories: CatalogCategory[]
  comercios: CatalogComercio[]
}

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>

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

  let comQ = supabase.from('comercios')
    .select('nombre, categorias_gasto:categoria_id(nombre)')
    .order('veces', { ascending: false }).limit(80)
  comQ = scope ? comQ.or(scope) : comQ.is('sucursal_id', null)
  const { data: comercios } = await comQ

  // Categorias observadas por comercio (a partir de los renglones ya clasificados).
  const observadas = new Map<string, Map<string, number>>()
  if (sucursalId) {
    const { data: tiData } = await supabase.from('ticket_items')
      .select('categorias_gasto:categoria_id(nombre), registros_tickets!inner(comercio, sucursal_id)')
      .not('categoria_id', 'is', null)
      .eq('registros_tickets.sucursal_id', sucursalId)
      .limit(2000)
    for (const row of (tiData ?? []) as AnyRow[]) {
      const com = (row.registros_tickets?.comercio ?? '').trim()
      const cat = row.categorias_gasto?.nombre
      if (!com || !cat) continue
      const key = com.toLowerCase()
      if (!observadas.has(key)) observadas.set(key, new Map())
      const m = observadas.get(key)!
      m.set(cat, (m.get(cat) ?? 0) + 1)
    }
  }

  return {
    categories: categories ?? [],
    products: (products ?? []).map((p: AnyRow) => ({
      id: p.id as string,
      nombre: p.nombre as string,
      sinonimos: (p.sinonimos as string[]) ?? [],
      categoria_nombre: (p.categorias_gasto as { nombre: string })?.nombre ?? '',
      unidad_default: p.unidad_default as string | null,
      precio_referencia: p.precio_referencia as number | null,
      veces_matched: (p.veces_matched as number) ?? 0,
    })),
    comercios: (comercios ?? []).map((c: AnyRow) => {
      const obs = observadas.get((c.nombre as string).toLowerCase())
      const categoriasObservadas = obs
        ? [...obs.entries()].sort((a, b) => b[1] - a[1]).map(([nombre]) => nombre)
        : []
      return {
        nombre: c.nombre as string,
        categoriaForzada: (c.categorias_gasto as { nombre: string })?.nombre ?? null,
        categoriasObservadas,
      }
    }),
  }
}

export function buildCatalogPromptContext(catalog: Catalog): string {
  const catList = catalog.categories.map(c => c.nombre).join(', ')

  const comerciosUtiles = catalog.comercios.filter(
    c => c.categoriaForzada || c.categoriasObservadas.length > 0
  )
  const comercioBlock = comerciosUtiles.length > 0
    ? `\n\nComercios conocidos (pista para clasificar; un comercio puede vender de varias categorias):\n${comerciosUtiles.map(c => {
        if (c.categoriaForzada) return `- ${c.nombre} -> casi siempre: ${c.categoriaForzada}`
        if (c.categoriasObservadas.length === 1) return `- ${c.nombre} -> normalmente: ${c.categoriasObservadas[0]}`
        return `- ${c.nombre} -> vende de varias categorias (${c.categoriasObservadas.join(', ')}); clasifica cada producto por si mismo`
      }).join('\n')}`
    : ''

  if (catalog.products.length === 0) {
    return `Categorias validas: ${catList}${comercioBlock}\n\nNo hay productos en el catalogo aun. Clasifica usando las categorias y los comercios conocidos.`
  }

  const prodLines = catalog.products.map(p => {
    const synonyms = p.sinonimos.length > 0 ? ` (tambien: ${p.sinonimos.join(', ')})` : ''
    const unit = p.unidad_default ? ` | unidad: ${p.unidad_default}` : ''
    return `- ${p.nombre}${synonyms} | categoria: ${p.categoria_nombre}${unit}`
  }).join('\n')

  return `Categorias validas: ${catList}${comercioBlock}\n\nProductos conocidos (usa estos para clasificar si aplican):\n${prodLines}`
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
