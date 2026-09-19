export const meta = {
  name: 'revision-tickets-contra-foto',
  description: 'Revisar tickets contra su foto (lectura final por renglon, categoria y producto) para una sucursal',
  phases: [
    { title: 'Revision', detail: 'revisores de ~15 tickets cada uno, foto vs lectura IA' },
    { title: 'Pares', detail: 'comparar pares sospechosos de la misma compra' },
  ],
}

const SCRATCH = 'C:/Users/koach/AppData/Local/Temp/claude/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/e7f6dfb4-e5f5-41ea-a429-fd126748f38b/scratchpad'
const IDS = args.ids
const TAM = args.tam || 15
const SUC = args.suc
const SUC_ID = SUC === 'SE' ? 'fb61b496-894f-4706-98ec-ebb49513fcf3' : '84a4c372-c6b8-481f-a700-374423348aa1'
const CATS = ['Insumos Alimentos', 'Desechables', 'Limpieza', 'Gas', 'Luz', 'Otros gastos operativos', 'Extras', 'Descuentos']

const SCHEMA = {
  type: 'object',
  properties: {
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID completo del ticket' },
          veredicto: { type: 'string', enum: ['ok', 'corregir', 'dudoso', 'no_es_gasto'] },
          fecha: { type: ['string', 'null'], description: 'YYYY-MM-DD segun la foto; null si no se lee' },
          fecha_asumida: { type: 'boolean', description: 'true si la fecha NO viene en el comprobante y la tomaste de la hoja de abajo o del dia de subida' },
          comercio: { type: ['string', 'null'], description: 'quien VENDE (nunca el restaurante/cafe cliente)' },
          total: { type: ['number', 'null'], description: 'TOTAL pagado impreso/escrito (con impuestos)' },
          subtotal: { type: ['number', 'null'], description: 'subtotal impreso antes de impuestos, si lo hay' },
          iva: { type: ['number', 'null'], description: 'IVA impreso, si lo hay' },
          ieps: { type: ['number', 'null'], description: 'IEPS impreso aparte, si lo hay' },
          folio: { type: ['string', 'null'] },
          tipo_documento: { type: 'string', enum: ['ticket', 'factura', 'nota_a_mano', 'remision', 'otro'] },
          renglones: {
            type: 'array',
            description: 'Lista FINAL completa de renglones del ticket (no solo los cambios)',
            items: {
              type: 'object',
              properties: {
                descripcion: { type: 'string', description: 'texto LITERAL del ticket, sin notas tuyas' },
                cantidad: { type: ['number', 'null'] },
                unidad: { type: ['string', 'null'] },
                monto: { type: ['number', 'null'], description: 'importe del renglon TAL COMO ESTA IMPRESO (en facturas, antes de IVA)' },
                categoria: { type: 'string', enum: CATS },
                producto: { type: ['string', 'null'], description: 'Nombre EXACTO de un producto existente del catalogo, o null' },
                producto_nuevo: { type: ['string', 'null'], description: 'Si no hay producto existente adecuado: nombre canonico sugerido para crearlo' },
              },
              required: ['descripcion', 'cantidad', 'unidad', 'monto', 'categoria', 'producto', 'producto_nuevo'],
            },
          },
          cambios: { type: 'string', description: 'Que corregiste respecto a la lectura IA (vacio si nada)' },
          motivo_duda: { type: ['string', 'null'], description: 'Solo si veredicto=dudoso: que debe revisar el gerente' },
        },
        required: ['id', 'veredicto', 'fecha', 'fecha_asumida', 'comercio', 'total', 'subtotal', 'iva', 'ieps', 'folio', 'tipo_documento', 'renglones', 'cambios', 'motivo_duda'],
      },
    },
  },
  required: ['tickets'],
}

