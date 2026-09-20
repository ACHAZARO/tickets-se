# PROJECT_STATE.md — Revision de Tickets

> Estado vivo del proyecto. Ultima actualizacion: 2026-09-19.
> **Cambio de computadora / recuperacion:** ver `RECUPERACION.md` (donde nos quedamos + pasos) y `DIRECTORIO_CUENTAS.md` (cuentas, correos e integraciones). Foto del 2026-09-19.

## EN EL RADAR (Alejandro, 2026-09-20): la app se va a vender a otros locales -> lo aprendido NO debe salir de cada negocio
Diagnostico (solo lectura, sin cambios todavia):
- **Bien aislado, por sucursal:** catalogo y sinonimos (596 productos), comercios (106), historial de precios, duplicados,
  referencia de envios por proveedor, categoria Bodega; la API ya es por cuenta (060).
- **Fugas a corregir ANTES del primer cliente externo (hoy inofensivas: solo existen nuestros negocios):**
  1. Prompt compartido `_shared/gemini.ts`: nombres "Wings Palace"/"Santa Elena" como compradores (linea del comercio), regla
     de motos con "Ale, Polo, mama Polo, Toto", y regla BODEGA con nuestros productos/proveedores (protegida solo por "si
     existe la categoria Bodega": un cliente que cree su propia "Bodega" la heredaria).
  2. `_shared/duplicados.ts`: RELLENO trae 'wings','palace','santa','elena'.
  3. 21 productos GLOBALES (`sucursal_id` NULL) aprendidos de nuestros tickets (DESCUENTO, Limones, BOLSA TIPICO, Cebollin,
     Matizza, "Joutube"...): un negocio nuevo los heredaria con todo y sinonimos.
- **Arreglo propuesto (pendiente del OK de Alejandro):** tabla de "reglas del negocio" por sucursal/cuenta que se inyecta al
  prompt (el codigo compartido se queda solo con reglas universales: tickets mexicanos, IVA, envio a mano, sospecha); nombres
  del comprador tomados de las sucursales de la cuenta; pasar los 21 productos globales a nuestras sucursales (dejar global
  solo lo generico, p. ej. DESCUENTO). **Regla desde hoy: ninguna regla nueva de negocio como texto fijo en codigo compartido.**

## Sesion 2026-09-19 (Claude) -- "Subidos vs oficiales" en Tickets + API de solo lectura para el programa de cuentas
**Idea (Alejandro):** si un gerente mete tickets de mas (duplicados, facturas dobles, alterados) para que su gasto real cuadre, hay que
poder decirle "subiste $X, solo valen $Y, debes justificar $X-Y". Y el programa de revision de cuentas debe poder consultarlo.
- **Definiciones (una sola fuente: RPC `resumen_tickets`, migraciones 056-058):** `subidos` = TODO el periodo, cualquier estado, duplicado
  sin monto propio cuenta $0 (cambiado en 066; ver abajo); `oficiales` = confirmados (monto ya corregido en la revision); `en_revision` =
  pendientes; `no_validos` = rechazados (`por_motivo`: fraude = sospechoso no descartado, duplicado = misma foto, otro);
  `por_justificar` = subidos - oficiales. Periodo por fecha del ticket (como la pantalla). Sucursal PRUEBA (`sucursales.es_prueba`) no entra.
- **Pantalla Tickets:** tarjeta arriba (Subidos / Oficiales / Por justificar) que al hacer clic muestra el desglose y botones "Ver todos
  los subidos" / "Ver solo los oficiales". La lista "Todos" ya incluia rechazados. **"Eliminar ticket" solo existe para la sucursal de
  prueba** (candado de pantalla; por SQL un admin aun puede borrar); en sucursales reales se RECHAZA (si se borra, desaparece de "Subidos" y se pierde la evidencia).
- **API `api-cuentas` (edge function v2, verify_jwt=false, auth propia):** `GET /resumen?desde&hasta[&sucursal]` y `GET /sucursales`.
  Solo lectura, sin CORS. Llave `tk_...` en `_secretos/llave-api-programa-cuentas.txt` (fuera de git); en BD solo el hash (`api_keys`).
  Guia completa para el programa: `API_CUENTAS.md`. Probada: 401 sin/mala llave, 405 POST, 400 fechas malas, 404 ruta/sucursal, 200 con datos
  iguales a la RPC (jun-sep: subidos $730,141.88 / oficiales $699,105.94 / por justificar $31,035.94; WP julio oficial $155,808.62 = tabla 18-sep).
- **Migraciones:** 056 (`es_prueba`, `api_keys`, `resumen_tickets`; en el historial de Supabase se llama `055_resumen_tickets_y_api` porque
  la 055 de Adan Melchor se aplico el mismo dia), 057 (motivo fraude antes que duplicado) y 058 (ajustes de la revision independiente:
  el monto del original solo se presta a duplicados NO confirmados; "todas" = solo sucursales activas). API en v2 (fecha imposible = 400).
- **Datos (hallazgo):** PRUEBA tiene 1 ticket confirmado con total $2,150.54 y renglones $1,945.54 (no afecta: PRUEBA esta excluida).
  `tickets_sin_monto_leido`: 35 en WP (44 rechazados sin monto: 11 copias de foto ya cuentan con el monto de su original; el resto ilegibles).
- **API por cuenta (migracion 060, API v3):** cada llave pertenece a UNA cuenta (`api_keys.cuenta_id` NOT NULL, tablas `cuentas` y
  `sucursales.cuenta_id`; hoy una sola cuenta "Alejandro (cuenta principal)" con SE, WP y PRUEBA). La API filtra sucursales y totales por la
  cuenta de la llave (RPC `resumen_tickets` gano `p_cuenta`). Probado con una cuenta ajena temporal (ya borrada): veia solo lo suyo, y la
  llave principal no veia lo de ella. `sucursales.cuenta_id` tiene DEFAULT temporal a la cuenta principal porque el admin crea sucursales
  sin indicar cuenta: **al abrir el registro publico hay que cambiarlo por la cuenta de quien crea** (y RLS por cuenta; hoy RLS es
  admin-only y `sucursales_activas_publicas` deja leer todas las activas, cuenta_id incluido). Texto para otra IA: `API_CUENTAS.md` al final.
- **Decision de Alejandro (19-sep):** NO hace falta guardar el "monto del papel" aparte (propuesta 4 de `AUDITORIA_EVIDENCIA.md`). Un ticket
  alterado (papel $420, real $210) se registra con el monto REAL ($210) y se manda a Fraude/"revisar con gerente"; cuando el gerente
  responde, subidos y oficiales suman lo mismo (lo autorizado). "Por justificar" mide sobre todo tickets RECHAZADOS (notas dobles, viejas,
  gastos ajenos a la operacion). Ejemplo: sube 10x$100 = subidos 1000, se rechazan 5 = oficiales 500.
- **Pantalla VERIFICADA en produccion (20-sep, Chrome de Alejandro):** WP julio = Subidos $175,710.21 (252) / Oficiales $155,808.62 (230) /
  Por justificar $19,901.59, igual que la API; el desglose (fraude $15,961.72 en 12, misma foto $3,939.87 en 10) tambien cuadra. Se vio un
  desfase intermitente: la lista mostraba SANTA ELENA con el selector en WINGS PALACE (dos cargas seguidas al abrir, la vieja terminaba
  despues). Arreglado con guarda de ultima carga en `fetchTickets` (`fetchSeq`).
- **Periodo rapido en Tickets y Entradas (20-sep):** componente compartido `frontend/app/admin/periodo.tsx` (`SelectorPeriodo`): "Por mes"
  (select de 12 meses + flechas para saltar de mes, mes actual completo por defecto) o "Rango" (dos fechas), como Gasto. Pantallas
  Tickets (`tickets/page.tsx`) y Entradas (`inventario/page.tsx`). Gasto (dashboard) conserva su propio selector (no se toco).
  Probado el componente aislado (flechas, select, salto >12 meses, rango, volver a mes); integracion a verificar en produccion.
- **API `/desglose` (20-sep, API v4, migracion 068 `desglose_categoria`):** `GET /desglose?categoria=Bodega&desde&hasta[&sucursal][&detalle=1]`
  = una categoria por producto (solo confirmados; producto del catalogo o lo escrito; cantidades por unidad; % de la categoria; `detalle=1`
  agrega cada renglon, maximo 1000). El total coincide con `oficiales_por_categoria` del resumen (Bodega SE jun-sep $29,262.59: playo Reyma
  $11,004.35, bolsas 1 kg $8,926.15, Moto envio $2,078.51, flete $1,407.53...; incluye los envios que la 067 movio a Bodega). Categoria
  desconocida o de otra cuenta = 404 con `disponibles`. Aislamiento por cuenta re-probado con una cuenta ajena temporal (ya borrada).
  Probado con TODAS las categorias (jun-sep): Insumos $530,490.73 / Otros op. $57,977.96 / Desechables $30,970.08 / Gas $41,705.25 /
  Limpieza $18,654.48 / Bodega $29,262.59 / Extras $1,687.10 / Descuentos -$11,246.25, cada total = su renglon del resumen; responde en
  0.6-1.2 s (Insumos: 309 productos, 84 KB). 069: unidades sin distinguir mayusculas ("kg" y "KG" se sumaban aparte). Limites que vienen
  del catalogo, no de la API: productos duplicados ("Mantequilla" y "Mantequilla Gloria 1 kg") salen separados; solo 0.3% de Insumos
  no esta ligado al catalogo.
  Texto para otra IA actualizado en `API_CUENTAS.md`.
- **Unificar productos del catalogo (20-sep, regla de Alejandro; migraciones 070-072 + `admin/unificar.tsx`):** cuando el catalogo tiene el mismo
  insumo con dos nombres ("Mantequilla" / "Mantequilla Gloria 1 kg") el sistema lo DETECTA, lo avisa con un circulito ambar junto a "Cerebro" y
  lo PREGUNTA en un panel arriba de Cerebro ("Posibles duplicados"): Unificar en A / Unificar en B / No son iguales (se recuerda, no se vuelve a
  preguntar). NUNCA une solo. Tambien hay "unificar" por producto en Catalogo (elige el que se queda entre los de su categoria).
  Motor `_unificar_productos`: misma categoria y misma sucursal (o el destino global); mueve renglones, precio_historial y consumo_inventario al que
  se queda, que aprende el nombre del absorbido como sinonimo (la IA sigue ligando ambos); cada renglon conserva lo capturado; respaldo en
  `respaldo.unificaciones_productos` (fila del absorbido + ids movidos). Detector: `sinonimo` (uno ya era sinonimo del otro) / `igual` (mismo
  nombre sin tamanos ni plurales) = "muy probables" (cuentan en el circulito); `parecido` (el nombre corto es UNA palabra dentro del otro) = "menos
  seguros" (colapsados). Si los dos nombres traen medidas distintas NO se sugiere (Tapa 14 oz / 16 oz, Bolsa #10 / #14 son presentaciones
  distintas); los codigos de proveedor de 5+ digitos no cuentan como medidas. Hoy: 22 muy probables + 48 menos seguros (todo el catalogo).
  075: el detector tardaba 2-8 s y en produccion fallaba por limite de tiempo (500): faltaban indices `producto_catalogo_id` en ticket_items /
  precio_historial / consumo_inventario y comparaba todos los pares; ahora 65 ms (158 ms todas las sucursales). Circulito y panel llevan
  guarda de "ultima carga" (mismo desfase que Tickets: la carga de "todas" terminaba despues de la de la sucursal).
  **Ya unificado (a peticion): Santa Elena "Mantequilla" -> "Mantequilla Gloria 1 kg"** (11 renglones, $12,762.72; se le declaro 1 pz = 1 kg).
