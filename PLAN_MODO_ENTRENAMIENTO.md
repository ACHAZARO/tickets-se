# Plan — Modo entrenamiento (clientes nuevos)

> Diseño acordado con Alejandro el 05-oct-2026. Estado: **fases 1-5 construidas en la rama `modo-entrenamiento` (05-oct)**; backend y migración 098 ya en producción (solo actúan con el modo prendido); frontend falta llevarlo a `main`. Ver «Avance» al final. Se construye fase por fase;
> cada fase se prueba en una cuenta de prueba (`sucursales.es_prueba`) antes de tocar a los clientes reales.

## Qué resuelve

Un cliente nuevo empieza con la IA sin conocer nada de su negocio: cada artículo sería "no reconocido" y todo
caería a revisión. El modo entrenamiento le pide subir tickets **ya verificados por él**, la IA los acepta todos
y con ellos aprende sus artículos, sus comercios y cómo clasifica sus gastos en categorías. Al apagarlo, la IA
trabaja normal: lo que no conozca va a revisión o a fraude.

## Reglas acordadas

1. **Por cuenta (negocio)**: el modo se prende y se apaga por cuenta, nunca para todos (regla de aislamiento).
2. **Es recomendación, no candado**: se le pide al admin usar SU PIN y tomar él las fotos; el sistema no bloquea
   a los gerentes, pero cada ticket queda registrado con quién lo subió.
3. **En entrenamiento la IA no manda nada a revisión ni a fraude**: acepta y crea artículos.
4. **Tres excepciones que se mantienen aun en entrenamiento**:
   - Foto idéntica (misma imagen) → se ignora con aviso "ya lo tenías" (hoy ya pasa).
   - Mismo gasto en dos papeles (factura + ticket de la misma compra) → no se cuenta dos veces, pero **sin**
     marcarlo como fraude.
   - Ticket que la IA no pudo leer → va a revisión (no hay nada que aceptar).
5. **Rastro**: todo ticket aceptado en entrenamiento queda marcado "aceptado en entrenamiento"
   (regla de evidencia: se sabe que nadie lo revisó).

## Hallazgo que cambia el diseño (código actual)

