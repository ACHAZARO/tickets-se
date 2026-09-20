# API de Tickets para el programa de revision de cuentas

API de **solo lectura**. Responde cuanto capturo cada sucursal en tickets, cuanto se autorizo y como se
distribuyo lo autorizado por categoria (y, de cada categoria, por producto). Codigo: `backend/supabase/functions/api-cuentas/index.ts`.

- **URL base:** `https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas`
- **Llave:** archivo local `_secretos/llave-api-programa-cuentas.txt` (no esta en git). Se manda en cada llamada:
  `Authorization: Bearer <llave>` (o el encabezado `x-api-key: <llave>`). La llave empieza con `tk_`.
- Solo `GET` (otro metodo: `405`). Sin llave o con llave mala: `401`. Fechas mal escritas o imposibles (ej. 31 de febrero), rango invertido o mayor a 400 dias: `400`. Sucursal o ruta inexistente: `404`. Falla interna: `500`.
- **Cada llave pertenece a UNA cuenta** (`api_keys.cuenta_id`) y solo ve las sucursales de esa cuenta: no existe una vista global. Pedir una sucursal de otra cuenta da `404` igual que si no existiera, y el total solo suma las sucursales de la propia cuenta. (Probado con una cuenta ajena temporal: veia solo lo suyo, y la llave principal no veia lo de ella.)
- No se puede llamar desde un navegador (a proposito, sin CORS): es para el servidor de tu programa.

## Conceptos (los mismos que muestra la pantalla de Tickets)

| Campo | Que es |
|---|---|
| `subidos` | **Todo** lo que se subio en el periodo, sea cual sea su estado. Duplicados y rechazados cuentan. Cada ticket suma SOLO el monto de su propio papel: si no se leyo monto (p. ej. una nota de remision sin importe junto a la factura de la misma compra), cuenta $0, porque con un papel sin monto no sale dinero de la caja. Es lo que el gerente "captura". |
| `oficiales` | Solo tickets **confirmados**, con el monto ya corregido en la revision (si dudaba entre 49 y 96 y se confirmo 49, cuenta 49). Es lo que **si vale**. |
| `en_revision` | Tickets que aun no se deciden (por confirmar). No estan en oficiales todavia. |
| `no_validos` | Rechazados. `por_motivo`: `fraude` (papel repetido, alterado o reutilizado, en la revision de Fraude), `duplicado` (la misma foto subida dos veces) y `otro` (ilegible, remision, manual). |
| `otros_estados` | Tickets en cualquier otro estado (hoy solo existiria `archivado`; normalmente 0). |
| `por_justificar` | `subidos - oficiales` (= `en_revision` + `no_validos` + `otros_estados`). Si el gasto que declara el gerente cuadra contra todo lo subido, esto es lo que no puede comprobar. |
| `oficiales_por_categoria` | Solo lo oficial, repartido por categoria (renglon por renglon, con IVA). `Descuentos` viene en negativo y ya resta. |
| `oficiales_gasto_operativo` / `oficiales_fuera_de_operacion` | Suma de las categorias que cuentan / no cuentan para el % de operacion (`cuenta_operativo`). Fuera de operacion hoy: Bodega, Extras, gasolina y motor. |
| `oficiales_sin_desglosar` | `oficiales.monto` menos la suma de categorias. Deberia ser 0; si no, un ticket tiene el total distinto a sus renglones. |
| `tickets_sin_monto_leido` | Tickets (de cualquier estado) sin monto legible; cuentan como $0. No incluye las copias de foto ni los duplicados, que cuentan $0 por definicion. |

El periodo se filtra por **fecha del ticket** (los que no tienen fecha entran por su fecha de subida, hora de Mexico).
La sucursal de prueba no entra nunca.

## Endpoints

### `GET /resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sucursal=slug]`

- Sin `desde`/`hasta`: del dia 1 del mes actual a hoy (hora de Mexico). Rango maximo: 400 dias.
- Sin `sucursal`: regresa `total` (todas las sucursales reales) y `por_sucursal` (una entrada por sucursal).
- Con `sucursal=santa-elena` o `wings-palace`: regresa solo esa sucursal.

Ejemplo real (`?sucursal=wings-palace&desde=2026-07-01&hasta=2026-07-31`):