const COMUNES = `
IMPUESTOS: captura cada renglon con el importe TAL COMO ESTA IMPRESO (en facturas CFDI y remisiones con IVA desglosado, eso es ANTES de IVA). NO agregues renglones de IVA ni IEPS y NO los sumes a los renglones: pon total (con impuestos), subtotal, iva e ieps en sus campos; el sistema reparte los impuestos solo. En tickets de super donde los precios YA incluyen IVA ("precios incluyen impuestos", "IVA incluido"), los renglones suman el total: igual pon subtotal/iva si vienen impresos, no pasa nada.
DESCUENTOS: van como renglon aparte con monto NEGATIVO y categoria "Descuentos" (cupones, "CUPON DE DESCUENTO", promociones, ahorro, redondeo a favor).
Fechas: en Mexico se escribe dia/mes/ano. La fecha es de 2026 y NO puede ser posterior al dia en que se subio (columna "subido" de la consulta). La app existe desde junio 2026: una fecha anterior casi seguro esta mal leida (05/08 es 5 de agosto, no 8 de mayo). Impresoras de ruta de Cervezas y Refrescos imprimen MES-DIA-ANO. Si el ano se lee raro (2020, 2024, 2028) usa 2026. Si el comprobante NO trae fecha: usa la fecha escrita en la hoja o libreta que se vea debajo; si tampoco, el dia de subida; pon fecha_asumida=true (eso solo NO lo hace dudoso). Si hay fecha pero de plano no se lee, fecha=null y "dudoso".
Notas a mano: el monto de cada renglon es el importe total del renglon (no precio unitario). La unidad debe dar un precio unitario razonable ("limones 6 ... $7" son 6 pz, no kg). Si la nota no dice unidad, elige la que haga sentido.
TOTAL IMPRESO vs ESCRITO A MANO: si un ticket impreso por maquina trae ademas un total escrito a mano distinto (p. ej. "Total $3,009" o "445 con envio" sobre un ticket de $248 o $385.20), el total es el IMPRESO y el ticket es "dudoso" con motivo "total escrito a mano ($X) distinto del impreso ($Y)".
Revisa que la suma de renglones (+ descuentos, + impuestos en facturas) cuadre con el total. Si no cuadra y la foto no lo explica, o hay numeros encimados, tachados, con corrector o con otra tinta en cantidades o totales, marca "dudoso" con el motivo (posible alteracion).
Si en TU lote dos fotos son el MISMO papel (mismo folio/fecha/hora/total), la segunda es "no_es_gasto" con "foto repetida de <id8>" en cambios. Compras que se repiten cada semana con el mismo monto (setas, garrafones, pan, pipa) NO son duplicado. Si ves factura y ticket/remision de la MISMA compra, marca ambos "dudoso" con motivo "factura + ticket de la misma compra (folios ...)".
Una foto que no es un gasto (otra cosa, estado de cuenta, hoja sin importes) => "no_es_gasto" con la explicacion en cambios.
"producto": elige SOLO si un producto existente del catalogo es de verdad el mismo articulo Y la misma presentacion. Si no hay, producto=null y en producto_nuevo propone un nombre canonico corto y reutilizable (sin marcas raras de la impresora, sin codigos). Para verduras/frutas comunes usa el producto existente aunque la descripcion este en plural o con error. La descripcion SIEMPRE literal, sin comentarios tuyos entre parentesis.`

