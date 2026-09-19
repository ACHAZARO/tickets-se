-- 050: envios anotados a mano por la gerente del cafe (agosto) que los primeros revisores no capturaron.
-- Alejandro 18-sep: "si se pagaron" -> renglon "Moto envio" en Otros gastos operativos por la diferencia
-- (total a mano - total impreso). Detectados con una segunda pasada solo de envios sobre las 146 fotos. Claude 2026-09-18.
create table if not exists respaldo.r050_tickets as
  select id, monto, gemini_raw from registros_tickets where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' and fecha_ticket between '2026-08-01' and '2026-08-31';
create temp table _env(id8 text, envio numeric) on commit drop;
insert into _env values
  ('e5068eb1', 50), ('68c73118', 80), ('6c2e2f6f', 149), ('8679865d', 80.55), ('3a9203bf', 69.81), ('f9655e35', 69.99),
  ('4b2c5752', 69.99), ('f14ceabe', 79.99), ('3ed2fbf0', 79.99), ('efa2f697', 80.35), ('0f04127f', 79.99), ('27f95252', 79.99),
  ('53dc11bb', 40), ('ccf63c0c', 45), ('e338e56e', 60), ('bd32d3dd', 60), ('8920f8b3', 60), ('75cac5ce', 60), ('fb4c4bb9', 60),
  ('05243409', 60), ('a2c2f992', 60), ('976e9aeb', 60), ('70f85284', 60);
insert into ticket_items (registro_ticket_id, descripcion, cantidad, unidad, monto, categoria_id, producto_catalogo_id, necesita_revision, orden)
select r.id, 'Moto envío', 1, 'servicio', e.envio,
  (select id from categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null limit 1),
  (select id from catalogo_productos where nombre = 'Moto envío' and sucursal_id = r.sucursal_id and activo limit 1),
  false, coalesce((select max(i.orden) from ticket_items i where i.registro_ticket_id = r.id), 0) + 1
from registros_tickets r join _env e on r.id::text like e.id8 || '%'
where r.estado = 'confirmado'
  and not exists (select 1 from ticket_items i where i.registro_ticket_id = r.id and i.descripcion ilike 'moto env%');
update registros_tickets r set monto = r.monto + e.envio,
  gemini_raw = r.gemini_raw
    || jsonb_build_object('monto_total', round((r.monto + e.envio)::numeric, 2),
                          'items', (r.gemini_raw->'items') || jsonb_build_array(jsonb_build_object('descripcion', 'Moto envío', 'cantidad', 1, 'unidad', 'servicio', 'monto', e.envio, 'categoria', 'Otros gastos operativos')),
                          '_envio_a_mano', e.envio)
from _env e
where r.id::text like e.id8 || '%' and r.estado = 'confirmado' and not (r.gemini_raw ? '_envio_a_mano')
  and not exists (select 1 from jsonb_array_elements(r.gemini_raw->'items') x where x->>'descripcion' ilike 'moto env%');