```json
{
  "periodo": { "desde": "2026-07-01", "hasta": "2026-07-31" },
  "sucursal": { "slug": "wings-palace", "nombre": "WINGS PALACE" },
  "subidos":   { "monto": 175710.21, "tickets": 252 },
  "oficiales": { "monto": 155808.62, "tickets": 230 },
  "no_validos": {
    "monto": 19901.59, "tickets": 22,
    "por_motivo": {
      "fraude":    { "monto": 15961.72, "tickets": 12 },
      "duplicado": { "monto": 3939.87,  "tickets": 10 },
      "otro":      { "monto": 0,        "tickets": 0 }
    }
  },
  "en_revision":   { "monto": 0, "tickets": 0 },
  "otros_estados": { "monto": 0, "tickets": 0 },
  "por_justificar": 19901.59,
  "oficiales_por_categoria": [
    { "categoria": "Insumos Alimentos",       "monto": 120779.07, "renglones": 484, "cuenta_operativo": true },
    { "categoria": "Otros gastos operativos", "monto": 19098.39,  "renglones": 39,  "cuenta_operativo": true },
    { "categoria": "Descuentos",              "monto": -3718.39,  "renglones": 34,  "cuenta_operativo": true }
  ],
  "oficiales_gasto_operativo": 155093.74,
  "oficiales_fuera_de_operacion": 714.88,
  "oficiales_sin_desglosar": 0,
  "tickets_sin_monto_leido": 0
}
```

(la lista de categorias del ejemplo esta recortada; la real trae todas.)

### `GET /desglose?categoria=<nombre>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sucursal=slug][&detalle=1]`

Desglose **por producto** de UNA categoria, solo con lo autorizado (tickets confirmados). Sirve para preguntar, por ejemplo,
"de Bodega, cuanto fue playo, cuanto bolsas, cuanto envios". El total de la categoria coincide con su renglon de
`oficiales_por_categoria` del `/resumen`. El nombre de la categoria no distingue mayusculas; si no existe (o no es de tu cuenta) da `404`
con la lista `disponibles`. Sin `sucursal`: regresa el total y `por_sucursal`.

- `total`: `monto`, `renglones` (lineas de ticket) y `tickets`.
- `por_producto` (de mayor a menor monto): `producto` (nombre del catalogo; si el renglon no esta ligado, lo escrito en el ticket), `monto`,
  `renglones`, `cantidades` (lista `[{unidad, cantidad}]`, una por unidad distinta) y `pct_de_la_categoria`.
- `detalle=1` agrega `renglones`: cada compra (`fecha`, `comercio`, `ticket_id`, `producto`, `descripcion`, `cantidad`, `unidad`, `monto`),
  maximo 1000 (`renglones_truncados` avisa si hubo mas).

Ejemplo real (`?categoria=Bodega&sucursal=santa-elena&desde=2026-06-01&hasta=2026-09-30`, recortado):

```json
{
  "periodo": { "desde": "2026-06-01", "hasta": "2026-09-30" },
  "sucursal": { "slug": "santa-elena", "nombre": "SANTA ELENA" },
  "categoria": "Bodega",
  "cuenta_operativo": false,
  "total": { "monto": 29262.59, "renglones": 63, "tickets": 32 },
  "por_producto": [
    { "producto": "Playo stretch Reyma 18 cal 80 1300 ft", "monto": 11004.35, "renglones": 18, "cantidades": [{ "unidad": "pz", "cantidad": 38 }], "pct_de_la_categoria": 37.6 },
    { "producto": "Bolsa metalizada cafe 1 kg", "monto": 8926.15, "renglones": 7, "cantidades": [{ "unidad": "kg", "cantidad": 45.42 }], "pct_de_la_categoria": 30.5 },
    { "producto": "Moto envío", "monto": 2078.51, "renglones": 25, "cantidades": [{ "unidad": "servicio", "cantidad": 25 }], "pct_de_la_categoria": 7.1 },
    { "producto": "Flete paqueteria", "monto": 1407.53, "renglones": 1, "cantidades": [{ "unidad": "servicio", "cantidad": 1 }], "pct_de_la_categoria": 4.8 }
  ]
}
```

### `GET /sucursales`

Lista de sucursales reales: `{ "sucursales": [ { "slug": "santa-elena", "nombre": "SANTA ELENA" }, ... ] }`.

## Ejemplo de llamada

```bash
curl -H "Authorization: Bearer $LLAVE" \
  "https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas/resumen?desde=2026-09-01&hasta=2026-09-30"
```

## Administrar llaves

Solo se guarda el **hash SHA-256** de la llave (tabla `api_keys`); la llave real no se puede recuperar.
- **Llave nueva:** generar `tk_` + 48 caracteres hex al azar y guardar el SHA-256 de la llave COMPLETA (con el `tk_`) **indicando de que cuenta es**:
  `insert into api_keys (nombre, key_hash, cuenta_id) values ('nombre', '<sha256>', '<id de la cuenta>')` (`cuenta_id` es obligatorio; tablas `cuentas` y `sucursales.cuenta_id`, migracion 060).
  Cuenta actual: `Alejandro (cuenta principal)`, con Santa Elena, Wings Palace y PRUEBA.
- **Revocar:** `update api_keys set activa = false where nombre = '...'`. `last_used_at` dice cuando se uso por ultima vez.
- Si la llave se filtra: revocarla y crear otra (2 minutos).
- La funcion debe desplegarse siempre con `verify_jwt=false` (la llave `tk_` no es un JWT; con `true` el gateway la rechaza).