const REGLAS_SE = `
REGLAS DEL NEGOCIO (Santa Elena: cafeteria y tostador de cafe en Xalapa, Veracruz — "el cafe"). "Santa Elena" / "Cafe Santa Elena" es el CLIENTE (el propio cafe): NUNCA lo pongas como comercio. El comercio es quien vende; si el papel no dice quien vende, usa un nombre generico estable: "Panaderia (nota de remision)" para las notas de pan dulce, "Hielo (nota)" para hielo, etc.
Categorias (usa exactamente estos nombres):
- "Insumos Alimentos": lo que se prepara o vende: pan dulce y pasteles, verdura, fruta, pollo, carne, huevo, queso, leche, crema, mantequilla, tortilla y masa, setas, jugos (Jugotropick: naranja por galon), agua purificada en garrafon (Le Fresh -> producto "GARRAFON", unidad pz), agua mineral y refrescos, hielo (unidad "bolsa"), cafe verde o tostado, azucar, chocolate, harina, aceite de cocina ("AVE ACTION FRY" es ACEITE), condimentos.
- "Desechables": empaques: vasos, tapas, popotes, servilletas, contenedores/clamshell, envases, bolsas (incluye "BOLSA TIPICO" que cobra el super y las bolsas metalizadas para cafe), playo/strech, aluminio, cinchos, rafia, cinta de empaque, etiquetas.
- "Limpieza": cloro, jabon, desengrasante, fibras, esponjas, papel higienico, toallas, mandiles y guantes sanitarios, bolsas de basura.
- "Gas": SOLO gas LP. Gas del Atlantico vende GAS LP (aunque la IA haya leido "gasolina"): producto_nuevo "Gas LP", unidad lt, cantidad = litros. La gasolina NO es Gas.
- "Luz": recibo CFE.
- "Otros gastos operativos": necesario para operar pero no es insumo: papeleria (hojas, tinta de sellos, plumas), mantenimiento, refacciones, herramientas, fumigacion, internet, accesorios del negocio (cargador, cables), farmacia/botiquin, gasolina.
- "Extras": NO operativo: "MOTO" (regla fija de Santa Elena: toda moto va a Extras, no es dudoso), comida o cosas personales del dueno o del personal, donativos.
- "Descuentos": ver regla de descuentos (nunca en Extras).
PAN DULCE: las notas de remision "Cliente: Santa Elena" son pedidos de pan de una panaderia. Casi nunca traen importe por renglon, solo TOTAL. Si total / (suma de piezas) da un precio parejo (normalmente $20 por pieza), pon monto = piezas x ese precio en cada renglon. Si hay importes escritos, usalos. Si no cuadra de ninguna forma, reparte al precio mas razonable, explica en cambios y marca "dudoso" solo si el total escrito no es claro. Si aparece un segundo numero suelto fuera del recuadro (p. ej. "#1020" abajo), NO es el total: el total es el del recuadro TOTAL (mencionalo en cambios).
Productos del pan (usa estos nombres EXACTOS del catalogo): "Choco"/"Chocolate" -> "Pasteles Chocolate"; "Roles"/"Rol" -> "PAN ROL"; "Almendra" -> "PAN DE ALMENDRA"; "Guayaba"/"Guayana" -> "PAN DE GUAYABA"; "Zarza" -> "Pan de Zarzamora"; "Nutella" -> "Pan de Nutella"; "Pistache" -> "Pan de pistache"; "Pina" -> "Pan de Piña"; "Requeson" -> "Pan de Requesón"; "Higo" -> "Pan de Higo"; "Cajeta" -> "Pan de Cajeta"; "Croissant" -> "Croissants". Para "Manzana" en nota de pan usa producto_nuevo "Pan de manzana"; "Arandano" -> producto_nuevo "Pan de arandano". Unidad pz.
Otros nombres ya decididos: Le Fresh "Liquidos"/"agua" = garrafon -> "GARRAFON"; queso fresco a granel del super -> producto_nuevo "Queso fresco" (NO es "QUESO BORONA", que es otro proveedor); "LECHE D" de la panaderia -> producto_nuevo "Leche deslactosada"; "LECHE E" -> "Leche entera"; cebolla morada -> producto_nuevo "Cebolla morada" (no es "CEBOLLA"); naranja fruta a granel -> producto_nuevo "Naranja (fruta)" (no es "Naranja Galon", que es jugo).
Productos BASURA del catalogo (NO los uses nunca, estan mal escritos o mal ligados): "Almenda.", "Almenra", "Arindano", "Guayaana.", "Guaynac", "Pistene", "Rel", "Requesun", "Zarta", "LECHE D", "25 x seta Charola de Setas" (usa "SETAS"), "agua purificada" (usa "GARRAFON"), "Nutella", "Cajeta", "Higo", "Manzana", "Piña" (en notas de pan usa los "Pan de ..."; "Manzana"/"Piña" solo si de verdad es la fruta), "Aguacates" (usa "AGUACATE"), "LIMON" (usa "Limones"), "CEBOLLINES" (usa "Cebollin"). "PECHUGA ENTERA" solo si de verdad es pechuga de pollo.`

