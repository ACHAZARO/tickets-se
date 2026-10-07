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
- **Pendiente (decision de negocio):** ¿un ticket pagado con recompensas cuenta $0 de gasto (hoy) o el valor de lo comprado?
  La recompensa es dinero que el negocio ya gano antes. Preguntar a Alejandro.

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

### 10. Aprobar en lote los tickets ya limpios (06-oct-2026)
- **Caso:** 48 tickets de septiembre sin alertas quedaron "Por revisar" (se limpiaron por fuera); no hay boton para aprobarlos juntos.
- **Hacer:** en Tickets, "Aprobar todos los que ya no tienen alertas (N)" con confirmacion; usa `confirmar-admin` uno por uno.

### 11. Abreviaturas en notas a mano ("Hvo", "Hgdo") (06-oct-2026)
- Las faltas de ortografia ya se corrigen solas (hecho, abajo); las abreviaturas no. Idea: que Gemini devuelva tambien
  `producto_catalogo` (el articulo que cree que es) y usarlo solo si el buscador no encontro nada. Probar A/B como se hizo con el prompt.

### 12. Fecha "asumida" que si era correcta (06-oct-2026)
- **Caso:** Sam's 04-sep y Adan 14-sep salian "fecha asumida" aunque la fecha estaba bien. Hacer: en el detalle, boton "La fecha es
  correcta" que quite la marca (hoy se hizo por SQL: `gemini_raw._fecha_verificada`). Y si la fecha esta tachada (nota "1 Gal Tamar"),
  pedirla al gerente en lugar de usar la de subida.

### 13. Precios de mercado (verduras) con mucho ruido (06-oct-2026)
- Cebolla, jitomate, lechuga en notas a mano vienen en "pz" o "kg" segun quien escribe y su precio varia; generan alertas de precio que
  siempre se aprueban. Hacer: tolerancia mayor (o sin alerta) para montos chicos de mercado, o comparar solo cuando la unidad es kg.

## Hecho
- 06-oct: la IA corrige faltas de ortografia ("zanaboria", "xanahoria", "huebo") -> `_shared/catalog.ts`.
- 06-oct: precios por presentacion ("HIELO 5 KG" leido como 1 pz / 1 kg / 5 kg) -> `_shared/precios.ts`; sin falsas alarmas x5 / x20.
- 06-oct: prompt con menos falsas alarmas de Fraude (otros papeles, ano mal leido, recompensas, correcciones en notas) -> `_shared/gemini.ts`.
