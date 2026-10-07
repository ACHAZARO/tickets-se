# PENDIENTES_APP.md — Mejoras de la app (para la rama `rediseno-pistache` antes del push a `main`)

> Lista viva de mejoras que salieron al revisar tickets reales. Cada punto dice QUE pasa hoy, POR QUE importa y QUE hacer.
> Al terminar uno, marcarlo con fecha y moverlo al final ("Hecho"). Estado general del proyecto: `PROJECT_STATE.md`.

## Pendientes

### 1. Confirmar un ticket debe cerrar su revision de Fraude (06-oct-2026, Alejandro)
- **Hoy:** si un ticket esta en Fraude (`sospecha_estado = 'abierta'`) y el admin lo confirma desde Tickets, queda confirmado
  PERO sigue en la pestana Fraude. Paso varias veces con septiembre de Wings Palace.
- **Hacer:** al confirmar (boton "Guardar y confirmar ticket"), si hay sospecha abierta, preguntar "Este ticket esta en Fraude.
  ¿Lo das por bueno?" -> Si: `sospecha_estado = 'descartada'`, `sospechoso = false`. No cerrarla en silencio (evidencia).
- **Ojo:** `confirmar-admin` es el que confirma; la pregunta va en la pantalla, la escritura puede ir en la misma llamada.

### 2. Rechazar UN renglon dentro de un ticket desde Fraude / Tickets (06-oct-2026)
- **Caso:** Farmacia Guadalajara 18-sep $165.50: galleta Sevillano $7 no es del negocio, los aromatizantes si.
- **Hoy (produccion):** la BD ya lo soporta (094/097: `ticket_items.autorizacion = 'rechazado'` -> el renglon no cuenta en
  oficiales ni en el desglose y queda "por justificar"), pero la pantalla publicada no tiene el boton; se hizo por SQL.
- **Hacer:** en el detalle del ticket, por renglon: "No cuenta (no es del negocio)" -> `autorizacion = 'rechazado'`, y que el
  ticket se pueda confirmar con el resto. Revisar si el boton de la rama (articulos no autorizados) ya cubre este caso
  para cualquier renglon, no solo para articulos marcados `no_autorizado`.

### 3. Instrucciones al gerente: UN comprobante por foto (06-oct-2026)
- **Caso:** Guiot 05-sep y X24 Tecajetes 06-sep: el ticket estaba bien, pero debajo se veia OTRA nota con otro total; la IA
  los mando a Fraude ("total escrito distinto del impreso"). Xallapan 04-sep igual con la "hoja de respaldo".
- **Ya se hizo (IA):** regla en `_shared/gemini.ts`: leer solo el comprobante principal e ignorar otros papeles.
- **Hacer (app):** en la pantalla de subir, un aviso corto antes de la camara: "Una foto por ticket. Que no se vea otro
  papel debajo o al lado." Con un dibujo simple de bien / mal. Es la mejor defensa: la IA nunca es perfecta con papeles encimados.

### 4. Recompensas y bonificaciones de tiendas grandes (06-oct-2026)
- **Caso:** Sam's 04-sep: RECOMPENSA -$1,071.99 + DESCUENTO PAGO -$24.65 -> total $0 (se pago con recompensas). Fue a Fraude.
- **Ya se hizo (IA):** regla en el prompt (recompensa, bonificacion, monedero, puntos, cupon = renglon Descuento; total $0 por
  recompensas no es sospecha) + sinonimos en el articulo DESCUENTO de WP.
- **Decidido (Alejandro, 07-oct):** el ticket cuenta **$0** en el total, pero las **entradas a inventario si cuentan** (con su
  precio real). Asi funciona ya: cada producto conserva su monto y cantidad, y la recompensa va en un renglon Descuento aparte
  (gasto neto $0). Requisito: que cada renglon tenga cantidad (ver punto 14).

### 5. Renombrar "BOLSA X24 GRANDE 1 PZ" (06-oct-2026)
- El buscador de productos lo liga a CUALQUIER renglon que diga "bolsa" (es su unica palabra util): "bolsa N. 16" de papel
  quedo ligada ahi. Renombrar a algo con mas palabras ("Bolsa X24 grande de tienda") o revisar la regla del buscador.

### 6. Modo entrenamiento: no avisar "se creara" por cada articulo (05-oct-2026)
- Ver `PLAN_MODO_ENTRENAMIENTO.md`.

### 7. Articulos que se aprueban pero NO son frecuentes: siempre a revision (07-oct-2026, Alejandro)
- **Caso:** "Gas compras" $1,200 (30-sep) se aprobo porque el gerente lo comprobo, pero ese tipo de gasto debe pasar SIEMPRE por un
  humano (en julio un "Gas compras Aps" $1,350 fue fraude). Igual la tablet de Empeno Facil, pirotecnia, etc.
- **Ya existe en la BD:** `catalogo_productos.uso = 'ocasional'` (094) -> cuenta como gasto pero cada vez que aparece el ticket va a
  Por revisar (alerta `articulo_ocasional`). Falta en el remake: que al aprobar un articulo raro la pantalla ofrezca "Aprobar, pero
  revisarlo siempre" y que la IA lo trate como dudoso. Candidatos en WP: Gasolina para compras, Tablet para operar, Vela magica.

