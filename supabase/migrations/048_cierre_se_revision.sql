-- 048: cierre de la revision contra foto de Santa Elena (jun-sep 2026; lotes se_ago y se_resto, 508 tickets).
-- Los envios anotados a mano ("c/envio") quedaron como renglon "Moto envio" (Otros gastos operativos): Alejandro 18-sep
-- confirmo que la gerente los pago. Totales a mano enormes = suma de tickets engrapados: se dejo lo impreso. Claude 2026-09-18.
create table if not exists respaldo.r048_se_tickets as
  select id, estado, es_duplicado, duplicado_de, sospechoso, sospecha_estado, sospecha_motivo, gemini_raw
  from registros_tickets where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3';
create table if not exists respaldo.r048_se_precios as
  select * from precio_historial where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3';

-- Fotos repetidas del mismo papel: rechazadas (no son otro gasto).
update registros_tickets r set estado = 'rechazado', es_duplicado = true, duplicado_de = o.id,
  gemini_raw = r.gemini_raw || jsonb_build_object('_rechazo_motivo', v.motivo || ' Revision Claude 2026-09-18.')
from (values
  ('6eebeec7', '91e00a41', 'Foto repetida de la misma nota de Jugotropick (folio 120541, 27-ago, $210).'),
  ('65a99b31', '9c72df7b', 'Foto repetida del mismo ticket de Tipico (folio C41667, 19-ago, $1,116.60).'),
  ('e3e59de5', 'e96e57c9', 'Foto repetida de la nota 3228 de Plasticos Palacios (20-jun, $53).'),
  ('bf02ea57', 'a8c1b07a', 'Foto repetida del ticket de Chedraui del 20-jun ($557).')
) v(id8, orig8, motivo)
join registros_tickets o on o.id::text like v.orig8 || '%'
where r.id::text like v.id8 || '%' and r.estado = 'pendiente';

-- Posible alteracion (se cuenta lo que cobro el vendedor).
update registros_tickets set sospechoso = true, sospecha_origen = 'auto', sospecha_estado = 'abierta',
  sospecha_motivo = 'Jugotropick 1-jul: con otra pluma alguien encimo un 2 sobre el 1 de la cantidad y escribio $420 fuera del recuadro; la nota del vendedor dice 1 galon $210. Se cuenta $210. Revision Claude 2026-09-18.'
where id::text like '4427e70a%';

-- Unica duda de septiembre para Alejandro.
insert into alertas_tickets (registro_ticket_id, tipo, correccion)
select r.id, 'revisar_gerente', jsonb_build_object('motivo', 'Adan Melchor 17-sep: impreso $1,490.09 y a mano "y envio $1,920" (+$429.91, muy alto para un envio; dice BODEGA). Se registro solo lo impreso. Confirmar que se pago y que fue.', 'por', 'Claude (revision 2026-09-18)')
from registros_tickets r
where r.id::text like '65809be7%'
  and not exists (select 1 from alertas_tickets a where a.registro_ticket_id = r.id and a.tipo = 'revisar_gerente' and not a.resuelta);

-- Alertas de tickets rechazados: nada que revisar.
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket rechazado"}'::jsonb
from registros_tickets r where r.id = a.registro_ticket_id and not a.resuelta and r.estado = 'rechazado';

-- Historial de precios de Santa Elena reconstruido SOLO con tickets confirmados y revisados contra foto
-- (antes tenia precios de lecturas malas: gas ligado a pechuga, mantequilla a pimiento, etc.).
delete from precio_historial where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3';
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha, created_at)
select distinct on (r.id, i.producto_catalogo_id)
  i.producto_catalogo_id, r.sucursal_id, r.id, round(i.monto / i.cantidad, 4), r.fecha_ticket, coalesce(r.confirmado_en, r.created_at)
from ticket_items i
join registros_tickets r on r.id = i.registro_ticket_id
join catalogo_productos p on p.id = i.producto_catalogo_id
where r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' and r.estado = 'confirmado'
  and i.monto > 0 and i.cantidad > 0
  and (i.unidad is null or p.unidad_default is null or lower(i.unidad) = lower(p.unidad_default))
order by r.id, i.producto_catalogo_id, i.orden;
with m as (
  select producto_catalogo_id, percentile_cont(0.5) within group (order by precio_unitario) med, count(*) n
  from precio_historial where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' group by 1
)
delete from precio_historial h using m
where h.producto_catalogo_id = m.producto_catalogo_id and h.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and m.n >= 4 and (h.precio_unitario > m.med * 3 or h.precio_unitario < m.med / 3);