Hoy la IA **a propósito NO crea artículos sola** (`procesar-ticket/index.ts`: "No auto-aprender productos desde IA:
una lectura mala contamina el catálogo"). Todo artículo nuevo genera la alerta `producto_no_reconocido`.
El modo entrenamiento **invierte esa regla solo para esa cuenta y solo mientras está prendido**. Por eso es
importante el aviso de "sube solo tickets verificados": lo que se suba se vuelve catálogo.

---

## Fases

### Fase 1 — Interruptor y bienvenida
**Qué ve el cliente:** la primera vez que entra al admin: "¿Deseas iniciar la configuración?" (Sí, empezar / Más
tarde). En Configuración → Opciones, interruptor "Modo entrenamiento". Mientras está prendido: pestaña
**Entrenamiento** al final de Configuración y una franja arriba "Modo entrenamiento activo".

**Técnico:** migración nueva en `cuenta_opciones`: `entrenamiento` (bool), `entrenamiento_desde` (fecha),
`bienvenida_vista` (bool), `giro` (texto). Ampliar `lib/opciones.ts` y `admin/opciones/page.tsx`.
Nueva ruta `admin/entrenamiento/page.tsx` + entrada en el nav de `admin/layout.tsx`.

**Se prueba:** prender/apagar en la cuenta de prueba; la bienvenida sale una sola vez.

### Fase 2 — La IA en modo entrenamiento (el corazón)
**Qué cambia:** si la cuenta está en entrenamiento, al leer un ticket la IA:
- crea en el catálogo de esa cuenta los artículos que no conoce (nombre tal como viene en el ticket) con la
  categoría que eligió;
- no genera alertas de revisión (producto no reconocido, sin unidad, precio raro, envío alto, monto no cuadra,
  pagos no cuadran, artículo ocasional/no autorizado) ni marca fraude;
- confirma el ticket y lo marca "aceptado en entrenamiento";
- respeta las 3 excepciones de arriba.

**Técnico:** `procesar-ticket` lee `cuenta_opciones.entrenamiento`; columna `registros_tickets.entrenamiento`
(bool) para el rastro. La creación de artículos reutiliza el mismo camino que usa "enseñar" en Tickets
(un solo lugar, no una copia). `reprocesar-ticket` y `revisor-ia` deben respetar la misma bandera.
Desplegar edge functions con Supabase MCP.

**Riesgo principal:** que una lectura mala cree un artículo con nombre feo o en la categoría equivocada.
Mitigación: queda visible en Cerebro y en Artículos para renombrar/mover (paso 6 del entrenamiento), y la
detección de duplicados del catálogo (`sugerir_unificaciones`) ya avisa nombres parecidos.

**Se prueba:** subir 5–10 tickets reales de prueba a la cuenta de prueba con el modo prendido → todos
confirmados, artículos creados, cero alertas, marcados; apagar el modo → un ticket con artículo nuevo vuelve a
caer a revisión como hoy.

### Fase 3 — Plantillas de categorías por giro
**Qué ve el cliente:** al iniciar: "¿Cuál es tu giro?" → Restaurante / Cafetería, Tienda, Oficina / Servicios,
Otro. Sale una lista de categorías ya palomeadas (las del giro, o las contables genéricas si eligió "Otro"),
puede desmarcar, crear las suyas ahí mismo, y la nota "puedes agregar más categorías después".
Cada categoría con su marca Operativo / No operativo ya puesta.

**Técnico:** las plantillas viven en una tabla (`plantillas_categorias`: giro, nombre, operativo, orden), no en el
código. Al aceptar se **copian** como categorías propias de la sucursal del cliente (nunca globales).
Contenido de las plantillas: lo propone Claude, lo aprueba Alejandro antes de cargarlo.

**Se prueba:** elegir giro en la cuenta de prueba → aparecen solo en esa cuenta.

### Fase 4 — Pestaña Entrenamiento (lista de pasos)
Los pasos se palomean solos cuando se cumplen (consultando la base):

| # | Paso | Se palomea cuando… |
|---|---|---|
| 1 | Tu sucursal y **tú con tu PIN de administrador** (+ QR) | hay sucursal con al menos un empleado |
| 2 | Giro y categorías (Fase 3) | hay categorías propias |
| 3 | Formas de pago | hay al menos una forma activa |
| 4 | Artículos: A) primero tu lista de insumos, o B) la IA arma el catálogo con los nombres del ticket y tú renombras después | eligió un camino |
| 5 | Sube los tickets de un mes (o del periodo que quieras que la IA reconozca), tomados por ti y ya verificados | botón "Ya subí mis tickets" (sin conteo) |
| 6 | Revisa el Cerebro y reorganiza | abrió el Cerebro |
| 7 | "Terminaste. ¿Desactivamos el modo entrenamiento?" | todo lo anterior |

Cada paso con su texto corto y un botón que lleva a la pantalla donde se hace.
Orden: sucursal va primero porque las categorías se guardan por sucursal.

**Textos clave** (se pulen con `stop-slop` al construir):
- Categorías: "Crea las categorías en que quieres ver tu gasto. Nuestra IA clasificará cada artículo y solo te
  preguntará cuando tenga duda. Después, en Cerebro, puedes revisar cómo conectó todo y reorganizarlo."
- Aviso de subida: "Usa tu PIN de administrador y toma tú las fotos. Sube solo tickets que ya revisaste: sin
  fraude y solo con artículos de la operación normal de tu negocio. En este modo la IA acepta todo: está
  aprendiendo cómo es tu negocio. Cuando lo apagues, lo que no conozca irá a revisión o a fraude."

### Fase 5 — Cierre
- Mostrar en Tickets la marca "entrenamiento" en los tickets aceptados así.
- Recorrido completo en celular (390 px) y escritorio con una cuenta de prueba nueva, de la bienvenida al apagado.
- Actualizar `PROJECT_STATE.md`, `CLAUDE.md` (migraciones) y memoria.

## Pendientes / dudas abiertas
- Hoy existen categorías globales (`sucursal_id NULL`) que un cliente nuevo vería. Para vender, la regla es
  "cero globales" (ver `MULTI_NEGOCIO.md`); la Fase 3 asume que el cliente nuevo arranca solo con las suyas.
