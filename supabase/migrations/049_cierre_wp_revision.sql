-- 049: cierre de la revision contra foto del resto de Wings Palace (mayo-julio 2026, lote wp_resto: 376 tickets,
-- incluye los 181 de la carga 13/14-jul que la IA nunca leyo). Alejandro pidio que Claude decida mayo-julio con criterio.
-- Respaldos: respaldo.r_wp_resto_* (aplicar_revision) y r049_*. Claude 2026-09-18.
create table if not exists respaldo.r049_wp_tickets as
  select id, estado, es_duplicado, duplicado_de, sospechoso, sospecha_estado, sospecha_motivo, gemini_raw
  from registros_tickets where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1';
create table if not exists respaldo.r049_wp_precios as
  select * from precio_historial where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1';
create table if not exists respaldo.r049_wp_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.id::text like any (array['e2467b93%', '3ff73dce%', 'b31638fb%', '89dd09b0%', '672a64ad%', 'a6005786%', '0bab6d67%']);

-- No son gasto: remisiones/tickets de la misma compra que una factura, la misma carga de gas en dos papeles,
-- "pendiente pago" sin pago, tickets de gas viejos reutilizados, notas sin vendedor alteradas.
update registros_tickets set estado = 'rechazado',
  gemini_raw = gemini_raw || jsonb_build_object('_rechazo_motivo', coalesce(gemini_raw->'_revision'->>'cambios', 'no es gasto') || ' Revision Claude 2026-09-18.')
where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and estado = 'pendiente'
  and gemini_raw->'_revision'->>'lote' = 'wp_resto' and gemini_raw->'_revision'->>'veredicto' = 'no_es_gasto';

-- Tercer ticket de gas de talonario viejo (folio 33861, rango 33,001-34,000 impreso en 2024; $10.29/L cuando en 2026 cuesta $10.60-10.71).
update registros_tickets set estado = 'rechazado',
  gemini_raw = gemini_raw || '{"_rechazo_motivo": "Ticket de gas Sonigas sin fecha de un talonario de 2024 (folio 33861) y con precio por litro de 2024-25 ($10.29): parece ticket viejo reutilizado. Revision Claude 2026-09-18."}'::jsonb
where id::text like '85bc0bfc%';

-- Evidencia para Fraude (quedan abiertas para consulta; no requieren accion). Grupo ...0501 = tickets de gas reutilizados.
update registros_tickets r set sospechoso = true, sospecha_origen = 'auto', sospecha_estado = 'abierta',
  sospecha_grupo = case when v.id8 in ('7fde189e', 'aed2e314', '85bc0bfc') then '6f1c2a10-0001-4a00-9000-000000000501'::uuid else r.sospecha_grupo end,
  sospecha_motivo = v.motivo || ' Revision Claude 2026-09-18.'
from (values
  ('7fde189e', 'Ticket de gas Sonigas $400 SIN fecha, de una libreta impresa en marzo 2025 (folio 38601) y con codigo FU que termina en 190625 (19-jun-2025): ticket del ano pasado reutilizado. No se cuenta.'),
  ('aed2e314', 'Ticket de gas Sonigas $400 SIN fecha, de un talonario impreso en abril 2024 (folios 33,001-34,000): ticket viejo reutilizado. No se cuenta.'),
  ('85bc0bfc', 'Ticket de gas Sonigas $400 SIN fecha, folio 33861 del talonario de 2024 y a $10.29/L (precio viejo): ticket viejo reutilizado. No se cuenta.'),
  ('63ee5694', 'Nota a mano "Caja de Te" $1,560 firmada por Fer Villanueva, sin vendedor, con un digito escrito encima de otro. Mismo firmante que la remision "Gas compras Aps" de julio. No se cuenta.'),
  ('dbe62668', 'Nota a mano sin proveedor ni fecha: caja de aceite Ave a $745 cuando se paga $490 (+$255 por caja, 2 cajas). Se cuenta como esta escrita.')
) v(id8, motivo)
where r.id::text like v.id8 || '%';

-- IEPS 8% de los dedos de queso Camfoods (la cuenta es ambigua: tambien cuadra con hamburguesa+pulpa; es la botana la que lo paga).
update ticket_items i set monto = i.monto + 24.93
from registros_tickets r
where r.id = i.registro_ticket_id and r.id::text like any (array['e2467b93%', '3ff73dce%', 'b31638fb%']) and i.descripcion ilike 'FARM RICH DEDOS DE QUESO%';
update registros_tickets set gemini_raw = gemini_raw || '{"_impuestos_sumados": 24.93, "_impuestos_nota": "IEPS 8% en dedos de queso (asignado a mano)"}'::jsonb
where id::text like any (array['e2467b93%', '3ff73dce%', 'b31638fb%']);