const REGLAS_WP = `
REGLAS DEL NEGOCIO (Wings Palace, restaurante de alitas en Xalapa, Veracruz). "Wings Palace"/"Restaurant Wings Palace" es el CLIENTE: nunca lo pongas como comercio.
Categorias (usa exactamente estos nombres):
- "Insumos Alimentos": comida y bebida para preparar o vender (verdura, fruta, carne, pan, quesos, salsas, aceite de cocina, cerveza, refresco, agua embotellada, hielo, jugos, licores del bar).
- "Desechables": bolsas, cajas H21, servilletas, vasos, tapas, charolas, popotes, aluminio, playo, contenedores, rollos de bolsa.
- "Limpieza": cloro, desengrasante, fabuloso, fibras, esponjas, jabon, papel higienico, mechudos, escobas, desinfectante.
- "Gas": SOLO gas LP de cocina (pipa/cilindro; "LITROS: 75 L" de una gasera es gas LP). La gasolina NO es Gas.
- "Luz": recibo de luz CFE.
- "Otros gastos operativos": necesario para operar pero no es insumo: "Moto servicio" (moto que trae insumos), viaje/pipa de agua (Pipas Ramirez / Aguas Ramirez, producto "Viaje de agua 10,000 litros"), vacaciones y prima vacacional, fumigacion, internet, mantenimiento, refacciones, herramientas, papeleria, gasolina.
- "Extras": NO operativo: envios al dueno ("Ale moto", envio Ale, envio mama Polo), comida para el dueno o personal, cosas personales, redondeo/donativo.
MOTOS (decision del dueno 18-sep): "Moto servicio", moto con nombre de empleado ("Lindsay", "Fer Villanueva") o moto sin concepto de ~$50-90 = motorista que trae insumos -> "Otros gastos operativos", producto "Moto servicio", NO dudoso. Solo los envios al dueno ("Ale moto", "envio Ale", "mama Polo") van a Extras.
- "Descuentos": ver regla de descuentos.
Productos: "Viaje de agua 10,000 litros" SOLO para pipas de agua (nunca gas, aceite ni agua embotellada).`

const CONSULTA = (ids) => `
Usa la herramienta de Supabase execute_sql (cargala con ToolSearch: "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql"), project_id "dlmqqmvrgkilptawllep". SOLO LECTURA: nunca hagas insert/update/delete.

1) Tus tickets (${ids.length}). Ejecuta:
select r.id, r.estado, (r.created_at at time zone 'America/Mexico_City')::date subido, r.fecha_ticket, r.comercio, r.monto, r.folio_ticket, r.gemini_raw->>'tipo_documento' tipo, r.gemini_raw->>'subtotal' subtotal, r.gemini_raw->>'iva' iva,
  (select url from _tmp_firmas f where f.id=r.id::text order by creado desc limit 1) url,
  (select string_agg(a.tipo, ',') from alertas_tickets a where a.registro_ticket_id=r.id and not a.resuelta) alertas,
  (select json_agg(json_build_object('descripcion',i.descripcion,'cantidad',i.cantidad,'unidad',i.unidad,'monto',i.monto,'categoria',c.nombre,'producto',p.nombre) order by i.orden)
     from ticket_items i left join categorias_gasto c on c.id=i.categoria_id left join catalogo_productos p on p.id=i.producto_catalogo_id where i.registro_ticket_id=r.id) renglones
from registros_tickets r where r.id in (${ids.map(i => `'${i}'`).join(',')}) order by r.created_at, r.id;
(Si renglones viene vacio, la IA no leyo el ticket: leelo tu completo desde la foto.)

2) Catalogo de productos disponible:
select p.nombre, p.sinonimos, c.nombre categoria, p.unidad_default from catalogo_productos p left join categorias_gasto c on c.id=p.categoria_id
where p.activo and (p.sucursal_id is null or p.sucursal_id='${SUC_ID}') order by c.nombre, p.nombre;

3) Descarga cada foto con Bash (curl) a ${SCRATCH}/imgs/<id>.jpg si no existe ya:
curl -sS -o "${SCRATCH}/imgs/<id>.jpg" "<url>"
(No imprimas ni repitas las URLs en tu respuesta final: son enlaces firmados.) Si una foto no baja, devuelve el ticket con veredicto "dudoso" y motivo "sin foto".

4) Abre cada foto con la herramienta Read y comparala con la lectura de la IA: fecha, comercio (quien vende), total/subtotal/iva, folio, cada renglon (descripcion literal, cantidad, unidad, monto impreso), categoria y producto del catalogo. Se conservador y cuidadoso con la letra a mano; si la foto es grande o borrosa, vuelve a leer con cuidado antes de decidir.
`