### 8. Impuestos en remisiones (PIAYS) (06-oct-2026)
- **Caso:** PIAYS 08 y 22-sep: subtotal + IVA + IEPS = total, pero los renglones venian sin impuesto -> "no cuadra". Se repartio a mano.
- **Hacer:** `impuestosPorRenglon` (procesar-ticket) no se aplico porque `tipo_documento = 'remision'`; aplicarlo tambien a remisiones
  que traen IVA/IEPS desglosado. (Ojo: `procesar-ticket` publicado trae el modo entrenamiento sin commitear.)

### 9. Descuento contado dos veces en facturas (06-oct-2026)
- **Caso:** Cervezas y Refrescos 03 y 08-sep: los precios de los renglones YA traian el descuento y la IA ademas puso un renglon
  "Descuento" -$44.29. Senal: subtotal impreso = suma de renglones + descuento.
- **Hacer:** regla en prompt o en codigo: si la suma de renglones (sin el descuento) + IVA = total, el renglon de descuento sobra.

### 11. Abreviaturas en notas a mano ("Hvo", "Hgdo") (06-oct-2026)
- Las faltas de ortografia ya se corrigen solas (hecho, abajo); las abreviaturas no. Idea: que Gemini devuelva tambien
  `producto_catalogo` (el articulo que cree que es) y usarlo solo si el buscador no encontro nada. Probar A/B como se hizo con el prompt.

### 12. Fecha "asumida" que si era correcta (06-oct-2026)
- **Caso:** Sam's 04-sep y Adan 14-sep salian "fecha asumida" aunque la fecha estaba bien. Hacer: en el detalle, boton "La fecha es
  correcta" que quite la marca (hoy se hizo por SQL: `gemini_raw._fecha_verificada`). Y si la fecha esta tachada (nota "1 Gal Tamar"),
  pedirla al gerente en lugar de usar la de subida.

### 13. Notas a mano de mercado: que se SIGAN revisando, pero con proveedor identificado (07-oct-2026, Alejandro)
- **Decidido:** NO bajar las alertas de las notas a mano; esta bien que la IA sospeche de la escritura a mano. Nada de
  "proveedor de confianza" que pase solo (misma regla que el 18-sep: sin proveedores de confianza).
- **Problema real:** las notas de verduleria llegan "sin comercio" (talonario generico), asi no se puede comparar por proveedor
  ni ver su historial. Y la misma verdura viene en "pz" o "kg" segun quien escribe (ruido en alertas de precio).
- **Wings Palace:** las notas de verduleria se aceptan COMO VIENEN (no se le pide al gerente ni al vendedor cambiar nada: ni nombre,
  ni sello, ni kilos).
- **DISENO ACORDADO (07-oct):**
  1. Si la nota no trae comercio, el gerente lo ELIGE al subir de la lista de proveedores de la cuenta; el admin puede crear
     proveedores (ej. "Verduleria"). Guardar aparte `comercio_leido` (del papel) y `comercio_declarado` (lo eligio el gerente);
     en revision y reportes se ve cual es cual. El declarado es dato para humanos y para agrupar: NUNCA prueba nada y no se manda a
     la IA como instruccion.
  2. Lo que decide si se revisa es el TIPO DE PAPEL, no el nombre: ticket impreso de caja / factura puede aprobarse solo si cuadra;
     **nota a mano o remision de talonario SIEMPRE a revision** (traiga o no comercio, aunque el gerente lo elija).
  3. Senales de fraude con proveedor declarado (contra el historial de ESE proveedor): productos que no son los suyos (elige
     "Verduleria" y trae jamon), precio por kg fuera de rango vs ese proveedor y los demas, frecuencia/montos raros (3 notas el mismo
     dia, montos redondos, mes al doble del promedio), mas lo de hoy (suma vs total, total corregido, foto repetida).
  4. Configuracion por cuenta: (a) "Notas a mano siempre a revision" ENCENDIDA por defecto; (b) "Aprobar solas notas a mano de un
     proveedor elegido si monto < $X, productos de siempre y precios en rango" APAGADA (prenderla con 2-3 meses de historial);
     (c) "Tope mensual por proveedor elegido" APAGADA. NO ofrecer "no revisar tickets con comercio" (en nota a mano se inventa).
  5. Unidades: cada articulo del catalogo define su unidad (jitomate/cebolla/zanahoria kg; lechuga/aguacate/pina pz); importa la
     consistencia, no que todo sea kg. La conversion por presentacion del 06-oct no cubre verdura suelta (pz <-> kg).

### 14. Renglones sin cantidad no entran a inventario (07-oct-2026)
- **Caso:** Sam's 04-sep: 5 de 6 productos con `cantidad` vacia (el ticket no imprime "1") -> no sumaban a Stock/Entradas. Corregido.
- **Quedan:** 22 renglones confirmados en WP ($~7k, may-sep) y 3 en SE con cantidad vacia. Revisar contra foto (no siempre es 1).
- **Hacer:** regla en el prompt: en tickets impresos, si el renglon no muestra cantidad, es 1. Y alerta si un renglon ligado a un
  articulo de inventario queda sin cantidad.

## Hecho
- 06-oct: la IA corrige faltas de ortografia ("zanaboria", "xanahoria", "huebo") -> `_shared/catalog.ts`.
- 06-oct: precios por presentacion ("HIELO 5 KG" leido como 1 pz / 1 kg / 5 kg) -> `_shared/precios.ts`; sin falsas alarmas x5 / x20.
- 06-oct: prompt con menos falsas alarmas de Fraude (otros papeles, ano mal leido, recompensas, correcciones en notas) -> `_shared/gemini.ts`.
