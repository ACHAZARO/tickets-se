# Auditoria de evidencia de tickets (2026-09-19)

Regla de Alejandro: **lo que sube un gerente nunca se destruye**, aunque el ticket se rechace, sea duplicado o fraude.
Evidencia = (1) la foto en Storage (`por-revisar` / `archivo`), (2) la fila de `registros_tickets` (quien subio, cuando,
hash, rutas, estado) y (3) el monto tal como se capturo (lo que el papel dice), porque el reporte "Subidos vs Oficiales"
sirve para cobrarle al gerente lo que no vale.

Metodo: 4 auditores (frontend, edge functions, base de datos, datos en vivo) + 4 verificadores que intentaron refutar cada
hallazgo. Solo lectura. Codigo desplegado comparado byte a byte con el repo (procesar-ticket v44, reprocesar-ticket v16,
confirmar-admin v10, confirmar-ticket v14). Lineas = HEAD a15eb6c.

**Buena noticia:** hoy los 1,347 tickets tienen su foto (0 perdidas). En el pasado se borraron 15 filas; al parecer pruebas del
4-jun (quedaron 8 fotos sueltas de ese dia, 4.7 MB, varias de PRUEBA): no borrarlas.

**Decisiones de Alejandro (19-sep):** el candado de "Eliminar" en pantalla (solo admin) esta bien; la tarea mensual que
borra fotos de mas de 1 ano esta bien (antes se descarga respaldo; ojo, hoy falla cada mes porque Supabase bloquea borrar
fotos por SQL). Permisos por usuario (gerente sin eliminar, solo ver) quedan para cuando se escale a app para vender.
**Hecho (19-sep):** punto 3, pasar la foto a `archivo` es seguro (copia verificada; el original se quita solo despues de
que el ticket apunta a la copia; candado para que la IA y el admin no confirmen el mismo ticket a la vez; la copia de una
foto identica ya no deja un registro sin foto). Codigo en `_shared/archivo.ts`.

## A. Hoy se puede BORRAR evidencia (prioridad alta)

1. **Borrar ticket + foto.** `page.tsx` `eliminarTicket` borra primero la foto (sin revisar error) y luego la fila; la cascada
   borra renglones y alertas. La otra sesion ya limito el boton a PRUEBA en la UI (sin commit al momento de la auditoria),
   pero **la base lo sigue permitiendo**: politicas `admin_all_registros_tickets` y `admin_all_ticket_items` son FOR ALL
   (023:44-50) y `admin_delete_fotos` en storage.objects (029:20-22) deja borrar fotos por la Storage API.
   Arreglo: cambiar FOR ALL por SELECT/INSERT/UPDATE; quitar `admin_delete_fotos`; trigger BEFORE DELETE en
   `registros_tickets` que falle salvo sucursal `es_prueba` (cubre tambien la service role). Purga solo server-side y solo PRUEBA.
2. **Cron que borra fotos de mas de 1 ano.** `cron.job` jobid 1 `limpiar-imagenes-tickets` ('0 3 1 * *', activo) ->
   `limpiar_imagenes_antiguas()` (012:19-40): borra fotos de ambos buckets y pone en NULL las rutas, sin importar estado.
   Fallo las 3 veces (jul/ago/sep) solo porque `storage.protect_delete` frena el DELETE por SQL; las primeras fotos cumplen
   1 ano en jun-2027. Arreglo: `select cron.unschedule('limpiar-imagenes-tickets')` y borrar la funcion.
3. **Mover foto sin verificar la copia.** procesar-ticket `autoConfirmar` (index.ts:343-349) y confirmar-admin (:61-72) suben
   a `archivo` sin revisar el error y SIEMPRE borran el original de `por-revisar`: si la subida falla, se pierde la unica copia
   (confirmar-admin ademas guarda `storage_path_archivo` aunque la descarga falle). confirmar-ticket (legacy, :132) borra antes
   de actualizar la fila. Arreglo: revisar error + verificar la copia antes de borrar, o copiar y nunca borrar el original.

## B. Se SOBRESCRIBE lo capturado sin historial (alta para el reporte)

4. ~~"Subidos" usa el monto ya corregido -> columna `monto_papel`.~~ **Descartado por Alejandro (19-sep):** un ticket alterado
   (ej. Jugotropick 1-jul: papel $420, real $210) se registra con el monto REAL y se manda a Fraude / revisar con gerente;
   "Por justificar" mide sobre todo tickets rechazados. No se guarda el monto del papel aparte.
5. **Releer IA y editar pisan todo.** reprocesar-ticket (:215-231) reemplaza monto, fecha, comercio, folio y todo `gemini_raw`,
   borra renglones y precios; aplica tambien a confirmados y rechazados y se pierden `_rechazo_motivo`/`_rechazo_auto`.
   En page.tsx: "Borrar" renglon sin confirmacion (:461-470), `syncTicketTotal` pisa el monto (:479-494), "Rechazar" reescribe
   `gemini_raw` desde la copia del navegador (:704-712). Arreglo: trigger de historial en `registros_tickets` y `ticket_items`
   que guarde la fila anterior en una tabla append-only (sin DELETE/UPDATE para nadie): cubre todos los caminos, service role
   incluida. Motivo de rechazo en columnas propias, no dentro de `gemini_raw`.
6. **Un rechazado se puede volver oficial sin querer.** El boton Confirmar sale en rechazados (page.tsx:1091), confirmar-admin
   solo excluye 'confirmado' (:50-55), y guardar un renglon auto-confirma si no hay alertas (:665-668; rechazar resuelve todas).
   Arreglo: confirmar-admin rechaza estado 'rechazado' salvo "reactivar" con motivo; auto-confirmar solo si esta pendiente.

## C. Huecos del reporte (media)

7. 34 rechazados sin monto leido (32 de junio con error de Gemini que nunca se leyeron) cuentan $0 en Subidos. Tienen foto:
   leerlos.
8. Las 11 copias de foto identica no tienen monto propio; el resumen usa el del original (que cambia si el original se corrige).
   Con `monto_papel` se copia al crear la fila.

## D. Defensa en profundidad (baja)

9. anon/authenticated tienen DELETE/UPDATE/TRUNCATE en las tablas de evidencia (defaults de Supabase; RLS frena DELETE y
   PostgREST no expone TRUNCATE). Revocar TRUNCATE y DELETE.
10. Buckets sin versionado y subidas a `archivo` con upsert:true. Bajo si ya no hay borrados.
11. Renombrar un empleado reescribe "quien subio" en todo su historial (`admin_guardar_empleado`). Regla: no renombrar; dar de
    baja y crear otro.
12. 47 tickets no guardan su primera lectura de IA en ningun lado (la foto si esta; se puede releer).

## API para el programa de cuentas

La otra sesion ya hizo `api-cuentas` (`GET /resumen` con subidos / oficiales / por justificar, oficiales por categoria y
operativo vs fuera de operacion; `GET /sucursales`) con llave propia. Faltan: rutas de precios e inventario, y que "subidos"
use `monto_papel` (punto 4) para que el cobro al gerente sea correcto.
