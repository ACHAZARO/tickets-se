-- 042: cierre de la 2a revision WP (carga 5/6-ago = casi todo julio, viejos del 11-sep, confirmados de agosto).
-- Respaldos: respaldo.r040_*. Claude 2026-09-18.

-- PIAYS (pulpas y jarabes): ademas del IVA traen un cargo por litro (IEPS de bebidas) que no es porcentaje;
-- no se puede asignar por renglon, se reparte proporcional (todo es Insumos; el total cuadra con el ticket).
create temp table _piays on commit drop as
select r.id, r.monto total, (select sum(i.monto) from ticket_items i where i.registro_ticket_id = r.id) suma
from registros_tickets r where r.id in ('1a8a3cee-b3a7-4d2c-9446-144624331a2b', 'aca00759-71f8-4331-808f-e66790ca7049');
update ticket_items i set monto = round(i.monto * p.total / p.suma, 2) from _piays p where i.registro_ticket_id = p.id;
update ticket_items i set monto = i.monto + d.resto
from (select p.id, p.total - sum(i2.monto) resto,
        (select i3.id from ticket_items i3 where i3.registro_ticket_id = p.id order by abs(i3.monto) desc, i3.orden limit 1) mayor
      from _piays p join ticket_items i2 on i2.registro_ticket_id = p.id group by p.id, p.total) d
where i.id = d.mayor and d.resto <> 0;
update registros_tickets r set gemini_raw = r.gemini_raw || jsonb_build_object('_impuestos_sumados', round(p.total - p.suma, 2),
  '_impuestos_nota', 'IVA + cargo por litro (IEPS bebidas) repartido proporcional') from _piays p where r.id = p.id;
update alertas_tickets set resuelta = true where tipo = 'monto_anomalo' and not resuelta
  and registro_ticket_id in ('1a8a3cee-b3a7-4d2c-9446-144624331a2b', 'aca00759-71f8-4331-808f-e66790ca7049');

-- Fumigacion sin fecha escrita: subida en la carga de julio -> 15-jul provisional (revisar con gerente).
update registros_tickets set fecha_ticket = '2026-07-15', gemini_raw = gemini_raw || '{"fecha": "2026-07-15", "_fecha_asumida": true}'::jsonb
where id::text like '3357c874%';
update alertas_tickets set resuelta = true where tipo = 'sin_fecha' and not resuelta
  and registro_ticket_id = (select id from registros_tickets where id::text like '3357c874%');

-- Copias del mismo documento: se rechazan (no son otro gasto).
update registros_tickets set estado = 'rechazado', es_duplicado = true,
  duplicado_de = (select id from registros_tickets where id::text like v.orig || '%'),
  gemini_raw = gemini_raw || jsonb_build_object('_rechazo_motivo', v.motivo)
from (values
  ('ee4491c6', '07918aae', 'Foto repetida de la misma remision de "gas compras" $1,350 (27-jul). Revision Claude 2026-09-18.'),
  ('af6a8763', 'ebb49822', 'Reimpresion (15:56) del mismo ticket Nutrioli #2026072512373723013 $765 ya subido (12:37). Revision Claude 2026-09-18.'),
  ('38aaf437', 'fae3bff4', 'Voucher de tarjeta del mismo CFDI 299894 (pintura Comex $2,422.39) ya capturado. Revision Claude 2026-09-18.')
) v(id8, orig, motivo)
where registros_tickets.id::text like v.id8 || '%';

-- Fraude: factura + ticket/remision de la misma compra, reimpresiones y documentos sospechosos.
update registros_tickets set sospechoso = true, sospecha_origen = 'auto', sospecha_estado = 'abierta',
  sospecha_grupo = v.grupo::uuid, sospecha_motivo = v.motivo || ' Revision Claude 2026-09-18.'
