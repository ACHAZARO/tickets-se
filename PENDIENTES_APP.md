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

## Hecho
(nada aun)
