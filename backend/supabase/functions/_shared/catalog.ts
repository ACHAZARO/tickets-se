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

// Lo propio del negocio dueno de la sucursal. Vive en la BD (por cuenta/sucursal), NUNCA en el codigo compartido:
// la app se usa para varios negocios y lo que uno ensena no debe afectar a otro.
export interface CatalogNegocio {
  // Como se llama el negocio que COMPRA (para no confundirlo con el proveedor).
  compradores: string[]
  // Nombres de las sucursales de la cuenta (sus palabras no distinguen a un proveedor).
  sucursales: string[]
  // Reglas de lectura propias del negocio (tabla reglas_ia), ya ordenadas.
  reglas: string[]
  // Si no se pudo leer lo del negocio, el motivo. Con esto el ticket NO se lee (quedaria sin sus reglas, p. ej. Bodega).
  fallo: string | null
}

export interface Catalog {
  products: CatalogProduct[]
  categories: CatalogCategory[]
  comercios: CatalogComercio[]
  negocio: CatalogNegocio
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

  const negocio = await cargarNegocio(supabase, sucursalId ?? null)

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
    negocio,
  }
}

// Nombres del comprador y reglas propias del negocio: los de la CUENTA de la sucursal (las sucursales de prueba no
// prestan su nombre a las demas). Si no se pueden leer, devuelve `fallo` y el ticket NO se lee (queda para releer).
// deno-lint-ignore no-explicit-any
async function cargarNegocio(supabase: any, sucursalId: string | null): Promise<CatalogNegocio> {
  const vacio: CatalogNegocio = { compradores: [], sucursales: [], reglas: [], fallo: null }
  if (!sucursalId) return vacio
  try {
    const { data: suc, error: errCuenta } = await supabase.from('sucursales').select('cuenta_id').eq('id', sucursalId).maybeSingle()
    if (errCuenta) return { ...vacio, fallo: 'no se pudo leer la cuenta de la sucursal: ' + errCuenta.message }
    const cuentaId = (suc?.cuenta_id as string | null) ?? null
    if (!cuentaId) return vacio
    const [{ data: hermanas, error: errSuc }, { data: reglas, error: errReglas }] = await Promise.all([
      supabase.from('sucursales').select('id, nombre, nombres_cliente, es_prueba').eq('cuenta_id', cuentaId).order('nombre'),
      supabase.from('reglas_ia').select('texto, sucursal_id, orden').eq('cuenta_id', cuentaId).eq('activa', true)
        .or(`sucursal_id.is.null,sucursal_id.eq.${sucursalId}`).order('orden', { ascending: true }),
    ])
    // supabase-js no lanza: si esto falla el ticket se leeria SIN las reglas del negocio (playo y bolsas a Desechables,
    // motos de la familia a gasto operativo) y podria auto-confirmarse asi. Mejor no leerlo: queda para releer.
    if (errSuc || errReglas) {
      const motivo = (errSuc ?? errReglas).message
      console.error('cargarNegocio: no se pudo leer lo propio del negocio:', motivo)
      return { ...vacio, fallo: 'no se pudieron leer las reglas del negocio: ' + motivo }
    }
    const propias = ((hermanas ?? []) as AnyRow[]).filter(s => !s.es_prueba || s.id === sucursalId)
    const sucursales = propias.map(s => String(s.nombre ?? '').trim()).filter(Boolean)
    // Como aparece el negocio en los tickets: sucursales.nombres_cliente; si no se capturo, el nombre de la sucursal.
    const compradores = [...new Set(propias.flatMap(s => {
      const alias = ((s.nombres_cliente as string[] | null) ?? []).map(n => String(n ?? '').trim()).filter(Boolean)
      return alias.length ? alias : [String(s.nombre ?? '').trim()]
    }).filter(Boolean))]
    return {
      compradores, sucursales, fallo: null,
      reglas: ((reglas ?? []) as AnyRow[]).map(r => String(r.texto ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    }
  } catch (e) {
    console.error('cargarNegocio:', e)
    return { ...vacio, fallo: 'no se pudieron leer las reglas del negocio: ' + String((e as Error)?.message ?? e) }
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

// Palabras que no identifican un producto: conectores, envases, unidades.
const GENERICAS = new Set([
  'de', 'la', 'el', 'los', 'las', 'del', 'con', 'sin', 'para', 'en', 'al', 'y',
  'bot', 'botella', 'lata', 'caja', 'cj', 'pz', 'pza', 'pzas', 'pzs', 'pieza', 'piezas', 'pk', 'pack',
  'kg', 'kgs', 'kilo', 'kilos', 'gr', 'grs', 'gramos', 'ml', 'lt', 'lts', 'litro', 'litros',
  'nr', 'std', 'pet', 'lean', 'gal', 'galon', 'mts',
  'grande', 'grandes', 'chico', 'chica', 'chicos', 'mediano', 'mediana',
])

// Singular aproximado para comparar: limones -> limon, cebollines -> cebollin, jitomates -> jitomate.
function singular(t: string): string {
  if (t.length < 4 || !t.endsWith('s')) return t
  if (t.endsWith('es') && /[nlrdz]$/.test(t.slice(0, -2))) return t.slice(0, -2)
  return t.slice(0, -1)
}

// Palabras que identifican (sin numeros ni codigos, 2+ letras): "XX AMBAR STD 1x20" -> xx, ambar.
function palabras(s: string): string[] {
  return [...new Set(normaliza(s).split(' ').filter(t => t.length >= 2 && !/\d/.test(t) && !GENERICAS.has(t)).map(singular))]
}

// Una palabra del catalogo aparece en el renglon: igual, o una es inicio de la otra con 5+ letras
// (Costco corta a 20 caracteres: "MEZQUI" -> "MEZQUITE", "AMERIC" -> "AMERICANO").
function aparece(t: string, en: Set<string>): boolean {
  if (en.has(t)) return true
  for (const w of en) if ((w.length >= 5 && t.startsWith(w)) || (t.length >= 5 && w.startsWith(t))) return true
  return false
}

// Presentaciones escritas en el texto: 325ml, 1.18l, 2kg, 1x20, 12/1, 12pk.
function medidas(s: string): Set<string> {
  const t = s.toLowerCase().replace(/,/g, '.')
  const m = t.match(/\d*\.?\d+\s*(?:ml|lts?|l|kgs?|grs?|g|oz)(?![a-z])|\d+\s*x\s*\d+|\d+\s*\/\s*\d*\.?\d+|\d+\s*(?:pk|pack)(?![a-z])/g) ?? []
  return new Set(m.map(x => x.replace(/\s+/g, '').replace(/lts?$/, 'l').replace(/kgs$/, 'kg').replace(/grs?$/, 'g').replace(/pack$/, 'pk')))
}

// Liga un renglon a un producto del catalogo. Antes bastaba UNA palabra en comun ("queso"
// ligaba "Queso americano" con "Dedos de queso Farm Rich"); ahora:
// 1) igual al nombre o a un sinonimo (sin acentos ni signos) -> ese producto;
// 2) si no, el renglon debe traer todas las palabras del candidato (3/4 si tiene 4+), el
//    candidato debe explicar mas de la mitad de las palabras del renglon (una presentacion
//    igual cuenta como una palabra) y si ambos traen presentacion (325ml vs 1.18L) debe coincidir;
// 3) gana el de mayor proporcion de palabras en comun, no el primero de la lista.
// Candidatos solo con numeros o codigos ("730", "61") solo cuentan como exactos.
export function matchProductInCatalog(
  producto: string | null,
  products: CatalogProduct[]
): CatalogProduct | null {
  if (!producto) return null
  const d = normaliza(producto)
  if (!d) return null
  const dPal = new Set(palabras(producto))
  const dMed = medidas(producto)
  let mejor: CatalogProduct | null = null
  let mejorPuntos = 0
  for (const p of products) {
    const medNombre = medidas(p.nombre)
    for (const cand of [p.nombre, ...p.sinonimos]) {
      const c = normaliza(cand)
      if (!c) continue
      if (d === c) return p
      const cPal = palabras(cand)
      if (!cPal.length) continue
      const comunes = cPal.filter(t => aparece(t, dPal)).length
      const necesarias = cPal.length <= 3 ? cPal.length : Math.ceil(cPal.length * 0.75)
      if (comunes < necesarias) continue
      const pMed = new Set([...medNombre, ...medidas(cand)])
      const medidaIgual = [...pMed].some(x => dMed.has(x))
      if (dMed.size && pMed.size && !medidaIgual) continue
      const explica = comunes + (medidaIgual ? 1 : 0)
      if (explica * 2 <= dPal.size) continue
      const puntos = comunes / cPal.length + (comunes / Math.max(dPal.size, 1)) * 0.5 + Math.min(p.veces_matched, 99) * 0.00001
      if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = p }
    }
  }
  return mejor
}