from (values
  ('8d1240cc', '6f1c2a10-0001-4a00-9000-000000000901', 'Remision + factura de la MISMA compra: Cervezas y Refrescos 7/8-jul $3,539.45 (factura FXALCER2189204). Se confirmo solo la factura.'),
  ('2deb711b', '6f1c2a10-0001-4a00-9000-000000000901', 'Remision + factura de la MISMA compra: Cervezas y Refrescos 7/8-jul $3,539.45 (factura FXALCER2189204). Se confirmo solo la factura.'),
  ('d7ddf0cd', '6f1c2a10-0001-4a00-9000-000000000902', 'Remision + factura de la MISMA compra: Cervezas y Refrescos 9/10-jul $457 (factura FXAL 292410, ref 9501-16212). Se confirmo solo la factura.'),
  ('ac71b45d', '6f1c2a10-0001-4a00-9000-000000000902', 'Remision + factura de la MISMA compra: Cervezas y Refrescos 9/10-jul $457 (factura FXAL 292410, ref 9501-16212). Se confirmo solo la factura.'),
  ('cf3c1566', '6f1c2a10-0001-4a00-9000-000000000903', 'Ticket + factura de la MISMA compra: Cervezas y Refrescos 16-jul $395 (factura 293547). Se confirmo solo la factura.'),
  ('3e4ea1c7', '6f1c2a10-0001-4a00-9000-000000000903', 'Ticket + factura de la MISMA compra: Cervezas y Refrescos 16-jul $395 (factura 293547). Se confirmo solo la factura.'),
  ('17ee27b6', '6f1c2a10-0001-4a00-9000-000000000904', 'Ticket + factura de la MISMA compra: Cervezas y Refrescos 23-jul $518 (factura FXAL 294781). Se confirmo solo la factura.'),
  ('0a9071f1', '6f1c2a10-0001-4a00-9000-000000000904', 'Ticket + factura de la MISMA compra: Cervezas y Refrescos 23-jul $518 (factura FXAL 294781). Se confirmo solo la factura.'),
  ('ebb49822', '6f1c2a10-0001-4a00-9000-000000000905', 'El mismo ticket Nutrioli $765 (25-jul) se subio dos veces: original 12:37 y reimpresion 15:56 (rechazada).'),
  ('af6a8763', '6f1c2a10-0001-4a00-9000-000000000905', 'El mismo ticket Nutrioli $765 (25-jul) se subio dos veces: original 12:37 y reimpresion 15:56 (rechazada).'),
  ('07918aae', '6f1c2a10-0001-4a00-9000-000000000906', 'Remision a mano "Gas compras Aps" $1,350 firmada por Fer Villanueva, sin ticket de gasera (el gas LP siempre llega con ticket impreso ~$500) y subida DOS veces (copia rechazada). No se cuenta hasta que el gerente lo explique.'),
  ('ee4491c6', '6f1c2a10-0001-4a00-9000-000000000906', 'Remision a mano "Gas compras Aps" $1,350 firmada por Fer Villanueva, sin ticket de gasera y subida DOS veces (esta es la copia rechazada).'),
  ('658b6020', '6f1c2a10-0001-4a00-9000-000000000907', 'JugoKarl folio 16784 (27-jul, $260) dice "se debia nota del dia 21-7": ampara el galon de la nota 16704 (21-jul, $260). Posible doble cobro; se confirmo solo la del 21-jul.'),
  ('fee140ce', '6f1c2a10-0001-4a00-9000-000000000907', 'JugoKarl folio 16784 (27-jul, $260) dice "se debia nota del dia 21-7": ampara el galon de la nota 16704 (21-jul, $260). Posible doble cobro; se confirmo solo la del 21-jul.'),
  ('cbb10061', null, 'Moto servicio $110 (lo normal $50) con el total del recuadro tachado y el 110 escrito fuera de la columna: posible alteracion.'),
  ('32feb23d', null, 'Pimienta: un 9 escrito encima de un 4 ($46 -> $96); el total $462 cuadra con 96: posible alteracion (+$50).'),
  ('d88af3f5', null, 'Parches de corrector con numeros reescritos sobre cantidad e importe de lechuga y sobre el total ($118): posible alteracion.')
) v(id8, grupo, motivo)
where registros_tickets.id::text like v.id8 || '%';

