-- 044: respuestas de Alejandro (18-sep) a las dudas de Wings Palace agosto + cierre de la revision de fraude de julio.
-- 1) Moto "Lindsay" = empleada que trajo insumos -> Otros gastos operativos (agosto y julio).
-- 2) Hielo $46 del 7-ago: correcto.
-- 3) Factura + ticket/remision de la misma compra: la gerente no sabia cual subir y subio ambos (no es fraude).
--    Se descartan las sospechas y se rechaza la copia que no es factura. En adelante solo sube la factura.
-- 4) Julio: Alejandro pidio que Claude decida con criterio (mes para entrenamiento y tendencia de precios).
-- Respaldos en respaldo.r044_*. Claude 2026-09-18.
create table if not exists respaldo.r044_tickets as
  select id, estado, es_duplicado, duplicado_de, sospechoso, sospecha_estado, sospecha_motivo, gemini_raw
  from registros_tickets where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and (sospechoso or id::text like any (array['c30ce45b%', '06f5a684%', '03957aa0%', '916449b3%', '4a65e834%']));
create table if not exists respaldo.r044_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.id::text like any (array['c30ce45b%', '06f5a684%', '916449b3%', '4a65e834%']);
create table if not exists respaldo.r044_alertas as
  select a.* from alertas_tickets a join registros_tickets r on r.id = a.registro_ticket_id
  where not a.resuelta and a.tipo = 'revisar_gerente' and r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and r.fecha_ticket < '2026-09-01';

-- Motos de empleados (Lindsay confirmado por Alejandro; Fer Villanueva y la de $50 sin concepto por el mismo patron:
-- moto de ~$50-85 para traer insumos) -> Otros gastos operativos, producto "Moto servicio".
update ticket_items i set categoria_id = (select id from categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null limit 1),
  producto_catalogo_id = 'e8c6c5cf-c119-41c6-bd42-f60b91c098e0', necesita_revision = false, motivo_revision = null
from registros_tickets r
where r.id = i.registro_ticket_id and r.id::text like any (array['c30ce45b%', '06f5a684%', '916449b3%', '4a65e834%'])
  and i.descripcion ilike '%moto%';

-- Copias que no son factura de las compras factura + ticket/remision de julio (grupos 0901-0904): rechazadas.
update registros_tickets r set estado = 'rechazado', es_duplicado = true, duplicado_de = f.id,
  gemini_raw = r.gemini_raw || jsonb_build_object('_rechazo_motivo', 'Ticket/remision de la misma compra que la factura ' || coalesce(f.folio_ticket, '') || ' (ya confirmada). La gerente subio ambos papeles; solo cuenta la factura. Decision Alejandro 2026-09-18.')
from registros_tickets f
where r.sospecha_grupo = f.sospecha_grupo and f.estado = 'confirmado' and f.gemini_raw->>'tipo_documento' = 'factura'
  and r.estado = 'pendiente' and r.id <> f.id
  and r.sospecha_grupo in ('6f1c2a10-0001-4a00-9000-000000000901', '6f1c2a10-0001-4a00-9000-000000000902',
                           '6f1c2a10-0001-4a00-9000-000000000903', '6f1c2a10-0001-4a00-9000-000000000904');

-- JugoKarl 16784 (27-jul) es el pago del galon de la nota 16704 (21-jul) ya confirmada: no es otro gasto.
update registros_tickets set estado = 'rechazado', es_duplicado = true,
  duplicado_de = (select id from registros_tickets where id::text like 'fee140ce%'),
  gemini_raw = gemini_raw || '{"_rechazo_motivo": "Nota 16784 dice \"se debia nota del dia 21-7\": ampara el mismo galon de la nota 16704 ya confirmada. Revision Claude 2026-09-18."}'::jsonb
where id::text like '658b6020%' and estado = 'pendiente';

-- "Gas compras Aps" $1,350 (27-jul): remision a mano sin ticket de gasera, subida dos veces. No se cuenta.
update registros_tickets set estado = 'rechazado',
  gemini_raw = gemini_raw || '{"_rechazo_motivo": "Remision a mano sin comprobante de la gasera (el gas LP siempre trae ticket impreso), subida dos veces. No se cuenta. Julio: decision Claude por encargo de Alejandro 2026-09-18."}'::jsonb
where id::text like '07918aae%' and estado = 'pendiente';

-- Se cierran las sospechas de agosto y julio (quedan documentadas en sospecha_motivo). Las alteraciones de julio
-- (moto $110, pimienta $96, lechuga con corrector) se cuentan como estan escritas: es lo que salio de caja.
update registros_tickets set sospecha_estado = 'descartada',
  sospecha_motivo = coalesce(sospecha_motivo, '') || ' | Cerrado 2026-09-18: ' ||
    case when sospecha_grupo::text like '%0906' then 'no se cuenta (remision a mano sin comprobante de gasera).'
         when sospecha_grupo is not null then 'papeles duplicados de la misma compra; solo cuenta uno.'
         else 'se cuenta como esta escrito; julio lo decide Claude por encargo de Alejandro.' end
where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and sospechoso and coalesce(sospecha_estado, 'abierta') = 'abierta'
  and fecha_ticket >= '2026-07-01' and fecha_ticket < '2026-09-01'
  and (sospecha_grupo is null or sospecha_grupo::text not like '6f1c2a10-0001-4a00-9000-00000000070%');

-- Alertas "revisar con gerente" de julio y agosto: respondidas (agosto) o decididas por Claude (julio).
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || jsonb_build_object('respuesta',
    case when r.id::text like 'c30ce45b%' then 'Alejandro: Lindsay es empleada y trajo insumos -> Otros gastos operativos.'
         when r.id::text like '03957aa0%' then 'Alejandro: $46 es correcto.'
         when r.id::text like '06f5a684%' then 'Alejandro: Lindsay es empleada y trae insumos -> Otros gastos operativos.'
         when r.id::text like any (array['916449b3%', '4a65e834%']) then 'Claude: moto de empleado para insumos (patron Lindsay) -> Otros gastos operativos.'
         when r.estado = 'rechazado' then 'Claude: rechazado (duplicado o sin comprobante).'
         else 'Claude: se deja como se leyo (julio: decide Claude por encargo de Alejandro).' end,
    'cerrada', '2026-09-18')
from registros_tickets r
where r.id = a.registro_ticket_id and not a.resuelta and a.tipo = 'revisar_gerente'
  and r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and r.fecha_ticket >= '2026-07-01' and r.fecha_ticket < '2026-09-01';

-- Los rechazados de arriba ya no requieren revision.
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket rechazado"}'::jsonb
from registros_tickets r where r.id = a.registro_ticket_id and not a.resuelta and r.estado = 'rechazado';
