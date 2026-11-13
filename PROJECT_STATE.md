# PROJECT_STATE.md — Revision de Tickets (estado de hoy)

> Foto del estado de HOY. **Se reescribe en cada cierre de sesion; no se alarga.** Lo que paso en cada sesion va al inicio de `BITACORA_SESIONES.md` y a una nota de `historial`.
> Cambio de computadora / recuperacion: `RECUPERACION.md` y `DIRECTORIO_CUENTAS.md`.
>
> **Ultima actualizacion:** 2026-11-13 (API de cuentas v14 publicada y probada; `beta-amigos` fusionada a `main`).

## Produccion

- **EN PRODUCCION, funcional de punta a punta**, con dos negocios reales: Santa Elena y Wings Palace.
- **`main` = `beta-amigos`** desde el 2026-11-13 (fusion por avance rapido de `7e148fb`: documentacion, candado de esquemas y `api-cuentas`; sin cambios de frontend). Ultimo cambio de pantallas: `bc3f9ba` (2026-11-08, Fraude se cierra desde el detalle). Vercel despliega solo desde `main`.
- **Migraciones aplicadas:** hasta la 116.
- **Edge functions (verificado en Supabase el 2026-11-13):** `api-cuentas` publicada = **v14 del 2026-11-13** (con OK de Alejandro; antes se comparo lo publicado con `origin/main`: iguales). Ya manda la forma de pago en `/bandeja`, en `/desglose?detalle=1` y en el conector MCP: `_trabajo_beta/scripts/qa_api_pagos.py` pasa esos puntos contra produccion. La prueba pasa completa (se le quito una cifra fija vieja el 13-nov).
- **Ramas (2026-11-13):** solo quedan `main` y `beta-amigos`, iguales. Las cuatro ramas viejas ya fusionadas se borraron (local y GitHub) junto con la copia de trabajo `entrenamiento`. Los previews de Vercel usan la MISMA base de datos que produccion.
- **Base compartida (2026-11-12):** el proyecto de Supabase aloja tickets y POS, un esquema por sistema, con candado contra los esquemas `pos` y `bot_whatsapp`. Detalle en `CLAUDE.md`.

## Ultimas sesiones (detalle en la bitacora)

- **2026-11-08** — Fraude: los originales de tickets resubidos ya se pueden cerrar desde el detalle.
- **2026-11-06** — Tickets resubidos por duda quedan como duplicado SIN Fraude. Credito de Gemini.
- **2026-11-05** — La API de cuentas manda la forma de pago en todo ticket: el codigo quedo sin publicar hasta el 13-nov.
- **2026-11-13** — Guias adelgazadas, `api-cuentas` v14 publicada y `beta-amigos` fusionada a `main`.
- **2026-11-04** — Tickets con el mismo encabezado en todas las pestanas; «Tortilla» unificada en Wings; migracion 116; pantalla de Tickets faltantes RETIRADA.
- **2026-11-03** — Beta para negocios de amigos publicada (multi-negocio, alta de cuentas, alertas nuevas, QA 63 de 63). Plan: `PLAN_BETA_AMIGOS.md`.

## Que sigue

1. Lo que reporte Alejandro al revisar tickets reales va primero.
2. Lista viva de mejoras de la app: **`PENDIENTES_APP.md`** (quedan, entre otros, #13 proveedor declarado y #4 recompensas de tiendas grandes).
3. Planes abiertos, cada uno en su archivo: `PLAN_BETA_AMIGOS.md`, `PLAN_REVISOR_IA.md` (segundo revisor IA, en prueba), `PLAN_MODO_ENTRENAMIENTO.md`, `PLAN_IA_CLIENTE.md`, `MULTI_NEGOCIO.md`.

## Esperando a Alejandro

- **Correos a otros negocios:** verificar un dominio en Resend y poner el secret `ALERTAS_REMITENTE`. Sin eso la beta no puede mandar alertas a los amigos.
- **Supabase:** prender la proteccion de contrasenas filtradas (Authentication). Solo el puede.
- **Primera invitacion real de la beta:** con ella se prueba lo que no se probo a mano (registro tecleado en el navegador contra produccion y el correo de «olvide mi contrasena»).
- **`respaldo-config-claude/`:** decidir si se sube a GitHub; hoy solo esta en disco y en Drive.
- **Revision de tickets pendientes** (al 03-nov; verificar cifras en la app antes de usarlas): octubre 15 tickets ($5,104.83), noviembre 6 en lote y 2 en Fraude; falta saber que es «rollo mer» $16.

## Decisiones vigentes del dueno (no re-preguntar)

- Tarjeta en el papel + efectivo declarado es correcto en Wings y Santa Elena (lo paga la moto o el gerente y toma de la caja).
- Nota a mano o remision: siempre la ve una persona, pero se aprueba en lote.
- Reenviar un ticket por duda NO es fraude: duplicado sin Fraude.
- Recompensas de tiendas grandes: el ticket cuenta $0, las entradas a inventario si cuentan.
- Salsas de Wings ($26,670) se registran FUERA de la app a proposito.
- Tickets faltantes: retirado; solo tendria sentido con la caja de la app propia.

## Donde esta la referencia tecnica

- Flujo, stack, schema, edge functions, convenciones: `CLAUDE.md`.
- «Como funciona al momento», secciones del admin y tablas (version de junio-septiembre 2026): al final de `BITACORA_SESIONES.md`. Verificar contra el codigo antes de fiarse.
- API para el programa de cuentas: `API_CUENTAS.md`. Diseno: `DESIGN.md`. Producto: `PRODUCT.md`.