## Para agregar despues (no hecho, el disenio lo permite)

Cambios de precios (`precio_historial`), stock/inventario y detalle ticket por ticket: se agregan como rutas nuevas
en la misma funcion, con la misma llave.

## Texto para pegarle a otra IA

Reemplaza `<TU_LLAVE>` por la llave (o usa la copia ya completa en `_secretos/instrucciones-para-otra-ia.txt`). Bloque listo para copiar:

```text
Necesito que consultes la API de "Revision de Tickets" para revisar el gasto de mi negocio. Es de SOLO LECTURA y esta limitada a MI cuenta: solo puedes ver mis sucursales.

CONEXION
- URL base: https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas
- Autenticacion: encabezado  Authorization: Bearer <TU_LLAVE>   (la llave empieza con tk_; no la muestres ni la guardes en ningun otro lado)
- Solo GET. Responde JSON. Montos en pesos mexicanos (MXN).

ENDPOINTS
1) GET /sucursales
   Lista mis sucursales: [{ slug, nombre }].
2) GET /resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sucursal=<slug>]
   - Sin "sucursal": regresa "total" y "por_sucursal" (una entrada por sucursal).
   - Con "sucursal": regresa solo esa sucursal.
   - Sin fechas: del dia 1 del mes actual a hoy. Maximo 400 dias por consulta.
3) GET /desglose?categoria=<nombre>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&sucursal=<slug>][&detalle=1]
   Desglose POR PRODUCTO de una categoria, solo con lo autorizado. Ej.: categoria=Bodega dice cuanto fue en playo, bolsas metalizadas, cinta, envios, etc.
   Los nombres de categoria salen en "oficiales_por_categoria" del /resumen (no importan las mayusculas). Con detalle=1 agrega cada compra (fecha, comercio, producto, cantidad, monto).

QUE SIGNIFICA CADA CAMPO (/resumen)
- subidos: TODO lo que el gerente capturo (tickets subidos) sin importar si despues se rechazo. Incluye duplicados.
- oficiales: lo AUTORIZADO tras la revision (tickets confirmados, con el monto ya corregido). Es el dinero que realmente gestiono el gerente.
- en_revision: subidos que todavia no se deciden.
- no_validos: rechazados (notas dobles, viejas, gastos no relacionados con la operacion, fraude). "por_motivo" los separa en fraude / duplicado / otro.
- por_justificar = subidos - oficiales.
- oficiales_por_categoria: lo autorizado repartido por categoria (Insumos Alimentos, Otros gastos operativos, Desechables, Gas, Limpieza, Bodega, Extras, Descuentos...). "Descuentos" viene en negativo y ya resta. "cuenta_operativo" dice si esa categoria cuenta para el % de operacion.
- oficiales_gasto_operativo / oficiales_fuera_de_operacion: suma de las categorias que cuentan / no cuentan para la operacion.
- tickets_sin_monto_leido: tickets sin monto legible (cuentan como $0).

QUE SIGNIFICA CADA CAMPO (/desglose)
- total: monto, renglones (lineas de ticket) y tickets de esa categoria. Coincide con la categoria en /resumen.
- por_producto: de mayor a menor monto: producto, monto, renglones, cantidades [{unidad, cantidad}] y pct_de_la_categoria.

COMO INTERPRETARLO
- El gasto REAL del gerente es "oficiales", no "subidos".
- Ejemplo: si sube 10 tickets de $100 (subidos = 1000) y se rechazan 5, oficiales = 500 y por_justificar = 500.
- Si el gasto que reporta el gerente coincide con "subidos" y no con "oficiales", esta usando tickets no validos para cuadrar su gasto: es senal fuerte de fraude y la diferencia es lo que debe justificar.
- Un ticket rechazado por si solo no siempre es fraude (puede ser nota doble, vieja o ajena a la operacion); el fraude se ve cuando el gasto reportado se apoya en ellos.
- Usa /desglose cuando una categoria llame la atencion (por ejemplo Bodega o Otros gastos operativos): mira que productos concentran el gasto y si los envios o fletes pesan demasiado.
- Reporta: subidos, oficiales, por_justificar, el reparto por categoria de lo oficial y, si hay diferencia, el desglose de no_validos por motivo. Por sucursal y en total.

ERRORES
- 401: llave incorrecta o revocada. 404: sucursal o categoria que no es de mi cuenta. 400: fechas mal escritas o falta la categoria. Nunca intentes modificar nada (la API no lo permite).

EJEMPLOS
curl -H "Authorization: Bearer <TU_LLAVE>" "https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas/resumen?desde=2026-09-01&hasta=2026-09-30"
curl -H "Authorization: Bearer <TU_LLAVE>" "https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas/desglose?categoria=Bodega&desde=2026-06-01&hasta=2026-09-30"
```