- **Pendiente:** fecha de rotacion de la llave; rutas de precios/stock de la API si las pide.
- **Auditoria de evidencia (19-sep, sesion paralela): ver `AUDITORIA_EVIDENCIA.md`.** Hoy 0 fotos perdidas. Decisiones de
  Alejandro: candado de "Eliminar" en pantalla (solo admin) OK; cron `limpiar-imagenes-tickets` (fotos de +1 ano) OK, antes se
  descarga respaldo (ojo: hoy falla cada mes porque Supabase bloquea borrar fotos por SQL; rehacerlo con la API de Storage antes
  de jun-2027 si se quiere que funcione); `monto_papel` descartado; permisos por usuario para cuando se venda la app.
  **Hecho:** pasar la foto a `archivo` ya es seguro (`_shared/archivo.ts`: copia verificada por tamano; el original se quita solo
  cuando el ticket ya apunta a la copia; `autoConfirmar` con candado `estado='pendiente'` para no chocar con el admin ni confirmar
  un ticket que el admin rechazo mientras la IA leia; la copia de foto identica ya no deja registro sin foto). Deploy:
  **procesar-ticket v45, reprocesar-ticket v17, confirmar-admin v11** (byte a byte = repo; 2 revisiones adversariales sin defectos).
  Foto de control al desplegar: 0 confirmados sin archivo, 0 originales sobrantes, 0 rutas a la nada. **Verificar con los primeros
  tickets nuevos** que queden en `archivo` y sin original en `por-revisar`. Siguen abiertos de la auditoria: releer IA/editar/rechazar
  pisan sin historial; un rechazado puede volverse oficial al guardar un renglon.
- **`confirmar-ticket` RETIRADA (v15, responde 410)** el 19-sep con OK de Alejandro: permitia que un gerente con sesion de PIN
  confirmara su propio ticket (incluso marcado o en fraude) y borraba el original antes de guardar. Comprobado que nadie la usa:
  la app dejo de llamarla el 2026-06-09 (531745f) y en los logs los gerentes solo llaman verificar-pin y procesar-ticket.
  Codigo viejo en `backend/supabase/functions/_archive/confirmar-ticket-2026-09-19.ts`.
- **Verificado en produccion (19-sep 21:36 UTC, 6 tickets del cafe con gemini-3.8-flash):** los 2 que se auto-confirmaron
  quedaron con su foto en `archivo` y sin original en `por-revisar` (el archivado nuevo funciona). Los otros 4 quedaron para
  revisar: Tipico $539.67 (precio anomalo), Adan Melchor factura 403201 $1,552 (monto anomalo: IVA $203 sin repartir),
  una nota a mano de $1,552 sin vendedor por la MISMA compra (la IA la marco sospechosa sola -> Fraude; el detector de
  duplicados no la liga porque la nota no trae comercio) y una nota de Jugotropick que la IA leyo con fecha 19-abr.
- **Las dos hojas de $1,552 (migracion 061, Alejandro 19-sep):** la gerente subio la factura Y una hoja aparte con su
  desglose (entendio mal; ya se le aclaro que el desglose va en el mismo ticket). No es fraude. La factura queda con el IVA
  de $203 repartido (bolsas $895.75 = $203.58/kg como siempre, playo $576.01 = su precio de siempre, envio $80.24; suma
  $1,552) y **lista para confirmar con un clic desde el panel** (se deja pendiente a proposito: asi confirmar-admin archiva
  la foto por el camino nuevo, en vez de confirmarla por SQL). La hoja a mano queda rechazada como copia de esa factura, con
  la sospecha cerrada como descartada. **Ojo:** la hoja junta el playo con las bolsas en "Bodega"; por ahora el playo sigue
  como Desechables (cafe) -> preguntado a Alejandro. Los otros 2 pendientes (Jugotropick fecha 19-abr y Tipico precio
  anomalo) los revisa Alejandro a mano esta semana para ver como funciona la app.
- **Cinta de empaque = Bodega (059):** por PRODUCTO, no por comercio (El Fenix/El Iris venden cosas de la cafeteria). 5 compras
  jun-sep ($2,087.60, incl. despachador de Office Depot) movidas; regla en gemini.ts.
- **Playo de Adan Melchor = Bodega (062, Alejandro 19-sep):** el rollo grande "Playo stretch Reyma 18 cal 80 1300 ft" (solo se
  le compra a Adan Melchor, solo SE): 40 rollos, $11,580.36 jun-sep. NO se movieron el "Polpusa 1000 ft" (El Bodegon) ni el
  "clingfilm" (pelicula para alimentos). Regla en gemini.ts. **Bodega por mes (confirmado, SE):** jun $6,223.76 (playo
  $1,153.74) / jul $4,791.44 ($2,236.50) / ago $8,148.15 ($4,734.06) / sep $5,728.20 ($2,880.05). Eso sale del % de operacion
  del cafe (`cuenta_operativo=false`). **Ojo:** la categoria de la IA gana sobre la del catalogo, por eso la regla del prompt
  es la que sostiene esto; si aparece un playo/cinta/bolsa en Desechables, revisar el prompt antes que el catalogo.
- **Un ticket sin monto cuenta $0 (066, Alejandro 19-sep):** antes "subidos" le prestaba al duplicado sin monto el monto de
  su original. Razon del cambio: la app sirve para ver si el gerente infla el gasto y saca dinero de la caja; **con un papel
  sin monto no sale dinero**, asi que no debe aumentar lo que tiene que justificar. Cada ticket suma solo lo que dice su
  propio papel. Efecto (jun-sep): subidos $734,181.55 -> **$730,136.68**, por justificar $34,679.61 -> **$30,634.74**
  (las 11 copias de foto dejaron de aportar $4,044.87). `tickets_sin_monto_leido` ya no cuenta duplicados: sigue en 35 (WP,
  ilegibles). Texto de la tarjeta de Tickets reescrito con las palabras de Alejandro; `API_CUENTAS.md` actualizado.
- **"Si el ticket dice Bodega, es de Bodega" (regla de Alejandro, 19-sep):** el playo Polpusa 1000 ft tambien paso a Bodega
  (064: 2 compras de junio, $786) y el papel de Office Depot del 7-sep, que trae "Bodega hojas" a mano, tambien (065: $99
  netos; se movio solo ese renglon, no el producto; el renglon de la promocion -$10 se fue con el). La regla quedo en el
  prompt de la IA con candados que puso la revision: solo cuenta "Bodega" ESCRITA A MANO (no "EL BODEGON DE SEMILLAS",
  "BODEGA AURRERA" ni campos impresos tipo "bodega de salida"), manda solo sobre los renglones que senala, nunca se lleva
  "Descuento" ni "Moto envio", el clingfilm de 30 cm sigue siendo cafeteria aunque su nombre diga "playo", y en Wings (sin
  categoria Bodega) la anotacion se ignora. **Bodega por mes (SE, confirmado):** jun $7,009.76 / jul $4,791.44 /
  ago $8,148.15 / sep $5,827.20 (mas $1,471.76 del ticket del 19-sep cuando se confirme).
  Deploy con esa regla: **procesar-ticket v47, reprocesar-ticket v19** (byte a byte = repo, OPTIONS 200 y POST sin token 401).
  Texto nuevo de la tarjeta verificado en vivo en tickets-se.vercel.app.
