-- 051: envios anotados a mano por la gerente del cafe en junio, julio y septiembre (segunda pasada solo de envios
-- sobre 320 fotos). Mismo criterio que 050: renglon "Moto envio" (Otros gastos operativos) por la diferencia.
-- Excluidos: 65809be7 (+$429.91, pregunta abierta a Alejandro) y los totales a mano que son suma de tickets engrapados.
-- Claude 2026-09-18.
create table if not exists respaldo.r051_tickets as
  select id, monto, gemini_raw from registros_tickets where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3';
create temp table _env(id8 text, envio numeric) on commit drop;
insert into _env values
  ('ee2dc7ef', 80), ('a937b2f1', 60), ('17745f86', 60), ('86e5c138', 60), ('a1c09d93', 60), ('beb352be', 60), ('181caf3e', 60),
  ('c0fee69c', 60), ('746a6173', 60), ('e66fe7bc', 60), ('9152dc3a', 60), ('e77deda6', 60), ('0bd95fe5', 60), ('06cf957b', 50),
  ('f2454e9d', 45), ('c842d1a8', 42), ('c6908906', 45), ('08760fa9', 45), ('047541aa', 50), ('5b6afa0d', 60), ('00fa617a', 60),
  ('6bdd64d7', 60), ('687d524a', 60), ('7a44d510', 60), ('eb8f9b3c', 60), ('42250291', 100), ('adff1b35', 40), ('c2724e5f', 40);
insert into ticket_items (registro_ticket_id, descripcion, cantidad, unidad, monto, categoria_id, producto_catalogo_id, necesita_revision, orden)
select r.id, 'Moto envío', 1, 'servicio', e.envio,
  (select id from categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null limit 1),
  (select id from catalogo_productos where nombre = 'Moto envío' and sucursal_id = r.sucursal_id and activo limit 1),
  false, coalesce((select max(i.orden) from ticket_items i where i.registro_ticket_id = r.id), 0) + 1
from registros_tickets r join _env e on r.id::text like e.id8 || '%'
where r.estado = 'confirmado' and r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and not exists (select 1 from ticket_items i where i.registro_ticket_id = r.id and i.descripcion ilike 'moto env%');
update registros_tickets r set monto = r.monto + e.envio,
  gemini_raw = r.gemini_raw
    || jsonb_build_object('monto_total', round((r.monto + e.envio)::numeric, 2),
                          'items', (r.gemini_raw->'items') || jsonb_build_array(jsonb_build_object('descripcion', 'Moto envío', 'cantidad', 1, 'unidad', 'servicio', 'monto', e.envio, 'categoria', 'Otros gastos operativos')),
                          '_envio_a_mano', e.envio)
from _env e
where r.id::text like e.id8 || '%' and r.estado = 'confirmado' and r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and not (r.gemini_raw ? '_envio_a_mano')
  and not exists (select 1 from jsonb_array_elements(r.gemini_raw->'items') x where x->>'descripcion' ilike 'moto env%');
