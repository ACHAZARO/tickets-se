---
name: subidos-vs-oficiales-api
description: "Por que existe \"Subidos vs Oficiales / Por justificar\" y la API api-cuentas (2026-09-19): deteccion de gerentes que inflan tickets; definiciones y donde vive la llave"
metadata: 
  node_type: memory
  type: project
  originSessionId: f679bdfe-7792-4f51-9d7b-071fd3adb4ea
  modified: 2026-09-19T19:31:34.493Z
---

Alejandro quiere poder decirle a un gerente: "subiste $X en tickets (todo, con duplicados/fraudes), solo valen $Y, debes justificar la diferencia". Su programa de revision de cuentas consume una API de solo lectura con: total capturado, total autorizado y resumen por categoria de lo autorizado.

**Why:** un gerente puede meter tickets de mas (facturas dobles, papel repetido, alterados) para que su gasto real cuadre contra lo subido. La diferencia subidos - oficiales es lo que no puede comprobar.

**How to apply:**
- Definiciones en la RPC `resumen_tickets` (migraciones 056-058): subidos = todo el periodo sin importar estado (duplicado sin monto propio cuenta con el monto del original, salvo si se confirma); oficiales = confirmados; por_justificar = subidos - oficiales. Una sola fuente para la tarjeta de /admin/tickets y la API; no duplicar el calculo en JS.
- En sucursales reales los tickets NO se eliminan (se rechazan): borrar los saca de "Subidos". Solo PRUEBA (`sucursales.es_prueba`) se puede borrar y queda fuera de totales.
- API: edge function `api-cuentas` (verify_jwt=false siempre), guia `API_CUENTAS.md`. Llave en `_secretos/llave-api-programa-cuentas.txt` (gitignored); en BD solo el hash SHA-256 (`api_keys`). Nunca imprimir la llave en pantalla/logs (claude-mem la guardaria).
- Precios/stock en la API: Alejandro dijo que con resumen basta; se agregan como rutas nuevas si las pide.
- Otra sesion puede estar corriendo en paralelo en este repo (mismo dia aparecio una 055): revisar `git log`/`ls migrations` antes de numerar una migracion.

**Aclaracion de Alejandro (19-sep):** NO se guarda un "monto del papel" aparte. Ticket alterado (papel $420, real $210) = se registra el monto REAL ($210) + alerta de fraude/"revisar con gerente"; al responder el gerente, subidos y oficiales suman lo mismo. "Por justificar" mide sobre todo tickets RECHAZADOS (notas dobles, viejas, gastos ajenos a la operacion). Ej.: 10 tickets x $100 = subidos 1000; se rechazan 5 = oficiales 500; si el gasto que reporta el gerente iguala 1000, esta usando tickets no validos (senal fuerte de fraude).
**API por cuenta (migracion 060):** cada llave `tk_` pertenece a UNA cuenta (`api_keys.cuenta_id`); el futuro es multi-cuenta (otras personas crean cuentas y solo ven lo suyo). Nunca hacer endpoints globales. Al abrir registro publico: cambiar el DEFAULT de `sucursales.cuenta_id` y agregar RLS por cuenta.