- **Envios de Bodega (067, Alejandro 19-sep):** el flete de una entrega que solo traia material de Bodega tambien es Bodega.
  Movidos los 26 renglones "Moto envio" de esas entregas ($2,158.75 jun-sep: Adan Melchor, El Bodegon, El Iris) y el flete de
  Transportes Castores del 13-jul ($1,407.53). Regla en el prompt: el envio va a Bodega SOLO si todo lo demas del ticket es
  material de Bodega; si el ticket mezcla, se queda en Otros gastos operativos (y el Descuento sigue a su compra).
  **Bodega por mes (SE) queda:** jun $7,249.76 / jul $6,658.53 / ago $9,047.61 / sep $6,306.69 confirmado (+$1,552 pendiente).
- **Contexto que dio Alejandro:** la cafeteria esta junto al roaster y **el gasto del tostador se gestiona aparte** (por eso
  no aparecen etiquetas, valvulas ni cajas). "Bodega" en esta app es solo lo de bodega que llega a la cafeteria: por eso son
  montos chicos. No hay que ir a buscar el resto del gasto del tostador aqui.
- **Limpieza de catalogo (063):** habia DOS productos activos para el mismo rollo grande de playo con el mismo sinonimo
  ("Playo stretch 18 cal 80 1300 pies", 0 compras, fundido en el de Reyma) y al playo Polpusa se le habia colado el sinonimo
  "10000007 MINERAL 24/.355L RT" (agua mineral): quitado. Vale la pena un barrido de sinonimos colados como ese.
- **Correccion de totales:** la tabla de arriba tenia jun/jul de SE sin los $60 que quito la migracion 053 a cada mes.

## Sesion 2026-09-18 (noche, Claude) -- TODO revisado contra foto: Santa Elena jun-sep + Wings mayo-julio
**Resultado:** 884 tickets revisados uno por uno contra su foto (workflow de revisores) y cargados sin copiar SQL.
**Todos los confirmados cuadran al centavo (renglones = total con IVA). Cero pendientes y cero alertas abiertas (19-sep).**
65809be7 (Adan Melchor 17-sep) resuelto en 055: el $1,920 a mano juntaba Adan $1,490.09 + El Fenix cinta $339.60 (ticket
87ede10d aparte, trae "Bodega" a mano) + moto $90. Queda en $1,580.09 confirmado; SE sep = $47,244.19 (90 tickets).
| Sucursal | May | Jun | Jul | Ago | Sep (al 18) |
|---|---|---|---|---|---|
| Wings Palace | $62,836.30 (99) | $155,927.41 (239) | $155,808.62 (230) | $109,777.11 (192) | sin subir |
| Santa Elena | - | $73,193.48 (131) | $81,318.50 (148) | $75,836.63 (136) | $47,640.19 (92 al 19-sep) |
- Santa Elena: 508 tickets (se_ago 158 + se_resto 350) + 1 del 18-sep; 4 fotos repetidas rechazadas. Envios a mano
  registrados como "Moto envio": jun $1,417 / jul $1,637 / ago $1,964 / sep $905 (050, 051: segunda pasada solo de envios).
  Catalogo SE: 159 productos nuevos, 19 basura fundidos (047), AVE ACTION FRY -> Insumos, CUPON -> Descuentos, playo separado en
  Polpusa 1000 ft (El Bodegon ~$131) y Reyma 1300 ft (Adan Melchor ~$288-320) (052), "Moto (envio)" fundido en "Moto envio".
- Wings: 376 tickets de mayo-julio (incluye los 181 de la carga 13/14-jul nunca leidos): 360 confirmados, 16 rechazados
  (remisiones de facturas, gas duplicado, 3 tickets de gas Sonigas de talonarios 2024/2025 reutilizados -grupo Fraude ...0501-,
  "Caja de Te" de Fer Villanueva, "pendiente pago"). IEPS de Camfoods asignado a dedos de queso (ambiguo por matematica), PIAYS
  proporcional (049). Adan Melchor SE: 19 comprobantes = 19 compras distintas (series S y V del proveedor; 4 sin timbre).
