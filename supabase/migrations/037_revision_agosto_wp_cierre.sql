-- 037: cierre de la revision de agosto (Wings Palace, carga del 11-sep). Respaldos en respaldo.r034_*.
-- Aceite Ave Action: el historial es por bidon de 10 L, no por litro.
update catalogo_productos set unidad_default = 'pz' where id::text like '74ba8010%';
update ticket_items set unidad = 'pz' where producto_catalogo_id::text like '74ba8010%' and unidad = 'lt' and cantidad = 1;
update ticket_items set cantidad = 2, unidad = 'pz' where registro_ticket_id::text like '9713eae9%' and producto_catalogo_id::text like '74ba8010%' and cantidad = 20;

-- Nota de $78 sin importe por renglon: se reparte con el precio de referencia de la bolsa de hielo (nota del 24-ago).
update ticket_items set monto = 46 where registro_ticket_id::text like '05a5f504%' and descripcion = '1 Bolsa Hielo';
update ticket_items set monto = 32 where registro_ticket_id::text like '05a5f504%' and descripcion = '4 Bolsas negras';

-- Solo lo que de verdad hay que preguntar al gerente queda como 'Revisar con gerente'.
insert into alertas_tickets (registro_ticket_id, tipo, correccion)
select r.id, 'revisar_gerente', jsonb_build_object('motivo', v.motivo, 'por', 'Claude (revision 2026-09-18)')
from (values
  ('1095886d', 'La nota dice 19/02/26. Como la app existe desde junio se registro como 19/08/2026: confirmar la fecha.'),
  ('1b112f3d', 'Cabrito ($200) y papel para mixiote ($440): confirmar si fue para un platillo a la venta o comida del personal/dueno (entonces va a Extras).'),
  ('fd300835', 'El dia se lee 22 o 27 y el importe de $15 (Pure) tiene el 5 remarcado y el concepto sobrescrito: posible alteracion. Confirmar.'),
  ('11fc5f27', 'Probable duplicado: es la misma compra que la factura FXAL 298294 (13-ago, $457, mismos productos). Si fue una sola entrega, rechazar este ticket.'),
  ('a5b4e428', 'Probable duplicado: es la misma compra que la factura FXAL 299425 (20-ago, $683.60, mismos productos y cliente). Si fue una sola entrega, rechazar esta remision.')
) v(id8, motivo)
join registros_tickets r on r.id::text like v.id8 || '%'
where not exists (select 1 from alertas_tickets a where a.registro_ticket_id = r.id and a.tipo = 'revisar_gerente' and not a.resuelta);

-- Factura + ticket de la misma compra (Cervezas y Refrescos de Jalapa): a Fraude, igual que los pares de julio.
update registros_tickets set sospechoso = true, sospecha_origen = 'auto', sospecha_estado = 'abierta',
  sospecha_grupo = '6f1c2a10-0001-4a00-9000-000000000801',
  sospecha_motivo = 'Posible factura + ticket de la MISMA compra: Cervezas y Refrescos 13-ago $457 (Mineral 8/2L + Mineral 24/.355). Ticket 9501-71949 y factura FXAL 298294. Se confirmo solo la factura. Revision Claude 2026-09-18.'
where id::text like '11fc5f27%' or id::text like '3a6c7d5d%';
update registros_tickets set sospechoso = true, sospecha_origen = 'auto', sospecha_estado = 'abierta',
  sospecha_grupo = '6f1c2a10-0001-4a00-9000-000000000802',
  sospecha_motivo = 'Posible factura + remision de la MISMA compra: Cervezas y Refrescos 20-ago $683.60, mismos productos y cliente JA118652. Remision 9501-72171 y factura FXAL 299425. Se confirmo solo la factura. Revision Claude 2026-09-18.'
where id::text like 'a5b4e428%' or id::text like '5a1b9cd9%';

-- Al confirmar (confirmar-admin) se resolvieron las alertas abiertas de los 145 tickets confirmados,
-- salvo 'revisar_gerente' y 'duplicado' (ver PROJECT_STATE.md, sesion 2026-09-18).
