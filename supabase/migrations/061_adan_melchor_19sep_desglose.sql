-- 061: Adan Melchor 19-sep, las dos hojas de $1,552 (Alejandro, 19-sep). Claude 2026-09-19.
-- La gerente subio la factura 403201 y ADEMAS una hoja a mano con el desglose de esa misma compra (entendio que el
-- desglose iba aparte; ya se le aclaro que va en el mismo ticket). No es fraude ni gasto doble.
-- 1) Se queda la factura (fe7f9dc4) y se desglosa como dice la hoja: Bodega (bolsas + playo) $1,471.76 y envio $80.24.
--    El IVA de $203 se reparte proporcional entre los dos productos (el envio no paga IVA):
--    bolsas 772.20 + 123.55 = 895.75 ($203.58/kg, igual que sus compras anteriores) y playo 496.56 + 79.45 = 576.01
--    (mismo precio de siempre). Total 1,552.00 = renglones. Queda lista para confirmar desde el panel (asi la app
--    archiva la foto como debe).
-- 2) La hoja a mano (7e0ee4a6) queda RECHAZADA como copia de esa factura, y su sospecha ("nota a mano sin vendedor")
--    se cierra como descartada: ya sabemos por que estaba.
create table if not exists respaldo.r061_tickets as
  select id, estado, monto, sospechoso, sospecha_estado, sospecha_motivo, es_duplicado, duplicado_de, gemini_raw
  from registros_tickets where id::text like any (array['fe7f9dc4%', '7e0ee4a6%']);
create table if not exists respaldo.r061_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.id::text like any (array['fe7f9dc4%', '7e0ee4a6%']);

-- 1) Factura: IVA repartido en los renglones (gastos CON IVA).
update ticket_items set monto = 895.75 where id = '9b5c5e9d-b0cb-4a1a-b0d2-92da09cf9ce6' and monto = 772.20;
update ticket_items set monto = 576.01 where id = 'a9a1e0a2-6f3c-4e96-bd64-c6acf00e2a5f' and monto = 496.56;
update registros_tickets r set gemini_raw = r.gemini_raw || jsonb_build_object(
    '_impuestos_sumados', 203,
    'items', (select jsonb_agg(jsonb_build_object('descripcion', i.descripcion, 'cantidad', i.cantidad,
                'unidad', i.unidad, 'monto', i.monto, 'categoria', c.nombre) order by i.orden)
              from ticket_items i left join categorias_gasto c on c.id = i.categoria_id
              where i.registro_ticket_id = r.id),
    '_nota_alejandro', 'Desglose segun la hoja a mano de la gerente (19-sep): Bodega bolsas metalizadas + playo $1,471.76 y envio $80.24. El IVA de $203 se repartio entre los dos productos.')
where r.id::text like 'fe7f9dc4%';
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || jsonb_build_object(
    'respuesta', 'IVA de $203 repartido entre bolsas y playo; los renglones ya suman los $1,552 de la factura.',
    'cerrada', '2026-09-19')
from registros_tickets r where r.id = a.registro_ticket_id and r.id::text like 'fe7f9dc4%' and not a.resuelta;

-- 2) La hoja a mano: copia del mismo gasto, no se cuenta.
update registros_tickets h set estado = 'rechazado', es_duplicado = true,
  duplicado_de = (select id from registros_tickets where id::text like 'fe7f9dc4%'),
  sospechoso = false, sospecha_estado = 'descartada',
  sospecha_motivo = 'IA: Nota a mano sin vendedor por un monto alto | 19-sep (Alejandro): es el desglose de la factura 403201 de Adan Melchor, que la gerente subio aparte por un malentendido. No es fraude ni gasto doble.',
  gemini_raw = h.gemini_raw || jsonb_build_object('_rechazo_motivo', 'desglose de la factura 403201, no es otro gasto')
where h.id::text like '7e0ee4a6%' and h.estado = 'pendiente';
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || jsonb_build_object(
    'respuesta', 'Hoja con el desglose de la factura 403201: se rechaza, el gasto lo cuenta la factura.',
    'cerrada', '2026-09-19')
from registros_tickets r where r.id = a.registro_ticket_id and r.id::text like '7e0ee4a6%' and not a.resuelta;