-- PIAYS: IVA + IEPS por litro (no es porcentaje) -> proporcional, como en 042.
create temp table _piays on commit drop as
select r.id, r.monto total, (select sum(i.monto) from ticket_items i where i.registro_ticket_id = r.id) suma
from registros_tickets r where r.id::text like any (array['89dd09b0%', '672a64ad%']);
update ticket_items i set monto = round(i.monto * p.total / p.suma, 2) from _piays p where i.registro_ticket_id = p.id;
update ticket_items i set monto = i.monto + d.resto
from (select p.id, p.total - sum(i2.monto) resto,
        (select i3.id from ticket_items i3 where i3.registro_ticket_id = p.id order by abs(i3.monto) desc, i3.orden limit 1) mayor
      from _piays p join ticket_items i2 on i2.registro_ticket_id = p.id group by p.id, p.total) d
where i.id = d.mayor and d.resto <> 0;
update registros_tickets r set gemini_raw = r.gemini_raw || jsonb_build_object('_impuestos_sumados', round(p.total - p.suma, 2),
  '_impuestos_nota', 'IVA + cargo por litro (IEPS bebidas) repartido proporcional') from _piays p where r.id = p.id;

-- Notas a mano: renglon tachado que si esta en el total ($10) y suma de la nota $2 menor que sus renglones.
insert into ticket_items (registro_ticket_id, descripcion, cantidad, unidad, monto, categoria_id, necesita_revision, orden)
select r.id, 'Renglon tachado incluido en el total de la nota', 1, 'pz', 10,
  (select id from categorias_gasto where nombre = 'Insumos Alimentos' and sucursal_id is null limit 1), false, 1
from registros_tickets r where r.id::text like 'a6005786%'
  and not exists (select 1 from ticket_items i where i.registro_ticket_id = r.id and i.descripcion like 'Renglon tachado%');
update ticket_items i set monto = i.monto - 2 from registros_tickets r
where r.id = i.registro_ticket_id and r.id::text like '0bab6d67%' and i.descripcion = 'Apios' and i.monto = 70;

update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket rechazado"}'::jsonb
from registros_tickets r where r.id = a.registro_ticket_id and not a.resuelta and r.estado = 'rechazado';

update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"cerrada_por": "Claude 2026-09-18", "nota": "ticket revisado contra foto; montos cuadrados"}'::jsonb
from registros_tickets r
where r.id = a.registro_ticket_id and not a.resuelta and r.estado = 'confirmado' and r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1'
  and a.tipo in ('precio_anomalo', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha', 'ilegible', 'ia_sin_leer', 'monto_anomalo', 'posible_duplicado')
  and r.gemini_raw ? '_revision';
update ticket_items i set necesita_revision = false
from registros_tickets r where r.id = i.registro_ticket_id and r.estado = 'confirmado' and r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1'
  and i.necesita_revision and r.gemini_raw ? '_revision';

-- Historial de precios de Wings Palace reconstruido con todo lo confirmado (ya revisado contra foto).
delete from precio_historial where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1';
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha, created_at)
select distinct on (r.id, i.producto_catalogo_id)
  i.producto_catalogo_id, r.sucursal_id, r.id, round(i.monto / i.cantidad, 4), r.fecha_ticket, coalesce(r.confirmado_en, r.created_at)
from ticket_items i
join registros_tickets r on r.id = i.registro_ticket_id
join catalogo_productos p on p.id = i.producto_catalogo_id
where r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' and r.estado = 'confirmado'
  and i.monto > 0 and i.cantidad > 0
  and (i.unidad is null or p.unidad_default is null or lower(i.unidad) = lower(p.unidad_default))
order by r.id, i.producto_catalogo_id, i.orden;
with m as (
  select producto_catalogo_id, percentile_cont(0.5) within group (order by precio_unitario) med, count(*) n
  from precio_historial where sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1' group by 1
)
delete from precio_historial h using m
where h.producto_catalogo_id = m.producto_catalogo_id and h.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1'
  and m.n >= 4 and (h.precio_unitario > m.med * 3 or h.precio_unitario < m.med / 3);
