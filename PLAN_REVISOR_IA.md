# PLAN -- Segundo revisor IA (2026-10-03)

> Objetivo de negocio: que al humano le llegue POCO por revisar (y se justifique pagar la app).
> Hoy (14 dias al 03-oct, sin sucursales de prueba): **27 de 63 tickets (43%) van a revision humana**, y en 30 dias
> mas del 95% de las alertas se cerro SIN correccion registrada (falsas alarmas). Al cerrar septiembre SE, de 26
> pendientes ~20 se hubieran podido aprobar solos.

## Diagnostico
- No es el modelo: Gemini LEE bien. Es la programacion: reglas fijas (`procesar-ticket`) mandan al humano todo lo
  "nuevo o raro" (producto no ligado, fecha asumida, precio +-40%, monto no cuadra) sin preguntarle a nadie si tiene sentido.
- Lo que hace Claude al revisar y la app no: mirar la foto + historial del comercio + catalogo + reglas y RAZONAR.

## Diseno
- Funcion nueva `revisor-ia` (Gemini, misma llave). Solo para tickets que hoy quedan con alertas.
- Recibe: foto, lectura de la IA, alertas con su detalle (que renglon, precio vs mediana, fecha leida vs asumida,
  candidatos del catalogo, ticket "duplicado"), historial del mismo comercio, catalogo, reglas `reglas_ia` de la cuenta.
- Devuelve: veredicto `aprobar` | `humano`, decision y motivo por alerta, renglones corregidos, pregunta concreta al humano.
- REGLA DE ORO (vender): el prompt solo trae reglas universales; lo de cada negocio sale de la BD (`reglas_ia`, catalogo).
- Siempre al humano: sospecha de alteracion, texto dirigido a la IA, ilegible, duplicado probable, envio alto.
- La NOTA del gerente NUNCA se manda a Gemini (regla 083).

## Criterios "listo para venta" (aprobados por Alejandro 03-oct)
| # | Criterio | Meta |
|---|---|---|
| 1 | De lo que el humano rechazo o marco Fraude, cuanto aprobo el revisor | **0** |
| 2 | Lo que aprueba solo: monto, fecha, categoria y producto correctos | **>= 95%** |
| 3 | Tickets que siguen llegando al humano (del total) | **<= 15%** |
| 4 | Cada decision trae motivo entendible | muestreo |
| 5 | Costo por ticket revisado | < US$0.05 |
| 6 | Cumple 1-5 en vida real | 3 semanas seguidas |
| 7 | Sirve para otro negocio (no solo Santa Elena) | 1 negocio distinto o cuenta piloto |

## Fases
1. **Prueba en seco** (en curso): `revisor-ia` modo prueba sobre tickets ya revisados (desde 14-sep; excluye la carga del
   7-sep con cuota agotada). NO cambia tickets: guarda el juicio en `revisor_ia_pruebas`. Comparar contra lo que decidio el
   humano. Primero Flash (`gemini-3.8-flash`); Pro solo en un subconjunto (tope de la llave: MX$100/mes).
2. **Modo sombra** en produccion: corre tras `procesar-ticket`, deja su nota, no aprueba. Humano sigue revisando.
3. **Activado**: aprueba solo; humano revisa muestra semanal.
4. Criterios 6 y 7 -> listo para venta.

## Fase 2 elegida: RONDAS MANUALES (decision Alejandro 03-oct; la app NO se mueve)
En vez de meter el revisor a `procesar-ticket`, se hace la sombra por conversacion. 4 capas: lector Gemini -> revisor IA ->
Claude AUDITOR -> Alejandro decide. Procedimiento de cada ronda:
1. Alejandro avisa "hay tickets nuevos" (ideal: ANTES de que el los revise, para no juzgar algo ya corregido).
2. Claude lista pendientes con alertas automaticas (sucursales no de prueba) y corre `revisor-ia` sobre cada uno desde el admin
   logueado en el Chrome de Alejandro (`fetch` a functions/revisor-ia con el access_token de `sb-...-auth-token`).
3. Claude audita cada juicio contra la FOTO (no contra la lectura) y anota: de acuerdo / en desacuerdo + por que.
4. Entrega tabla: ticket | revisor dijo | auditor dice | recomendacion. Alejandro decide (Claude aprueba via `confirmar-admin` solo con su OK).
5. Marcador acumulado en "Rondas" (abajo): aciertos, errores (aprobo algo malo / mando a humano sin necesidad / dato mal).
   Cada error -> regla o candado nuevo -> nueva `VERSION_PROMPT`; las rondas siguientes miden la version nueva.
