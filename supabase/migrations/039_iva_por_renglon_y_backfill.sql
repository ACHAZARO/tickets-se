-- 039: IVA por renglon (corrige 038) + backfill de facturas viejas confirmadas con IVA parejo del 16%.
-- 038 repartio el impuesto parejo en todos los renglones; en facturas con tasas mezcladas eso le cargaba
-- IVA a productos tasa 0. Recalculado con _shared/montos.ts (impuestosPorRenglon):
--   5a1b9cd9 Cervezas 20-ago: Mineral 181.90->211.00, Dr Pepper 158.62->184.00, Clamato 307 (tasa 0), Descuento -15.86->-18.40
--   e0d564fe Ana Claudia: IEPS 24.93 = 8% de los dedos de queso (311.59->336.52); aderezo y pulpa sin impuesto
--   9f59dc91 PIAYS: 50.36 no explicados por el IVA (probable IEPS): se conserva el reparto parejo.
-- Respaldo: respaldo.r039_items. La marca en gemini_raw pasa de _impuestos_repartidos (factor) a
-- _impuestos_sumados (pesos), igual que el codigo nuevo.
create table if not exists respaldo.r039_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.gemini_raw ? '_impuestos_repartidos' or (r.estado = 'confirmado' and not (r.gemini_raw ? '_revision'));

update ticket_items set monto = v.monto
from (values
  ('26c9fd5f-6ee6-43aa-8d32-6f736e4bb660'::uuid, 211.00), ('cf662315-07af-4bcd-af09-bbfdba335c70'::uuid, 184.00),
  ('c9659de3-acd0-4ba4-9123-ff970b04bf89'::uuid, 307.00), ('3161701b-9459-45fa-9c25-0e9f03b7af31'::uuid, -18.40),
  ('c4f1f973-770f-4df2-a4fe-8e9ef906d9b6'::uuid, 559.06), ('805cd2e6-5d68-4407-8a21-78a6f3e1ae97'::uuid, 336.52),
  ('61631a9f-bb4d-4350-9132-cca2dcfb6f8f'::uuid, 49.12)
) v(id, monto) where ticket_items.id = v.id;
update registros_tickets set gemini_raw = gemini_raw || '{"ieps": 24.93}'::jsonb where id = 'e0d564fe-14e8-4a90-8484-047fb0f21b83';

-- marca en pesos para los 19 de 038 (total - suma antes de impuestos, del respaldo r038)
update registros_tickets r set gemini_raw = (r.gemini_raw - '_impuestos_repartidos')
  || jsonb_build_object('_impuestos_sumados', round(r.monto - (select sum(b.monto) from respaldo.r038_items b where b.registro_ticket_id = r.id), 2))
where r.gemini_raw ? '_impuestos_repartidos';

-- Backfill: confirmados NO revisados cuyo total es exactamente 1.16 x suma de renglones (IVA 16% parejo,
-- facturas de distribuidoras leidas antes de que existiera tipo_documento). Ambas sucursales.
create temp table _iva16 on commit drop as
select r.id, r.monto as total, s.suma
from registros_tickets r
cross join lateral (select sum(i.monto) suma, bool_and(i.monto is not null) completos, count(*) n from ticket_items i where i.registro_ticket_id = r.id) s
where r.estado = 'confirmado' and not (r.gemini_raw ? '_revision') and not (r.gemini_raw ? '_impuestos_sumados')
  and s.n > 0 and s.completos and s.suma > 0 and r.monto / s.suma between 1.1595 and 1.1605;

update ticket_items i set monto = round(i.monto * p.total / p.suma, 2) from _iva16 p where i.registro_ticket_id = p.id;
update ticket_items i set monto = i.monto + d.resto
from (
  select p.id, p.total - sum(i2.monto) as resto,
         (select i3.id from ticket_items i3 where i3.registro_ticket_id = p.id order by abs(i3.monto) desc, i3.orden limit 1) as mayor
  from _iva16 p join ticket_items i2 on i2.registro_ticket_id = p.id group by p.id, p.total
) d where i.id = d.mayor and d.resto <> 0;
update registros_tickets r set gemini_raw = coalesce(r.gemini_raw, '{}'::jsonb) || jsonb_build_object('_impuestos_sumados', round(p.total - p.suma, 2))
from _iva16 p where r.id = p.id;

-- historial de precios WP (solo confirmados, con IVA): misma logica que 036
delete from precio_historial where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1';
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha, created_at)
select distinct on (r.id, i.producto_catalogo_id)
  i.producto_catalogo_id, r.sucursal_id, r.id, round(i.monto / i.cantidad, 4), r.fecha_ticket, coalesce(r.confirmado_en, r.created_at)
from ticket_items i
join registros_tickets r on r.id = i.registro_ticket_id
join catalogo_productos p on p.id = i.producto_catalogo_id
where r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and r.estado = 'confirmado'
  and i.monto > 0 and i.cantidad > 0
  and (i.unidad is null or p.unidad_default is null or i.unidad = p.unidad_default)
order by r.id, i.producto_catalogo_id, i.orden;
with m as (
  select producto_catalogo_id, percentile_cont(0.5) within group (order by precio_unitario) med, count(*) n
  from precio_historial where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' group by 1
)
delete from precio_historial h using m
where h.producto_catalogo_id = m.producto_catalogo_id and h.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1'
  and m.n >= 4 and (h.precio_unitario > m.med * 3 or h.precio_unitario < m.med / 3);
