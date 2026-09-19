-- 043: fotos repetidas (mismo archivo, rechazadas solas al subir) fuera de "Requieren revision" y archivadas en su mes;
-- ligas erroneas al producto "Viaje de agua". Respaldos en respaldo.r043_*. Claude 2026-09-18.
create schema if not exists respaldo;
create table if not exists respaldo.r043_tickets as
  select id, estado, fecha_ticket, comercio from registros_tickets where estado = 'rechazado' and es_duplicado and fecha_ticket is null;
create table if not exists respaldo.r043_alertas as
  select a.* from alertas_tickets a join registros_tickets r on r.id = a.registro_ticket_id
  where not a.resuelta and r.estado in ('rechazado', 'archivado');
create table if not exists respaldo.r043_items as
  select i.* from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id
  where p.nombre ilike 'viaje de agua%' and not (i.descripcion ilike '%viaje%' or i.descripcion ilike '%agua potable%');

-- 1) La copia exacta toma fecha y comercio del original: asi se archiva en el mes del gasto y no aparece
--    "colada" en el mes en que se subio (seguia rechazada; no cuenta en reportes).
update registros_tickets d set fecha_ticket = o.fecha_ticket, comercio = coalesce(d.comercio, o.comercio)
from registros_tickets o
where d.duplicado_de = o.id and d.estado = 'rechazado' and d.es_duplicado and d.fecha_ticket is null and o.fecha_ticket is not null;

-- 2) Un ticket rechazado o archivado ya no tiene nada que revisar: sus alertas abiertas se cierran.
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket rechazado: no requiere revision"}'::jsonb
from registros_tickets r
where r.id = a.registro_ticket_id and not a.resuelta and r.estado in ('rechazado', 'archivado');

-- 3) Gas LP, aceite y agua mineral que quedaron ligados a "Viaje de agua" (emparejador viejo): se desligan
--    (la categoria ya era la correcta) y se quita su precio del historial del viaje de agua.
delete from precio_historial h using respaldo.r043_items b
where h.registro_ticket_id = b.registro_ticket_id and h.producto_catalogo_id = b.producto_catalogo_id;
update ticket_items i set producto_catalogo_id = null
from respaldo.r043_items b where i.id = b.id;