const REGLAS = (SUC === 'SE' ? REGLAS_SE : REGLAS_WP) + COMUNES + (args.nota ? '\n' + args.nota : '')

phase('Revision')
const trozos = []
for (let i = 0; i < IDS.length; i += TAM) trozos.push(IDS.slice(i, i + TAM))
const revisar = trozos.map((ids, k) => () => agent(
  `Eres un auditor contable revisando tickets de gastos de un negocio. La IA ya leyo (o intento leer) cada ticket; tu trabajo es comparar CADA ticket contra su FOTO y devolver la version correcta.
${CONSULTA(ids)}
${REGLAS}
Devuelve un objeto por CADA uno de tus ${ids.length} tickets. veredicto:
- "ok": la lectura de la IA es correcta. Aun asi llena renglones con la lista final, con producto/producto_nuevo correctos.
- "corregir": habia errores y los corregiste con seguridad viendo la foto.
- "dudoso": algo no se puede decidir con la foto (fecha ilegible, suma que no cuadra, posible alteracion, sin foto, factura+ticket de la misma compra). Pon lo mejor que puedas leer y explica en motivo_duda (en espanol claro, para el dueno).
- "no_es_gasto": la foto no es un comprobante de gasto o es foto repetida.
En "cambios" describe brevemente (en espanol) que corregiste.`,
  { label: `revisor ${SUC} ${k + 1} (${ids.length})`, phase: 'Revision', schema: SCHEMA },
))

const PARES_SCHEMA = {
  type: 'object',
  properties: {
    pares: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'string' }, b: { type: 'string' },
          misma_compra: { type: 'boolean' },
          cual_es_factura: { type: ['string', 'null'], description: 'id8 del que es factura CFDI, si alguno' },
          explicacion: { type: 'string' },
        },
        required: ['a', 'b', 'misma_compra', 'cual_es_factura', 'explicacion'],
      },
    },
  },
  required: ['pares'],
}
const tareas = [...revisar]
if (args.pares && args.pares.length) {
  tareas.push(() => agent(
    `Eres auditor contable. Compara estos pares de comprobantes de Wings Palace y decide si cada par es la MISMA compra documentada dos veces (p. ej. factura CFDI + ticket/remision de la misma entrega) o dos compras distintas (p. ej. el mismo pedido semanal repetido otro dia).
Pares (ids): ${JSON.stringify(args.pares)}
Usa execute_sql (ToolSearch "select:mcp__857ab90d-2b53-46fb-8ad3-5f1263bb5328__execute_sql", project_id "dlmqqmvrgkilptawllep", SOLO LECTURA) para obtener de cada id: fecha_ticket, comercio, monto, folio_ticket, created_at y la url firmada: select r.id, r.fecha_ticket, r.comercio, r.monto, r.folio_ticket, (select url from _tmp_firmas f where f.id=r.id::text order by creado desc limit 1) url from registros_tickets r where r.id::text like any (array[...'id%'...]).
Descarga cada foto con curl a ${SCRATCH}/imgs/<id>.jpg y abrela con Read. Compara folios, referencias cruzadas (una factura suele citar el numero de remision/pedido), fecha y hora, cliente, productos y montos. No repitas las URLs en tu respuesta.`,
    { label: 'pares WP julio', phase: 'Pares', schema: PARES_SCHEMA },
  ))
}
const resultados = await parallel(tareas)
const revs = resultados.slice(0, revisar.length).filter(Boolean)
const todos = revs.flatMap(r => r.tickets || [])
const faltan = IDS.filter(id => !todos.some(t => t.id === id))
const pares = args.pares && args.pares.length ? resultados[resultados.length - 1] : null
const cuenta = {}
for (const t of todos) cuenta[t.veredicto] = (cuenta[t.veredicto] || 0) + 1
log(`Revisados ${todos.length} de ${IDS.length}; faltan ${faltan.length}`)
return { total: todos.length, faltan, cuenta, pares }