export const meta = {
  name: 'revisar-regla-bodega',
  description: 'Review the new handwritten-Bodega prompt rule for contradictions and scan the catalog for other Bodega candidates',
  phases: [{ title: 'Revisar' }],
}
const REPO = 'C:\\Users\\koach\\Documents\\Claude\\Projects\\revisión de tickets'
const BASE = `Proyecto "Revision de Tickets" en ${REPO}. Supabase ref dlmqqmvrgkilptawllep: puedes correr SOLO SELECTs de lectura cargando la herramienta con ToolSearch "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql". ESTRICTAMENTE SOLO LECTURA: nada de INSERT/UPDATE/DELETE, ni migraciones, ni despliegues, ni editar archivos. Si la herramienta Read te devuelve solo la linea 1 (hay un hook que trunca), lee con PowerShell: Get-Content -LiteralPath <ruta> -Encoding utf8.

Contexto de negocio: el cafe Santa Elena tiene ademas un tostador ("Bodega"). La categoria "Bodega" existe SOLO en la sucursal Santa Elena (sucursal_id de SE) y tiene cuenta_operativo=false, para que ese gasto no entre en el % de operacion del cafe. Wings Palace NO tiene esa categoria. Hoy son de Bodega: bolsas metalizadas para cafe, cinta de empaque (y su despachador) y el playo stretch en rollo (Reyma 1300 pies de Adan Melchor y Polpusa 1000 pies de El Bodegon). NO es de Bodega la pelicula para alimentos "clingfilm 30 cm" (la cocina la usa, y Wings tambien la compra). Alejandro acaba de dar una regla nueva: "si el ticket dice Bodega escrito a mano, es de Bodega seguro".`

phase('Revisar')
const [regla, catalogo] = await parallel([
  () => agent(`${BASE}

TAREA A: revisa la regla nueva del prompt de la IA. Lee backend/supabase/functions/_shared/gemini.ts COMPLETO (es el prompt que se le manda a Gemini) y evalua la linea que empieza con "- BODEGA (solo si". Busca problemas reales:
1) Contradicciones o ambiguedades con las otras reglas del mismo prompt (categorias validas, MOTOS Y ENVIOS, ENVIO ANOTADO A MANO, sospecha, descuentos, catalogo).
2) Casos que la regla resuelve mal: ticket mixto donde "Bodega" solo aplica a unos renglones; ticket de Wings (ahi NO existe la categoria Bodega: verifica que la regla no lo rompa); la palabra "bodega" que aparece en el NOMBRE del comercio (ej. "EL BODEGON DE SEMILLAS", "BODEGA AURRERA") y no es una anotacion a mano; "Bodega" escrito por el proveedor en su ticket impreso (almacen de salida) y no por la gerente.
3) Si la redaccion puede hacer que la IA mande a Bodega cosas de la cafeteria.
Propon la redaccion minima que corrija lo que encuentres, en el mismo estilo (texto plano sin acentos, una sola linea). Se concreto y breve.`, { label: 'revisar:regla', phase: 'Revisar' }),
  () => agent(`${BASE}

TAREA B: en la BASE EN VIVO, busca que OTROS productos del catalogo de Santa Elena podrian ser de Bodega (empaque/envio del cafe en grano del tostador) y hoy estan en otra categoria. Revisa catalogo_productos de SE con su categoria y cuantas compras tiene cada uno (ticket_items), y los renglones de SE sin producto ligado. Pistas de empaque/tostador: bolsa metalizada, valvula, etiqueta, caja, corrugado, fleje, zuncho, burbuja, papel kraft, cinta, playo/stretch/emplaye, bascula, selladora, granel, costal, tarima. Compara tambien con Wings Palace: si Wings compra lo mismo, probablemente es de cafeteria y NO de Bodega (ese es el mejor filtro).
Entrega una lista corta y priorizada: producto, categoria actual, compras y monto total, quien lo vende, si Wings tambien lo compra, y tu veredicto (probable Bodega / probable cafeteria / dudoso) con una linea de razon. No cambies nada.`, { label: 'revisar:catalogo', phase: 'Revisar' }),
])
return { regla, catalogo }
