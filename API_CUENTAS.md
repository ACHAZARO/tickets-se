# API de Tickets para el programa de revision de cuentas

API de **solo lectura**. Responde cuanto capturo cada sucursal en tickets, cuanto se autorizo y como se
distribuyo lo autorizado por categoria. Codigo: `backend/supabase/functions/api-cuentas/index.ts`.

- **URL base:** `https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas`
- **Llave:** archivo local `_secretos/llave-api-programa-cuentas.txt` (no esta en git). Se manda en cada llamada:
  `Authorization: Bearer <llave>` (o el encabezado `x-api-key: <llave>`). La llave empieza con `tk_`.
- Solo `GET` (otro metodo: `405`). Sin llave o con llave mala: `401`. Fechas mal escritas o imposibles (ej. 31 de febrero), rango invertido o mayor a 400 dias: `400`. Sucursal o ruta inexistente: `404`. Falla interna: `500`.
- No se puede llamar desde un navegador (a proposito, sin CORS): es para el servidor de tu programa.

## Conceptos (los mismos que muestra la pantalla de Tickets)

| Campo | Que es |
|---|---|
| `subidos` | **Todo** lo que se subio en el periodo, sea cual sea su estado. Duplicados y rechazados cuentan. Un duplicado sin monto propio cuenta con el monto de su original (el papel se subio dos veces), salvo que ese duplicado se confirme: entonces cuenta $0 como oficial. Es lo que el gerente "captura". |
| `oficiales` | Solo tickets **confirmados**, con el monto ya corregido en la revision (si dudaba entre 49 y 96 y se confirmo 49, cuenta 49). Es lo que **si vale**. |
| `en_revision` | Tickets que aun no se deciden (por confirmar). No estan en oficiales todavia. |
| `no_validos` | Rechazados. `por_motivo`: `fraude` (papel repetido, alterado o reutilizado, en la revision de Fraude), `duplicado` (la misma foto subida dos veces) y `otro` (ilegible, remision, manual). |
| `otros_estados` | Tickets en cualquier otro estado (hoy solo existiria `archivado`; normalmente 0). |
| `por_justificar` | `subidos - oficiales` (= `en_revision` + `no_validos` + `otros_estados`). Si el gasto que declara el gerente cuadra contra todo lo subido, esto es lo que no puede comprobar. |
| `oficiales_por_categoria` | Solo lo oficial, repartido por categoria (renglon por renglon, con IVA). `Descuentos` viene en negativo y ya resta. |
| `oficiales_gasto_operativo` / `oficiales_fuera_de_operacion` | Suma de las categorias que cuentan / no cuentan para el % de operacion (`cuenta_operativo`). Fuera de operacion hoy: Bodega, Extras, gasolina y motor. |
| `oficiales_sin_desglosar` | `oficiales.monto` menos la suma de categorias. Deberia ser 0; si no, un ticket tiene el total distinto a sus renglones. |
| `tickets_sin_monto_leido` | Tickets (de cualquier estado) sin monto legible; cuentan como $0. |

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

### `GET /sucursales`

Lista de sucursales reales: `{ "sucursales": [ { "slug": "santa-elena", "nombre": "SANTA ELENA" }, ... ] }`.

## Ejemplo de llamada

```bash
curl -H "Authorization: Bearer $LLAVE" \
  "https://dlmqqmvrgkilptawllep.functions.supabase.co/api-cuentas/resumen?desde=2026-09-01&hasta=2026-09-30"
```

## Administrar llaves

Solo se guarda el **hash SHA-256** de la llave (tabla `api_keys`); la llave real no se puede recuperar.
- **Llave nueva:** generar `tk_` + 48 caracteres hex al azar, guardar el SHA-256 de la llave COMPLETA (con el `tk_`) con
  `insert into api_keys (nombre, key_hash) values ('nombre', '<sha256>')` (migracion aplicada: 056).
- **Revocar:** `update api_keys set activa = false where nombre = '...'`. `last_used_at` dice cuando se uso por ultima vez.
- Si la llave se filtra: revocarla y crear otra (2 minutos).
- La funcion debe desplegarse siempre con `verify_jwt=false` (la llave `tk_` no es un JWT; con `true` el gateway la rechaza).

## Para agregar despues (no hecho, el disenio lo permite)

Cambios de precios (`precio_historial`), stock/inventario y detalle ticket por ticket: se agregan como rutas nuevas
en la misma funcion, con la misma llave.