- Historial de precios reconstruido: SE 1,397 precios / 192 productos (jun-sep), WP 1,644 / 356 (may-ago).
- Tablas temporales vaciadas (_tmp_firmas, _tmp_carga). Deploy final: procesar-ticket v42, reprocesar-ticket v14 (verificados byte a byte contra el repo).
**Decisiones de Alejandro (18-sep):** envio anotado a mano ("c/envio") SI se pago -> renglon "Moto envio" en Otros gastos
operativos (~110 tickets SE); moto Lindsay/Fer = empleado que trae insumos -> operativo; factura+ticket = solo cuenta la
factura y la copia queda RECHAZADA y EN FRAUDE (corregido por Alejandro en la noche); mayo-julio los decide Claude.
Ver memoria envios_y_motos.
**Carga sin copiar SQL (NUEVO):** `_tmp_carga` + `aplicar_revision(lote, sucursal)` (migracion 046). El JSON se sube desde una
pestana propia del admin con un input file + herramienta file_upload de Chrome. Un agente sonnet que copiaba SQL lo abrevio con
"(...)" y fallo: NO volver a pedir copias de SQL grande a un agente.
**Codigo:** montos.ts `repartirSinImporte` (notas de pan con solo el TOTAL: antes ese dinero no caia en ninguna categoria);
gemini.ts: "Santa Elena"/"Wings Palace" nunca son el comercio + regla de envio anotado a mano; procesar-ticket: la copia de
una foto repetida toma fecha/comercio del original y su alerta nace resuelta; page.tsx: rechazados/archivados fuera de
"Requieren revision"; duplicados.ts: folio "0000000001" (Quesos La Noria reinicia folio) ya no cuenta como folio, y mismo
comercio+dia+monto con folios distintos no es duplicado. Migraciones 043-049.
**Hallazgos (Fraude / patrones):** en SE la gerente anota "c/envio" (+$40-160) -> ya se cuenta; totales a mano enormes = suma de
tickets engrapados. Jugotropick 1-jul con cantidad/total alterados (se cuenta $210). WP mayo-jun: 2 tickets de gas Sonigas sin
fecha de talonarios 2024/2025 (reutilizados, no se cuentan), nota "Caja de Te" $1,560 de Fer Villanueva alterada (no se cuenta),
aceite Ave a $745 vs $490 en nota sin proveedor. Playo stretch en SE: 11 rollos en junio, 7 en julio, 16 en agosto, 10 al
17-sep (vigilar consumo e inventario). Jugo de limon WP: $280/galon en mayo -> $170 en agosto.
**Respuestas de Alejandro (18-sep noche) -> migracion 053 + codigo:** Adan Melchor 17-sep = bolsas metalizadas (gasto de
Bodega), la diferencia $429.91 es envio (operativo). ~~Adan Melchor = proveedor de confianza~~ (revertido en 054). Papel repetido = RECHAZADO + revision de Fraude en grupo con el original (25 pares
reabiertos; desde hoy procesar-ticket lo hace solo y "Descartar" en Fraude regresa el ticket a Por confirmar). La IA llena
`sospecha` si ve alteraciones/comprobantes reutilizados -> Fraude. Motos: producto unico "Moto envio", categoria por renglon
(Ale/Polo/mama Polo/Toto = Extras, el resto operativo); "MOTO" del cafe fundido. Corregidos 3 envios contados dos veces ($180).
**Correccion de Alejandro (18-sep, mas noche) -> migracion 054 + codigo:** NO hay proveedores de confianza: se quita
`comercios.confiable` (columna y codigo en duplicados.ts); Adan Melchor pasa por las reglas normales. La gerente confirma que
su envio suele ser $60-80: 65809be7 regresa a por revisar (alerta revisar_gerente reabierta, precio del ticket fuera del
historial hasta que se confirme). Nueva categoria **Bodega** (solo SE, `cuenta_operativo=false`: no entra al % de operacion):
bolsas metalizadas para cafe (3 productos, 10 renglones, $11,799.60 jun-sep). Nueva alerta **`envio_alto`** ("Envio muy
alto", `precios.ts envioMuyAlto`): envio > max(1.5x, +$40) de la mediana de los ultimos 10 envios confirmados de ESE
proveedor (con 3+); sin historial, > $150. `hayPrecioAnomalo` ya no compara envios. Gemini: si lo escrito dice envio/moto
se agrega aunque sea caro; solo un total a mano sin la palabra envio y >$200 se toma como tickets engrapados; bolsas
metalizadas -> Bodega. Con la regla, Adan Melchor 24-jul ($140) y 6-ago ($149) tambien habrian salido a revisar.
Deploy: **procesar-ticket v44, reprocesar-ticket v16** (byte a byte = repo; OPTIONS 200 y POST sin token 401). Revision
independiente del diff: sin bugs; se agrego el plural "envios". Nota: esEnvio tambien cubre Moto insumos / Moto servicio (WP)
/ Envio al dueno (a proposito: toda moto cara sale a revisar).
Alejandro: 24-jul ($140) y 6-ago ($149) se quedan confirmados; de aqui en adelante esos envios SI salen a revisar
(umbral validado: $149 con Adan Melchor = ticket para revisar).
**19-sep (055):** 65809be7 resuelto (ver arriba). Cinta de empaque de El Fenix 17-sep -> Bodega; las otras 3 compras de la
misma cinta (El Fenix 11-ago $339.60, El Iris 21-ago y 7-sep $385.20) siguen en Desechables hasta que Alejandro diga si toda
esa cinta es de Bodega. Cintas en "pz" pasadas a "rollo" y agregadas al historial de precios ($28.30 Fenix, $32.10 Iris).
**Siguiente:** (1) ¿toda la cinta de empaque es Bodega?;
(2) septiembre ya entra con la IA nueva (3.8 + catalogo limpio + envios + pan repartido): medir cuantos tickets nuevos salen
sin alertas; (3) Google Sheets (secret) y rellenar; (4) avisar a Alejandro si vuelve a aparecer un precio fuera de rango
como el aceite Ave ($745 vs $490).

## Sesion 2026-09-18 (Claude) -- IA de lectura: cuota, modelo, catalogo y agosto WP revisado
**Diagnostico (con evidencia en BD + logs):**
- La IA "no funcionaba" por CUOTA: la llave de Gemini era de un proyecto GRATIS (~20-25 lecturas/dia). El gerente
  sube en rafagas (14-jul ~250, 5/6-ago ~250, 11-sep ~200) y casi todo fallaba -> 500 tickets "ilegibles" con fecha
  inventada. Alejandro cambio GEMINI_API_KEY por la llave del proyecto pagado TICKETS SE (gen-lang-client-0656779549,
  Tier 1 prepago, creditos ~MX$1,000, TOPE MENSUAL MX$100, recarga automatica APAGADA).
- Modelo: prueba sobre 22 tickets reales con lectura verdad -> **gemini-3.8-flash 17/22 perfectos** (2.5-flash 8/22,
  3.1-pro 13/22, flash-lite 10/22). ~US$0.015 por ticket (~MX$0.27). Cadena: 3.8-flash -> 3.1-pro-preview -> 3.1-flash-lite@minimal.
- El emparejador de catalogo ligaba al PRIMER producto con UNA palabra en comun ("queso americano" -> "dedos de queso",
  Heineken/Fanta/Sidral -> Coca-Cola por "355ML", "LITROS" -> Viaje de agua). Eso inflaba "precio anomalo".
- El historial de precios se llenaba AL SUBIR (tickets sin revisar) y con totales como precio unitario (gas LP $77/L).
- Duplicado factura+ticket: la regla 3 marcaba como duplicado compras que se repiten (pipa $1,160 semanal, pan $55,
  Nutrioli $785, gas). Ahora solo si UNO de los dos documentos es factura. Reales: Cervezas y Refrescos (no FEMSA).
- Google Sheets NUNCA ha funcionado (secret GOOGLE_SERVICE_ACCOUNT_KEY mal guardado). Se arregla y rellena DESPUES.

**Desplegado (Edge Functions):** procesar-ticket v34, reprocesar-ticket v8, confirmar-admin v8.
- `_shared/gemini.ts` (REST, rondas de reintento, fallo cuota/saturado, fechas hora Mexico, modelo@nivel),
  `_shared/catalog.ts` (emparejador por puntaje: mayoria de palabras, presentacion 325ml vs 1.18L, singulares, prefijos Costco),
  `_shared/duplicados.ts` (factura+ticket solo con una factura; alias FEMSA=Propimex=Coca-Cola),
  `_shared/precios.ts` (anomalo = +-40% vs MEDIANA de ultimas 5, min 3 previas; `guardarPrecios` solo al CONFIRMAR, misma unidad).
- reprocesar-ticket: `solo_leer`+`modelo` (probar modelos), `solo_si_sin_leer` (lote), **`desde_guardada`** (rehace renglones,
  ligas y alertas desde gemini_raw SIN pagar Gemini; usar tras ensenar sinonimos). Ya no borra `revisar_gerente`.
- confirmar-admin v8 se desplego con un `_shared/catalog.ts` recortado (solo tipos; import type): en el proximo deploy usar el real.

**Migraciones aplicadas:** 030 (alerta ia_sin_leer, 500 fallidos re-etiquetados), 031 (categoria "Otros gastos operativos"),
032 (alerta revisar_gerente + motos), 033 (45 fechas imposibles de confirmados), **034** (catalogo WP: 102 productos nuevos,
sinonimos a 50, duplicados Coca-Cola 12pk/Cajas H21/Fibra metalica fusionados, basura "Total"/"Precio politros"/"Tom"
desactivada, renombres Maracuya/Cebolla morada/Jugo de naranja galon/Bohemia (tenia una E cirilica)/Jamon FUD; gas 6-jun
confirmado que reportaba $710 corregido a $700), **035** (lectura corregida de los 150 tickets en gemini_raw._revision),
**036** (historial de precios WP reconstruido solo con confirmados, 184 precios / 67 productos), **037** (cierre agosto).
Respaldos: esquema `respaldo.r030_*`, `r031_*`, `r033_fechas`, `r034_catalogo`, `r034_items_wp`, `r034_precio_historial`, `r034_tickets`.

**Agosto Wings Palace (carga del 11-sep, 150 tickets) -- HECHO:** releidos con 3.8-flash, revisados UNO POR UNO contra la
foto (10 revisores; 75 bien, 63 corregidos -sobre todo notas a mano-, 12 dudosos). 145 confirmados. 5 quedan pendientes
con "Revisar con gerente": 1095886d (dice 19/02, se puso 19/08), 1b112f3d (cabrito+mixiote $804: insumo o Extras?),
fd300835 (numeros encimados, posible alteracion), 11fc5f27 y a5b4e428 (duplicados de factura de Cervezas y Refrescos,
en pestana Fraude grupos ...0801/0802; se confirmo solo la factura). Confirmados con nota (dudas menores, total cuadra):
60e2df27 (sin dia -> 1-ago), 0a115581 (precio encimado, 170 = precio usual), d20f1541 ($141 vs $144), f1cf8eea ($12 vs $14),
d0073b34 (concepto ilegible $30), 19150aa9 (cantidades encimadas), 05a5f504 ($78 sin desglose: hielo $46 + bolsas $32 estimado).
Sin foto en Storage: 72c96e80 (y 0e77486c, a7239aef de antes).

**2a revision (18-sep, tarde): carga WP del 5/6-ago (resulto ser casi todo JULIO) + viejos del 11-sep + 12 confirmados de agosto.**
262 tickets releidos con 3.8 (177) y revisados contra foto (11 revisores): 125 bien, 112 corregidos, 21 dudosos, 4 copias.
Migraciones **040** (95 productos nuevos, sinonimos a 133), **041** (lecturas corregidas), **042** (IEPS PIAYS proporcional,
3 rechazos por copia, 7 grupos de Fraude ...0901-0907: 4 factura+ticket/remision de Cervezas y Refrescos, reimpresion Nutrioli,
"gas compras Aps" $1,350 sin ticket de gasera firmado por Fer Villanueva y subido 2 veces, doble cobro JugoKarl 16784/16704;
3 posibles alteraciones cbb10061/32feb23d/d88af3f5; 19 revisar_gerente). 253 confirmados; 6 pendientes (4 duplicados,
gas compras, JugoKarl). Motos con nombre (Lindsay, Fer Villanueva) -> Extras + revisar_gerente.
**ESTADO AGOSTO WP: 187 confirmados, TODOS revisados contra foto y cuadrados al centavo (renglones = total con IVA) = $108,627.11.**
Pendientes agosto (6): 1095886d (19/02?), 1b112f3d (cabrito $804), fd300835 (alteracion), 11fc5f27 y a5b4e428 (duplicados de
factura), a7239aef (sin foto). JULIO parcial: 228 confirmados (210 revisados), falta la carga del 13/14-jul (180 sin leer + ~29
leidos con 2.5). Patrones para vigilar: jugo de limon JugoKarl $258/galon en julio vs $173 en agosto; moto servicio $74 prom en
julio (hasta $140) vs $50 normal.

**Gastos CON IVA (decision Alejandro 2026-09-18, "mas facil de cotejar"):** `_shared/montos.ts` suma el impuesto SOLO a los
renglones que lo pagan: acepta la diferencia como impuesto si subtotal (o subtotal antes del descuento) = suma de renglones y
subtotal+IVA(+IEPS) = total; IVA parejo 16% -> proporcional; si no, busca la tasa por renglon (0/8/16/IEPS+IVA, solucion unica);
si nada cuadra NO reparte y alerta `monto_anomalo` (noCuadra: tickets 0.5%, notas a mano 2%; renglones null cuentan 0 salvo que
todos sean null). Gemini ahora tambien devuelve `ieps`. Marca en gemini_raw: `_impuestos_sumados` (pesos). Admin (page.tsx):
el total leido manda; si los renglones no suman sale aviso ("captura los importes con IVA"). Revision adversarial de 3 agentes
encontro 17 problemas en la 1a version (ver commit). Migraciones **038** (19 facturas de agosto) y **039** (IVA por renglon en
3 facturas mixtas + 18 facturas viejas confirmadas con 16% exacto, 11 WP / 7 SE; historial de precios WP reconstruido con IVA).
Respaldos r038_items, r039_items. Los confirmados viejos que no cuadran por otra razon se arreglan al revisarlos contra la foto.

**PENDIENTE:**
- **Tope de gasto Gemini**: Alejandro lo subio a MX$500 (18-sep). Gastado ~MX$130 al cierre del 18-sep. Faltan de WP: 165 sin leer de la carga 5/6-ago (~MX$45),
  ~75 leidos con 2.5 pendientes (46 de ago, 29 del 11-sep; releer ~MX$20) y julio (180 sin leer + 29). Alejandro debe
  subir el tope a ~MX$300 (AI Studio > Spend > Set spend cap) antes de seguir.
- git push HECHO 18-sep (Alejandro, login por codigo: `git config --global credential.gitHubAuthModes device`). Vercel en produccion con 26a47e0.
- Llave de Gemini rotada 18-sep (nueva ...4GUA en Supabase, probada). Alejandro debe BORRAR la vieja ...rcXw en AI Studio.
- Santa Elena: "AVE ACTION FRY 10L" global esta en categoria Desechables (es aceite -> Insumos); emparejador nuevo ya aplica,
  pero su historial de precios sigue con lo viejo (reconstruir como 036 cuando se revise SE).
- Borrar tablas temporales `public._tmp_firmas` y `public._tmp_bake` al terminar la revision de agosto.
- Sheets: arreglar secret y rellenar historial (todos los confirmados tienen sheets_row_id NULL).

## Coordinacion Claude + Codex
- `CLAUDE.md` y `AGENTS.md` son la guia estable para ambos agentes; mantenerlos sincronizados.
- Este archivo es la fuente viva para estado real, decisiones recientes, deuda conocida y proximo trabajo.
- Antes de pulir o corregir, leer primero estos tres archivos y luego el area afectada.
- Codex hizo auditoria local el 2026-06-08: build frontend OK, sin cambios de codigo aun.

## Estado general: EN PRODUCCION (funcional end-to-end)

App movil para que gerentes suban fotos de tickets de gasto. Gemini (vision)
extrae los renglones, auto-categoriza, y el admin audita el costo vs ventas por
sucursal. Todo en `main`, deploy automatico en Vercel.

---

## Cambios 2026-06-13 -- debug relectura IA y rechazo visible
- Causa raiz del error intermitente al usar "Volver a leer IA": los tickets confirmados/auto-confirmados conservan `storage_path_original`, pero la imagen ya fue movida a `archivo`; `reprocesar-ticket` elegia `por-revisar` por existir esa columna y fallaba la descarga.
- Fix local: `reprocesar-ticket` intenta descargar primero desde `storage_path_archivo`/bucket `archivo` y luego cae a `storage_path_original`/bucket `por-revisar`. Si ambos fallan, responde JSON con `error` y `detalle` para depuracion.
- Frontend Tickets: la accion de relectura invoca la Edge Function por `fetch` con token admin para leer el JSON de error real; el toast deja de mostrar solo el generico de Supabase "Edge Function returned...".
- Frontend Tickets: los tickets `rechazado` ahora muestran motivo derivado (`duplicado`, `ilegible`, `fraude`, `manual` o motivo guardado en `gemini_raw`) y la lista trae `es_duplicado`/`duplicado_de` + metadatos de `alertas_tickets`.
- Orden de renglones: nueva migracion 028 agrega `ticket_items.orden`. `procesar-ticket` y `reprocesar-ticket` guardan el indice que devuelve Gemini; Tickets y Sheets ordenan por `orden`.
- Sinónimos/ligado al releer: el input de producto ahora se envia en el form. Si se liga/escribe producto y el texto OCR no fue editado, el renglon toma el nombre del producto y el texto detectado queda como sinonimo; no se renombra el catalogo al OCR por accidente.
- Fraude vs alertas: tickets enviados a revision de fraude ya no cuentan ni aparecen en "Con alerta" mientras sigan en flujo de fraude.
- Lenguaje UI Tickets: `pendiente` se muestra como "Por confirmar"; la cola antes llamada "Con alerta" ahora es "Requieren revision"; se quito el chip generico "Revisar ticket" para no mezclar estado con accion.
- Equivalencias de inventario: Tickets y Catalogo permiten capturar `1 caja/cono = 30 pz de huevo`. Se guarda usando el segundo nivel existente (`30 pz`, cada `pz = 1 huevo`) para que Inventario/Stock muestren `30 huevo(s)` y no solo piezas genericas. No requiere migracion ni Edge Function nueva.
- Pendiente: Claude debe aplicar migracion 028 y desplegar `procesar-ticket`, `reprocesar-ticket`, `confirmar-admin` y `confirmar-ticket` (ver `AGENTS.md` > PENDIENTE DEPLOY). Hasta desplegar, produccion seguira con funciones anteriores.

### Cambios 2026-06-13 (Claude) — auditoria de venta: bug de sesion, seguridad, kiosko, deploy parcial
- **BUG REPORTADO RESUELTO** (commit 2803d1c, desplegado): token de sesion del admin vencido (pestana abierta >1h) rompia confirmar (401, "no va a completados") y ensenar productos (insert al catalogo bloqueado por RLS y el error se TRAGABA en silencio). Reproducido a nivel API. Fix: `ensureFreshSession()` + auth explicito en `lib/supabase.ts`, refresco al volver a la pestana en `layout`, `confirmarTicket` reintenta, `ensureProduct` ya no traga el error.
- **Seguridad** (mig 027 = `hardening_rpc_grants_v2`, commit 7153366): cerro RPCs ejecutables por `anon` (`verificar_pin` fuerza bruta, `limpiar_imagenes_antiguas`), `admin_guardar_empleado` exige admin real, `set_updated_at` search_path fijo.
- **Kiosko** (commit a4e0e1d): PIN ya no muestra 429/5xx como "PIN incorrecto"; error de red ya no cae en "404" muerto (solo PGRST116); fetch de PIN con timeout 15s; `FileReader` usa onload/onerror (no onloadend) -> no mas pantalla en blanco.
- **Deploy parcial de las edge functions pendientes**: migracion **028 aplicada**; **`reprocesar-ticket` v3 desplegado** (fix de relectura desde bucket `archivo` -> resuelve el error "No se pudo releer"). Las otras 3 NO se desplegaron: el repo `procesar-ticket` habia driftado (le faltaba `.neq('estado','rechazado')` que prod v27 ya tiene); se reconcilio el repo (commit 925d328) pero no se redesplego porque su unico aporte (`orden`) es cosmetico. Ver `AGENTS.md` > PENDIENTE DEPLOY.
- **Triage de auditoria (2026-06-14, hecho)**: verificacion adversarial de 5 hallazgos.
  - REALES arreglados: (1) **storage** — buckets de fotos solo exigian `authenticated`, no `is_admin()` (fuera del hardening 023) -> **mig 029** aplicada+verificada (admin lee signed URL 200, anonimo 400). (2) **mutaciones optimistas** que mentian "guardado" al fallar -> chequeo de `error` en tickets (marcarSospechoso, resolverSospecha, guardarMotivo, actualizarHeader, borrarRenglon, syncTicketTotal), comercios (setCategoria, eliminar), sucursales (toggleActiva), catalogo (guardarEdicion). Commit 4de3a17. (3) **inyeccion de formulas en Sheets** -> `sanitizarCelda` en google-sheets.ts (commit e45b870), **DESPLEGADO** confirmar-admin v5 / procesar-ticket v28 / confirmar-ticket v12 (verificado: regex intacto + cargan sin error). procesar-ticket v28 cierra tambien el drift de 028 (`.neq`+`orden`).
  - FALSOS POSITIVOS (descartados con razon): **CORS *** (API con bearer token, sin cookies/credenciales -> sin vector); **`.limit()` sin ORDER BY** (ningun caso real cae en la trampa).
  - Pendiente menor (auto-sanan): toggles de catalogo (toggleCat/toggleOperativo/toggleProd) aun optimistas sin chequeo de error; bajo impacto (idempotentes + refetch).

---

## Como funciona AL MOMENTO (flujo real)

### 1. Gerente sube ticket (movil)
1. Escanea QR / abre `/sucursal/[slug]` → ingresa PIN → `verificar-pin` devuelve
   un `session_token` (JWT HMAC propio, 1h) que se guarda en sessionStorage.
2. Toma o elige **una o varias fotos** → "Enviar".
3. El frontend manda cada imagen a `procesar-ticket` con `Authorization: Bearer <session_token>`.
4. **Respuesta instantanea**: "¡Enviado! Muchas gracias". El gerente NO espera a la IA.

### 2. Procesamiento en SEGUNDO PLANO (async)
`procesar-ticket` (Edge Function) responde `{recibido:true}` al instante y sigue
con `EdgeRuntime.waitUntil()`:
- Sube la imagen a Storage (`por-revisar`), inserta `registros_tickets` (encabezado, estado `pendiente`).
- Llama a **Gemini** (modelo `gemini-2.5-flash`, configurable via secret `GEMINI_MODEL`,
  con fallback automatico a otros modelos). Prompt multi-producto + categorias y
  catalogo de la sucursal como contexto.
- Inserta N **`ticket_items`** (un renglon por producto), cada uno auto-categorizado.
- Genera alertas SOLO por excepcion: `ilegible` (confianza baja), `producto_no_reconocido`
  (renglon sin categoria), `sin_unidad`, `posible_duplicado`, duplicado por hash.
- Si NO hay alertas → **auto-confirma**: mueve la imagen a `archivo/AAAA-MM/`, manda
  una fila por item a Google Sheets, estado `confirmado`.
- Si hay alertas → queda `pendiente` para que el admin lo revise.

### 3. Admin audita (web /admin)
Login Supabase Auth. **Un selector de sucursal en el header filtra TODAS las
secciones** (contexto global, persistido en localStorage; "Todas" = global).

---

## Secciones del admin (todas operan por sucursal)

| Ruta | Que hace |
|---|---|
| `/admin/dashboard` (Arqueo) | Gasto real (de `ticket_items` confirmados) vs ventas, % por categoria con objetivo y semaforo, dona y tendencia. Selector mes/rango. Export a Excel. Usa el objetivo de la sucursal con global de respaldo. |
| `/admin/tickets` | Lista TODOS los tickets (filtro periodo + sucursal del header) con foto, comercio, total y **quien lo subio**. Detalle con foto + renglones. Boton "Descargar periodo" → ZIP con imagenes + tickets.csv. |
| `/admin/alertas` | Legacy: la ruta existe, pero ya no esta en el nav. La operacion diaria se hace desde `/admin/tickets`. |
| `/admin/ventas` | Captura manual de la venta mensual por sucursal (para el arqueo). |
| `/admin/catalogo` | Catalogo + categorias fusionados. Cada categoria con sus productos. Categoria: renombrar, activar, toggle **Operativo/No operativo** (si suma o no al gasto de operacion). Producto: agregar, **editar (mover de categoria, unidad, sinonimos)**, activar, eliminar. Por sucursal (global + de la sucursal). La IA auto-aprende productos aqui. |
| `/admin/comercios` | Comercios que la IA aprendio (su categoria habitual). Corregir categoria u olvidar. Por sucursal. |
| `/admin/objetivos` | % objetivo de costo por categoria. Por sucursal (global de respaldo). |
| `/admin/sucursales` | CRUD de sucursales y empleados (PIN). Enlace + **QR descargable**. Eliminar (o desactivar si tienen datos). |

---

## Base de datos (tablas principales)

- `sucursales` (slug, nombre, activa) · `empleados` (pin_hash bcrypt) · `sucursal_empleados` (N:M)
- `registros_tickets` — **encabezado** del ticket (comercio, fecha, folio, monto total,
  sucursal, empleado, estado, storage paths, hash, gemini_raw). Columnas producto/cantidad/
  unidad legacy (no se usan para tickets nuevos).
- **`ticket_items`** — renglones (descripcion, cantidad, unidad, monto, categoria_id,
  producto_catalogo_id, necesita_revision, motivo_revision).
- `categorias_gasto` (+ `sucursal_id` NULL=global) · `catalogo_productos` (+ `sucursal_id`)
- `alertas_tickets` (tipo, resuelta) · `ventas` (sucursal+mes+monto) ·
  `objetivos_costo` (categoria + `sucursal_id` NULL=global + pct_objetivo)

### Funciones / jobs
- `verificar_pin(slug, pin)` — valida PIN (SECURITY DEFINER).
- `admin_guardar_empleado(...)` — crea/edita empleado hasheando el PIN (SECURITY DEFINER).
- `limpiar_imagenes_antiguas()` + **pg_cron mensual** — borra fotos con +1 año (conserva datos).

### Storage
- Buckets `por-revisar` y `archivo` (PRIVADOS). El admin ve las fotos via **URLs firmadas**
  (createSignedUrl). RLS: SELECT para `authenticated` (migracion 011).

- `comercios` (nombre, sucursal_id, categoria_id, veces) — la IA aprende la categoria habitual de cada comercio.
### Migraciones aplicadas: 001–022
  (017 = categoria nullable + RPC ligar_huerfano; 018 = precio_historial + equivalencias;
   019 = consumo_inventario; 020 = backfill productos en limbo; 021 = descuentos;
   022 = CHECK de alertas para Tickets unificado)

---

## Edge Functions (Deno, verify_jwt=false, auth JWT HMAC propio)
- `verificar-pin` — PIN → session_token.
- `procesar-ticket` (v25) — async: responde rapido + Gemini multi-producto en background + auto-confirma.
  Aprende comercios/productos, registra precios (alerta `precio_anomalo` vs promedio) y matchea con
  PRECISION (sinonimos <4 chars solo exactos; match por token completo, no substring).
  Aprende comercios (`aprenderComercio`) y **auto-aprende productos** (`aprenderProductos`): cada renglon
  que entiende y categoriza, si no existe en el catalogo, lo inserta solo en el catalogo de la sucursal.
  Prompt usa el nombre del comercio para distinguir (gasolinera→combustible vs gas de cocina) y normaliza
  abreviaturas/erratas (popt→popote).
- `confirmar-ticket` — confirmacion manual (1 fila/item a Sheets). (El happy path auto-confirma desde procesar-ticket.)
- `confirmar-admin` (verify_jwt=true) — el admin confirma un ticket revisado desde Alertas (archiva + Sheets + estado).
- `reprocesar-ticket` (verify_jwt=true) — segunda pasada manual de IA desde Tickets; reemplaza renglones y deja el ticket pendiente para revision.
- `enviar-alerta-email` — Resend para alertas criticas.
- Deploy: via Supabase MCP `deploy_edge_function` (no hay token para el CLI de supabase).

## Cambios 2026-06-08 — pulido Tickets + IA + Entradas
- `/admin/tickets` queda como centro de revision: muestra chips de alerta, permite editar encabezado, editar/agregar/borrar renglones, ensenar sinonimos/equivalencias, confirmar, rechazar, eliminar y relanzar IA.
- `/admin/alertas` se quita del nav. La tabla `alertas_tickets` sigue como backend de senales, pero el admin ya no debe operar desde una pantalla separada.
- IA: se sube calidad de imagen movil a 2400px/JPEG 0.86; Gemini conserva descripcion literal y usa catalogo solo para categoria/unidad.
- IA: se detiene auto-aprendizaje de productos desde lecturas crudas. Producto nuevo queda pendiente para que el admin lo confirme desde Tickets, evitando contaminar catalogo.
- Duplicados exactos: ahora crean registro `rechazado` con alerta `duplicado`, para que aparezcan auditables en Tickets.
- `sin_fecha`: si Gemini no lee fecha valida se usa fecha de subida, se marca `_fecha_asumida` y se genera alerta para revisar.
- Entradas/Dashboard/Excel: unidades base se muestran siempre. Si no hay equivalencia, se usa identidad 1:1 con el nombre del producto (ej. `7 Pan de Nutella`).
- Nueva funcion `reprocesar-ticket`: segunda pasada manual, reemplaza renglones actuales, resuelve alertas previas y genera nuevas senales.
- Verificado local: `node --test frontend/lib/units.test.mjs` OK; `npm run build` OK; `http://localhost:3000/admin/tickets` responde 200 en dev.
- Pendiente de despliegue: Supabase CLI no tiene `SUPABASE_ACCESS_TOKEN` y `db push --linked` no ve link activo. Aplicar migracion 022 y desplegar `procesar-ticket` + `reprocesar-ticket` desde Supabase MCP/Dashboard o con `supabase login`.

## Auditoria Codex 2026-06-08
- Verificacion local: `npm run build` en `/frontend` termino OK con Next 14.2.29 y genero 18 rutas.
- `CLAUDE.md` estaba desfasado vs este archivo: migraciones 001-013, Gemini 1.5 en env vars y estructura sin funciones nuevas. Se sincronizo junto con `AGENTS.md`.
- Deuda detectada: `/sucursal/[slug]/subir/page.tsx` conserva estados `review/confirming`, `ticketData`, `registroId` y llamada a `confirmar-ticket`, pero el flujo actual async nunca llena esos estados. No rompe build, pero conviene limpiarlo o decidir si se revive review del gerente.
- Deuda detectada: `confirmar-ticket` queda como funcion legacy para confirmacion manual del gerente. El camino admin usa `confirmar-admin`. Antes de desplegar cambios, decidir si se mantiene por compatibilidad o se retira del frontend/backend.
- Riesgo a revisar en produccion: `procesar-ticket` hace auto-confirmacion en background; si falla mover archivo o Sheets, el error es non-blocking/solo log. Validar que el admin vea claramente tickets limpios que no llegaron a Sheets si ocurre una falla externa.
- Riesgo a revisar en datos: los descuentos entran como monto negativo y dashboard netea gasto operativo. Confirmar con usuarios si quieren ver ahorro separado por sucursal/periodo en Tickets, Excel y Sheets, no solo en Dashboard.

---

## Gemini
- `gemini-1.5-flash` fue RETIRADO por Google (404). Modelo actual: **`gemini-2.5-flash`**
  (funciona con la API key con billing). Configurable sin redeploy via secret `GEMINI_MODEL`.
- Cadena de fallback de modelos en `procesar-ticket` por robustez.
- Imagen → base64 con `encodeBase64` de Deno std (no `String.fromCharCode` que desborda el stack).

---

## Stack / servicios
- Frontend Next.js 14 (Vercel, auto-deploy desde `main`, rootDirectory=frontend).
- Supabase `tickets-se` (ref `dlmqqmvrgkilptawllep`). Google Sheets (service account).
- Repo `ACHAZARO/tickets-se` (remote con owner en MAYUSCULAS; credencial GCM fijada a ACHAZARO).

---

## Login admin
- `alepolch@gmail.com` (creado por SQL; se le agrego identity + columnas de token para que
  GoTrue lo aceptara). Crear nuevos admin desde el Dashboard de Supabase, NO por SQL directo.

---

## Fixes 2026-06-04 (tarde)
- **PIN: cualquier PIN entraba** (bug de seguridad). La pagina del PIN solo revisaba
  `res.ok` (verificar-pin responde HTTP 200 con `{valid:false}` para PIN incorrecto).
  Ahora exige `data.valid===true && data.session_token`. /subir redirige al PIN si la
  sesion no trae token. Verificado en vivo: PIN incorrecto ya no entra.
- **"Enviando" colgado**: era `createImageBitmap` (compresion de imagen) colgandose con
  fotos de celular, bloqueando antes del envio. Fix: timeout de 8s en la compresion
  (fallback a la foto original) + 45s en el fetch. Verificado: flujo completo en ~1.7s.
- NOTA: el cache del telefono puede servir codigo viejo; probar en incognito para forzar la version nueva.

## Cambios 2026-06-11 — Polish final: backlog y catálogo al máximo

### Estado del sistema (post-sesión)
| Sucursal | Confirmados | Rechazados | Pendientes |
|---|---|---|---|
| SANTA ELENA | 32 | 2 | **0** |
| WINGS PALACE | 104 | 36 | **0** |

### Catálogo
- 158+ productos, 0 sin unidad, 0 sin categoría, 64+ con sinónimos.
- Comercios: 30 activos, todos categorizados, duplicados eliminados.
- Unidades normalizadas: bebidas en pz (no ml), métricas en canónico.

### Tickets procesados en sesión
- **Wings Palace**: 58 pendientes liquidados (1 banco rechazado, 7 OCR reprocesados y confirmados, 13 confirmados vía fix de datos, 37 ilegibles rechazados).
- **Santa Elena**: 5 tickets nuevos (subidos ~10:52am) procesados y confirmados:
  - `00fa617a` Xallapan panadería $1,140 — comercio asignado, unidades pz.
  - `2317e8ff` SAN LUIS desechables $129 — unidad pz.
  - `8b7d2508` PLÁSTICOS PALACIOS $255 — unidades pz.
  - `b4867dcd` CHEDRAUI $31 — items OCR basura eliminados, producto real limpio.
  - `331e9892` ilegible — rechazado.

### Deuda resuelta esta sesión
- 0 alertas sin resolver en tickets confirmados.
- Fechas erróneas corregidas (2028/2029 → 2026).
- JUGO KARL duplicado fusionado.

---

## Cambios 2026-06-10 — Revision de fraude
- **Nueva pestaña "Fraude"** en Tickets (5º chip rojo con conteo). Junta tickets sospechosos
  **agrupados** (no solo pares) con motivo editable y resolución por ticket (Descartar / Es fraude).
- **Marcado manual** desde el detalle del ticket ("🚩 Marcar como sospechoso").
- **Botón "Buscar sospechas"** que corre 4 reglas (lib/fraude.mjs, puro, tests 4/4):
  canasta repetida (mismos productos, distinto total, días cercanos), posible duplicado
  (mismo comercio+total, fechas cercanas), salto de precio (unitario sobre histórico del producto),
  monto atípico (total sobre promedio del comercio). origen = manual/auto/ia.
- Migración **026** (`sospechoso`, `sospecha_motivo`/`origen`/`grupo`/`estado`), aplicada por MCP.
- Futuro (anotado por Alejandro): ligar al POS para detectar "se compró 2 veces y no había salido".
- **Fix 2026-06-10 (detección)**: el escáner solo miraba confirmados y aplicaba la ventana al rango
  completo del grupo (un ticket viejo lo mataba). Ahora incluye **pendientes**, agrupa por **cercanía
  de fecha (clusters)** y **particiona por sucursal**; corre también en "Todas". Verificado contra datos
  reales (p.ej. Cervezas y Refrescos 05-28 $542 vs 05-29 $606).
- **Unidades pieza vs volumen**: las bebidas de 355ml se cuentan **por pieza** (caja → N pz, sin nivel ml);
  solo lo que se sirve (2L, salsas, gasolina) va en volumen. Corregidos en catálogo: mineral 24/.355L,
  Bohemia CRISTAL (tenía unidad "ML"), CC lata 12pk. Clamato 2.5L se dejó en volumen (se sirve).

## Cambios 2026-06-09 (b) — kiosko, equivalencias y rendimiento
- **Pantalla de PIN (kiosko) rehecha mobile-first**: columna centrada y compacta (antes `justify-between`
  dejaba huecos enormes en pantallas altas), teclado de botones cuadrados, altura reservada para el error.
- **Kiosko `subir` pulido**: eliminado el bloque "review/confirming" muerto (~130 líneas inalcanzables).
  La edge `confirmar-ticket` quedó huérfana (borrar opcional en Dashboard; el MCP no borra edge functions).
- **Páginas huérfanas eliminadas**: `ventas`, `objetivos` (confirmado por Alejandro). `categorias` = redirect.
- **Equivalencias — fix raíz**: la unidad era una lista cerrada (sin "cono") y los inputs de equivalencia
  estaban gateados a 5 contenedores. Ahora la unidad es **texto libre con sugerencias** (datalist) en
  tickets y catálogo, y la equivalencia se muestra para CUALQUIER unidad no-base.
- **Equivalencia de DOS niveles** (migración 025, columnas `contiene_sub_cantidad`/`contiene_sub_unidad`):
  "1 caja = 24 pz, y cada pz = 355 ml" → cadena completa. `units.mjs`: `computeBaseUnits` expande 2 niveles
  a la unidad más granular + nuevo `unitViews()` (caja/pz/ml). Tests 5/5. Config con preview en tickets y catálogo.
- **Stock multi-unidad**: cuando hay equivalencia muestra "Disponible: 1 caja · 24 pz · 8,520 ml".
- **Conversiones estándar (units.mjs)**: `toCanonical`/`sameDimension`/`pretty`. `computeBaseUnits`
  normaliza unidades métricas a su canónico (ml/g): 2.5 lt = 2500 ml, 3 kg = 3000 g, 1 galón = 3785 ml.
  Así suman y comparan bien sin configurar equivalencia. El modal de consumo de Stock acepta una unidad
  (ej. "2.5 lt") y la convierte sola a la base. Display "bonito" (lt/kg) en Stock/Entradas/Gasto. Tests 9/9.
- **Rendimiento del modal de tickets**:
  - Imagen redimensionada vía transform de Supabase Storage (1400px/q72) en vez del original de MB.
    Miniaturas de lista con `loading=lazy`.
  - Selector de producto por renglón = **buscador con `<datalist>` compartido** (antes cada renglón era un
    `<select>` con todo el catálogo → miles de `<option>`). Liga por nombre exacto o crea por nombre al guardar.
- **Limitación de verificación**: el screenshot del Chrome MCP se cuelga en esta app (websocket/realtime deja
  el `document_idle` abierto). Verificado por build + tests + migración; lista de tickets confirmada viva por DOM.

## Cambios 2026-06-09 — UI/UX (navegación en vivo) + features
Auditoría visual del panel logueado y mejoras implementadas/desplegadas:
- **Triaje en Tickets**: chips con conteo (Todos/Pendientes/Con alerta/Confirmados) para filtrar rápido.
- **Toasts + modal de confirmación** (`app/admin/ui.tsx`, `AdminUIProvider`): reemplazan TODOS los
  `alert()/confirm()` nativos en tickets, catalogo, cerebro, comercios, sucursales.
- **Zoom de miniatura** al pasar el mouse en la lista de Tickets.
- **Tablas**: scroll horizontal solo en móvil (`md:min-w-0`), sin scrollbar en escritorio.
- **Kiosko**: detecta sesión expirada (401) y redirige a re-ingresar el PIN.
- **confirmar-admin v4**: confirmación ATÓMICA (claim) — un solo request manda a Sheets (no duplica fila).
- **Nueva pantalla Stock** (`/admin/stock`): existencias = entradas (confirmadas, en unidad base por
  equivalencia) − consumo (`consumo_inventario`); registro de consumo por producto.
- Limpieza: páginas `alertas`, `ventas` y `objetivos` legacy eliminadas. `categorias` = redirect a catalogo.
- **Kiosko (`subir`) pulido**: eliminado el bloque "review/confirming" muerto (~130 líneas inalcanzables:
  `handleConfirm`/`confirmar-ticket`, `ticketData`, `DataRow`, estados review/confirming). El flujo vivo
  (idle→preview→processing→done/error) quedó intacto y verificado en vivo (redirige a PIN sin sesión).
- **PENDIENTE MANUAL (opcional, Alejandro)**: la edge function `confirmar-ticket` quedó huérfana (ya nada
  la llama). El MCP no puede borrar edge functions; si quieres, elimínala en Supabase Dashboard >
  Edge Functions > confirmar-ticket. Es inofensiva (gateada por JWT de sesión) si se deja.
- La lectura "Ilegible" de tickets manuscritos/borrosos es inherente a la imagen, no a un defecto de código.

## Cambios 2026-06-08 (b) — auditoría + endurecimiento de seguridad
Auditoría multi-agente (32 hallazgos confirmados). Arreglado lo crítico:
- **SEGURIDAD (RLS, mig 023)**: todas las tablas pasaron de "cualquier authenticated" a
  `public.is_admin()` (allowlist `admin_users`). Cierra acceso cross-sucursal y el riesgo de
  signup público. Lectura pública solo de `sucursales` activas (kiosko).
- **RPCs (mig 024)**: `verificar_pin`/`limpiar_imagenes` solo service_role; `ligar_huerfano`
  exige admin y sin anon.
- **Edge functions service_role**: validan admin REAL en código (verify_jwt del gateway NO basta,
  la anon key pública pasaba). confirmar-admin v3, reprocesar-ticket v2. enviar-alerta-email v3
  exige el service role key. procesar-ticket v27 (insert con check, dedup robusto, Sheets mes del ticket).
- reprocesar-ticket: ya NO borra renglones si la IA falla.
- Frontend: login→/admin/tickets; nav móvil scrollable; borrar categoría reasigna objetivos_costo;
  reintentarIA trae ticket fresco; error de carga visible.
- **PENDIENTE MANUAL (Dashboard Supabase)**: deshabilitar "Allow new users to sign up" en
  Authentication (no se puede por código/MCP). La RLS admin-only ya mitiga, pero conviene cerrarlo.
- Nota auto-aprendizaje: desde v26 (Codex) procesar-ticket YA NO auto-aprende productos desde IA
  (una lectura mala contaminaba el catálogo); los productos nuevos se enseñan manual en Tickets.

## Cambios 2026-06-08 — sync Codex + deploys
- Codex unifico la revision en `/admin/tickets` (commit 39e259d): editor inline, `reprocesar-ticket`
  (releer con IA), `lib/units.mjs` (+tests, pasan), migracion 022 (tipos de alerta).
- **Claude desplego lo que faltaba en la nube** (Codex no tiene MCP): `procesar-ticket` **v26**
  (descripcion literal, alerta `sin_fecha`, NO auto-aprende productos, duplicado = ticket
  `rechazado`), `reprocesar-ticket` **v1**, migracion 022 aplicada.
- Fix: feedback "✓ Guardado" al guardar renglon en Tickets (regresion de la unificacion).
- Protocolo de despliegues Claude<->Codex documentado en AGENTS.md (bitacora de sincronizacion).

## Cambios 2026-06-07 — descuentos + scope "Todas"
- **Descuentos** (categoría operativa global + producto, migración 021; procesar-ticket v25):
  la IA captura descuentos/promos como renglón con monto NEGATIVO (categoría "Descuentos") →
  resta del gasto operativo (dinero ahorrado). Dashboard: gasto operativo neto, dona usa solo
  gasto positivo, tarjeta "Ahorro (descuentos)".
- **Fix scope "Todas"**: Catálogo/Cerebro/Comercios mostraban solo lo global → ahora "Todas"
  muestra todas las sucursales. Antes los productos por-sucursal quedaban invisibles.
- **Fix aprendizaje en Tickets/Editar**: ahora crea/liga el producto (antes quedaba en limbo).
  Migración 020: backfill de 36 renglones en limbo (ej. hielo).
- procesar-ticket en **v25**.

## Cambios 2026-06-06 (b) — más desglose y correcciones
- Dashboard: tabla "En dónde se gasta (comercios)" (tickets, gasto, % del total).
- Reporte (Excel): columna "Precio unitario prom." por producto.
- Entradas: columna Categoría (en tabla y CSV).
- Alertas: contador "Cambio de precio".
- Fix: borrar producto del catálogo desligaba mal (FK NO ACTION) → ahora desliga renglones
  primero y verifica el error (antes fallaba en silencio y reaparecía al recargar).

## Cambios 2026-06-06 — pulido y precisión
- **Matcher de productos preciso** (procesar-ticket v24 + catalog.ts): sinónimos/nombres de <4
  chars (gas, 1, ala) solo coinciden EXACTO; el match por palabra es por token completo, no
  substring. Antes "gas" o "1" como sinónimo arrastraba renglones equivocados. Datos limpiados.
- **Sinónimos al renombrar**: en la revisión, lo que leyó la IA originalmente queda como sinónimo
  del producto final aunque solo renombres (no solo al "vincular"). Dedup case-insensitive.
- **Reporte (Excel) multi-hoja** en dashboard: Resumen, Categorías, Comercios, Productos, Detalle.
- **Catálogo**: renombrar producto (el nombre viejo → sinónimo) + equivalencias.
- **Cerebro liga**: forzar categoría de comercio; equivalencia al ligar contenedores.
- **Tickets**: botón "Confirmar ticket" para pendientes (los empuja al arqueo + resuelve alertas).
- **Precios/Entradas** leen la fuente real (renglones confirmados) → muestran TODO.
- Se elimina la página `/admin/huerfanos` (ahora viven en el Cerebro). Nav: Entradas (antes Inventario).
- Pendiente conocido: `consumo_inventario` (migración 019) quedó sin UI tras renombrar a Entradas;
  disponible para una futura pantalla de stock real.

## Cambios 2026-06-05 (b) — precios visibles, inventario y pulido
- **procesar-ticket v23**: alerta de precio compara vs PROMEDIO de hasta 5 compras previas,
  requiere ≥2 registros y misma unidad (menos falsos positivos).
- **confirmar-admin v2**: registra precio de renglones ligados durante la revisión.
- **/admin/precios**: último precio, anterior, variación %; fila expandible con mini-gráfica.
- **/admin/inventario** (migración 019): unidades base compradas − consumo manual = disponible.
- **Dashboard**: unidades base por equivalencia en "Productos más comprados".
- **Cerebro**: buscadores por columna + ligado masivo de huérfanos.
- Nav admin: + Precios, + Inventario.

## Cambios 2026-06-05 (Cerebro completo + precios)
- **procesar-ticket v22**: registra precio unitario por renglón (precio_historial),
  detecta saltos >40% vs referencia → alerta `precio_anomalo`. Liga total a producto en
  notas de un solo renglón. Subida múltiple con reintentos + progreso.
- **Nuevas pantallas admin**: `/admin/huerfanos` (cola sin categoría, RPC ligar_huerfano con
  back-fill) y `/admin/cerebro` (tablero de 3 paneles ligados Comercios/Categorías/Productos
  con resaltado cruzado, ligar huérfanos, mover producto).
- **Catálogo**: borrar categoría con reasignación; editar producto (mover categoría, unidad,
  sinónimos) y **equivalencias** (1 unidad contiene X de Y).
- **Revisión de alertas**: precio/cantidad editables, vincular renglón a producto existente
  (el texto mal leído queda como sinónimo), guardado con feedback + renglón listo se colapsa.
- **Tickets**: editar renglones de cualquier ticket; filtro por comercio; lista por fecha de subida.
- **Dashboard**: filtro por artículo, tarjeta "Auto-clasificado %", split operativo/no operativo.
- Migraciones 017 y 018. PLAN_CEREBRO.md: todas las fases 0–7 ✅.

## Cambios 2026-06-04 (tanda IA + gasto)
- **Dashboard sin ventas**: la etapa actual es 100% captura de gasto + entrenar IA + ver
  distribucion. Donut con tooltip al pasar/tocar (nombre + monto + %). Split
  **operativo vs no operativo** (compras de equipo no ensucian la operacion). Tabla de
  categorias con % del gasto y "Productos mas comprados" con **cantidad por periodo**.
- **IA aprende comercios** (`comercios`): mapea comercio→categoria dominante; se inyecta al
  prompt como pista fuerte. Pantalla `/admin/comercios` para corregir.
- **IA auto-aprende productos** (procesar-ticket v20): cada renglon entendido y categorizado
  que no exista, se inserta al catalogo de la sucursal. El usuario solo edita si algo esta mal.
- **Editar producto en catalogo**: mover de categoria, cambiar unidad y sinonimos por producto.
- **Gasolina mal clasificada (→ "Gas" de cocina)**: prompt ahora usa el comercio para distinguir
  combustible vs gas de cocina. Sembrado: comercio "CENTRO GASOLINERO ANIMAS SA DE CV" →
  "gasolina y motor" (suc vale) + producto "Gasolina" (sinonimos magna/premium/diesel). Renglones
  historicos "GAS" de esa gasolinera recategorizados a "gasolina y motor".
- **Fecha mal leida tiraba tickets fuera del filtro de mes**: ahora si Gemini da fecha invalida
  se usa la de hoy; fecha/comercio editables en `/admin/tickets`.
- **Eliminar tickets** + descarga ZIP del periodo + retencion de imagenes +1 año (pg_cron).

## Pendiente / ideas
- Siguiente sesion de pulido: revisar primero deuda `confirmar-ticket`/pantalla review legacy, visibilidad de fallas Sheets y UX movil de subida multiple.
- Re-aprender comercio al confirmar desde Alertas (que las correcciones del admin refuercen el mapa comercio→categoria).
- Marcar esquinas de la foto para recortar ruido a Gemini (opcional; 2.5-flash lee bien).
- markitdown (Microsoft): util solo si suben PDFs/facturas digitales, no para fotos.
- Decidir si se elimina el flujo legacy `confirmar-ticket` del gerente o si se revive una pantalla de review manual antes de confirmar.