- Cómo se crea hoy una cuenta nueva (lo hace Alejandro a mano). El modo entrenamiento empieza cuando ese
  cliente entra por primera vez.
- (05-oct, Alejandro) **Aviso de artículos nuevos al guardar un ticket:** fuera de entrenamiento, "Guardar y
  confirmar ticket" pregunta antes "Se crearán N artículos nuevos en el catálogo: ... ¿Seguir?" (función
  `guardarTicket` en `frontend/app/admin/tickets/page.tsx`). **En modo entrenamiento NO debe salir**: ahí todo
  es nuevo y la pregunta estorbaría en cada ticket. Igual el texto "no está en el catálogo: al guardar se creará"
  de cada renglón (`notaNuevo` de `ElegirArticulo`) se calla o se suaviza en entrenamiento.
- (05-oct, Alejandro) **Forma de pago en entrenamiento:** hoy es obligatoria al subir. En entrenamiento podría
  ser OPCIONAL, con una elección del cliente: (a) el gerente la registra en cada ticket al subirlo, o (b) la IA
  aprende la forma de pago de cada ticket (leyéndola de la foto). Falta decidir y diseñar la opción (b).

## Orden sugerido
Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5. La Fase 2 es la de más riesgo y se prueba sola antes de seguir.

## Avance (05-oct-2026, Claude)
- **Migración 098** aplicada: `cuenta_opciones` (+`entrenamiento`, `entrenamiento_desde`, `bienvenida_vista`, `giro`,
  `entrenamiento_pasos`), `registros_tickets.entrenamiento`, `plantillas_categorias` (4 giros; Descuentos y Otros gastos
  operativos obligatorias porque el prompt de la IA las usa). Cuentas existentes con la bienvenida ya vista.
- **`procesar-ticket`** publicado: en entrenamiento crea los artículos que no conoce (`articuloEntrenamiento`, a prueba de
  dos fotos procesándose a la vez), no genera alertas de artículo nuevo / sin unidad / precio / envío / uso de artículos,
  no manda a Fraude (lo que vio la IA queda en `gemini_raw._sospecha_en_entrenamiento`), el mismo gasto en dos papeles
  se rechaza como copia SIN fraude (`_rechazo_auto: copia_en_entrenamiento`). SIGUEN yendo a revisión: ilegible, sin fecha,
  monto que no cuadra, pagos que no cuadran, IA sin leer y **texto escrito para darle órdenes a la IA (a Fraude)**.
  Renglón sin categoría: el ticket se acepta y el renglón queda "sin clasificar" para Cerebro.
- **Frontend** (rama): bienvenida "¿Deseas iniciar la configuración?", interruptor en Opciones (con confirmación),
  franja ámbar en todo el admin, pestaña Configuración → Entrenamiento con 7 pasos, plantillas por giro, marca
  "Entrenamiento" en la lista de Tickets.
- **Probado contra producción con la cuenta de prueba `PRUEBA ENTRENAMIENTO`** (sucursal `prueba-entrenamiento`,
  es_prueba; PIN en `_secretos/pin-prueba-entrenamiento.txt`): 5 tickets reales de SE aceptados y marcados, 16 artículos
  creados, el 2º ticket de Típico reusó 3; foto idéntica ignorada; copia del mismo gasto rechazada sin fraude; 2 subidas
  simultáneas sin artículos repetidos; **con el modo apagado** un ticket nuevo reconoció 6 de 7 artículos y solo mandó a
  revisión el nuevo (Plátano).
- **Límites conocidos:** (1) si la IA lee distinto el folio de dos fotos del mismo gasto, no los junta (pasó con Walmart
  09112; también pasa fuera de entrenamiento). (2) `reprocesar-ticket` (releer a mano) usa las reglas normales aun en
  entrenamiento. (3) El modo es por negocio: también acepta lo que suban los gerentes (por eso la confirmación y el aviso).
  (4) Crear la cuenta y sucursal de un cliente nuevo sigue siendo manual (las sucursales nuevas caen por defecto en la
  cuenta principal).
