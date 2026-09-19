-- 045: pares factura + ticket de julio (WP) comparados contra la foto (revision Claude 2026-09-18).
-- 0701 y 0702: misma compra -> se rechaza la remision/ticket, cuenta solo la factura.
-- 0703 (Coca-Cola FEMSA 2 y 9-jul): dos facturas distintas del pedido semanal -> cuentan las dos.
create table if not exists respaldo.r045_tickets as
  select id, estado, es_duplicado, duplicado_de, sospechoso, sospecha_estado, sospecha_motivo, gemini_raw
  from registros_tickets where sospecha_grupo::text like '6f1c2a10-0001-4a00-9000-00000000070%';

update registros_tickets r set estado = 'rechazado', es_duplicado = true, duplicado_de = f.id,
  gemini_raw = r.gemini_raw || jsonb_build_object('_rechazo_motivo', 'Remision/ticket de la misma entrega que la factura ' || f.folio_ticket || ' (verificado contra foto: misma referencia, productos y total). Solo cuenta la factura. Revision Claude 2026-09-18.')
from registros_tickets f
where (r.id::text like '87ce5f9e%' and f.id::text like 'bc9bda1f%') or (r.id::text like 'e05ac7fc%' and f.id::text like '99a7d24c%');

update registros_tickets set sospecha_estado = 'descartada',
  sospecha_motivo = coalesce(sospecha_motivo, '') || case
    when sospecha_grupo::text like '%0703' then ' | Cerrado 2026-09-18: son dos facturas distintas (XCGC2913104 y XCGC2918154) del pedido semanal; cuentan las dos.'
    else ' | Cerrado 2026-09-18: misma compra documentada dos veces; se rechazo la remision y cuenta solo la factura.' end
where sospecha_grupo::text like '6f1c2a10-0001-4a00-9000-00000000070%';

update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket rechazado"}'::jsonb
from registros_tickets r where r.id = a.registro_ticket_id and not a.resuelta and r.estado = 'rechazado';