6. Listo para venta tras ~3 semanas con: 0 aprobados que Alejandro rechace, >=95% correcto en lo aprobado, <=15% a humano.
   Meter tickets de Wings Palace en alguna ronda (criterio 7).

## Rondas
| Fecha | Version | Tickets | Revisor aprobo | Aprobo mal | Mando a humano sin necesidad | Notas |
|---|---|---|---|---|---|---|
| (pendiente primera ronda) | v2 | | | | | |

## Limitaciones conocidas de la prueba en seco
- El catalogo de hoy trae sinonimos ensenados DESPUES de esos tickets (el arreglo `sinonimos` no tiene fecha): favorece un
  poco al revisor. Se excluyen productos creados despues de la subida y precios posteriores.
- `gemini_raw` es la ULTIMA lectura (si se releyo, no la original).
- La "respuesta correcta" es lo que quedo tras la revision humana (muchos revisados por Claude contra foto 18-sep y 03-oct).

## Bitacora
- 2026-10-03: plan + criterios aprobados. `revisor-ia` modo prueba desplegada (admin-only; corre desde el admin logueado:
  `fetch(functions/revisor-ia, {registro_id, modelo?})`), migracion `087_revisor_ia_pruebas`.
  Grupo de prueba: 67 tickets = 54 confirmados SE subidos desde 14-sep con alertas + 13 rechazados (12 de jul-ago, varios Wings).
- **v1 (gemini-3.8-flash)**: 43/67 aprobar; recientes 41/54 aprobados (76%); fechas y totales de lo aprobado 100% iguales al
  humano; ~6.4 s y ~10k tokens entrada + 1.5k salida por ticket. FALLO criterio 1: aprobo 2 rechazados (papel repetido sin
  alerta de duplicado: factura+remision Wings 25-jun $727.50 y JugoKarl 16784 "se debia nota del 21-7"). Tambien proponia
  productos "nuevos" que ya existian (LIMON vs Limones) y mandaba a humano fotos con varios papeles engrapados.
- **v2**: lista "OTROS TICKETS PARECIDOS" (mismo folio o total +-2% a +-7 dias, cualquier orden de subida) + regla de
  misma compra / notas que liquidan otra; regla de papeles engrapados; candados en codigo (`aplicarCandados`): liga
  "nuevos" que ya existen, fuerza humano con duplicado/envio_alto/sospecha/texto para IA/renglones que no suman.
- **v2 resultados (mismos 67, gemini-3.8-flash)**:
  - Criterio 1: **13/13 rechazados mandados a humano (0 aprobados)**. Pregunta concreta en cada uno (misma factura, mismo folio, "se debia nota").
  - Criterio 2: aprobados 44; **fecha 44/44, total 44/44, categoria 144/144 renglones** iguales al humano. Producto: 98 iguales;
    29 "nuevo" donde el humano uso uno existente, pero casi todos esos productos se CREARON el 19-20 sep (revision humana y copia por
    sucursal 074), despues de la subida: no es error. El acierto de producto solo se mide en modo sombra.
  - Criterio 3: desde 14-sep hubo 97 tickets; hoy 54 fueron a humano (56%); con el revisor irian **10 (10%)**. Los 10 son dudas
    reales: Costco $195 sin ticket, Casa Ahued $250 (Fraude), sumas a mano de Adan, 2 envios altos, papeleria sin desglose,
    "JGO DE" cortado, nota $935 al reverso, dos motos de $45 el mismo dia.
  - Criterio 4: motivos y preguntas claras (ver `juicio->alertas` y `pregunta_para_humano`).
  - Criterio 5: ~10k tokens entrada + 1.5k salida; estimado ~US$0.02/ticket (por lo medido en la lectura; confirmar en la factura de Google).
  - OJO: v2 se ajusto con este mismo grupo (riesgo de "aprenderse el examen"). La prueba real es el modo sombra con tickets nuevos.
  - No hizo falta probar Pro: Flash cumple 1-5.
- **Siguiente (requiere OK de Alejandro, toca produccion)**: fase 2 modo sombra -- `procesar-ticket` llama a `revisor-ia` cuando
  deja alertas; el juicio se guarda y se muestra en Tickets ("El revisor IA aprobaria: ..."), sin aprobar nada.