-- Revisar con gerente (se confirman salvo los duplicados y el "gas compras", que no se cuentan hasta aclararse).
insert into alertas_tickets (registro_ticket_id, tipo, correccion)
select r.id, 'revisar_gerente', jsonb_build_object('motivo', v.motivo, 'por', 'Claude (revision 2026-09-18)')
from (values
  ('07918aae', 'Remision "Gas compras Aps" $1,350 sin ticket de gasera, firmada por Fer Villanueva y subida dos veces. Confirmar que se compro y con que comprobante.'),
  ('8d1240cc', 'Es la remision de entrega de la factura FXALCER2189204 ($3,539.45) ya confirmada. Si fue una sola entrega, rechazar.'),
  ('d7ddf0cd', 'Es la remision de la factura FXAL 292410 ($457) ya confirmada. Si fue una sola entrega, rechazar.'),
  ('cf3c1566', 'Es el ticket de la factura 293547 ($395) ya confirmada. Si fue una sola entrega, rechazar.'),
  ('17ee27b6', 'Es el ticket de la factura FXAL 294781 ($518) ya confirmada. Si fue una sola entrega, rechazar.'),
  ('658b6020', 'JugoKarl 16784 dice "se debia nota del 21-7": si es el pago del galon de la nota 16704 ya confirmada, rechazar esta.'),
  ('cbb10061', 'Moto $110 (normal $50) con el total tachado y reescrito fuera de la columna. Confirmar el monto real.'),
  ('32feb23d', 'Pimienta $96 escrita encima de $46 (+$50). Confirmar cuanto costaron los 400 g.'),
  ('d88af3f5', 'Corrector con numeros reescritos en lechuga (cantidad e importe) y en el total $118. Confirmar la nota.'),
  ('645f5160', 'Ultimo digito del total ($544) y el 268 de caja crema reescritos. Confirmar.'),
  ('03957aa0', 'Cantidad y fecha encimadas en la nota de hielo $46. Confirmar cuantas bolsas y el dia.'),
  ('42c86bf5', 'Letra muy dificil: primer renglon ("2 ... Manchego" $50) y "Jugos" (4 por $480) no son seguros. Confirmar que se compro.'),
  ('06f5a684', 'Moto servicio con nombre "Lindsay" ($85): se puso en Extras. Si fue para traer insumos, pasarla a Otros gastos operativos.'),
  ('c30ce45b', 'Moto con nombre "Lindsay" ($60): se puso en Extras. Si fue para traer insumos, pasarla a Otros gastos operativos.'),
  ('4a65e834', 'Moto "Fer Villanueva" ($60): se puso en Extras. Si fue el motorista de insumos, pasarla a Otros gastos operativos.'),
  ('916449b3', 'Moto sin concepto ($50): se puso en Extras. Confirmar si fue para insumos.'),
  ('ea0471d3', 'La nota dice 9/8/26, posterior a la subida (5-ago): se registro como 9-jul. Confirmar la fecha.'),
  ('a9a67cfd', 'La nota dice 16/06/2026 pero venia con papeles del 15-16 de julio. Confirmar si es 16-jul.'),
  ('3357c874', 'Fumigacion sin fecha escrita: se registro como 15-jul (subida en la carga de julio). Hay otra fumigacion de $675 el 9-ago; confirmar la fecha.')
) v(id8, motivo)
join registros_tickets r on r.id::text like v.id8 || '%'
where not exists (select 1 from alertas_tickets a where a.registro_ticket_id = r.id and a.tipo = 'revisar_gerente' and not a.resuelta);
