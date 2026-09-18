-- 038: gastos CON IVA (decision Alejandro 2026-09-18: "mas facil de cotejar contra el ticket").
-- Las facturas imprimen los renglones antes de IVA/IEPS; se reparte la diferencia proporcionalmente
-- (descuentos incluidos) para que los renglones sumen el total pagado. Misma regla que _shared/montos.ts:
-- es impuesto si la suma de renglones = subtotal impreso, o la diferencia = IVA leido, o es factura y la
-- diferencia es <= 17%. Solo tickets revisados contra la foto (gemini_raw._revision); los viejos de
-- junio/julio se cuadran cuando se revisen. Respaldo: respaldo.r038_items.
create table if not exists respaldo.r038_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id where r.gemini_raw ? '_revision';

create temp table _reparto on commit drop as
select r.id, r.monto as total, s.suma, r.monto / s.suma as factor
from registros_tickets r
cross join lateral (select sum(i.monto) as suma, bool_and(i.monto is not null) as completos from ticket_items i where i.registro_ticket_id = r.id) s
where r.gemini_raw ? '_revision' and r.monto > 0 and s.completos and s.suma > 0 and r.monto - s.suma > 0.5
  and (
    (nullif(r.gemini_raw->>'subtotal', '')::numeric > 0 and abs(nullif(r.gemini_raw->>'subtotal', '')::numeric - s.suma) <= greatest(1, nullif(r.gemini_raw->>'subtotal', '')::numeric * 0.01))
    or (nullif(r.gemini_raw->>'iva', '')::numeric > 0 and abs((r.monto - s.suma) - nullif(r.gemini_raw->>'iva', '')::numeric) <= greatest(1, nullif(r.gemini_raw->>'iva', '')::numeric * 0.03))
    or (r.gemini_raw->>'tipo_documento' = 'factura' and (r.monto - s.suma) / s.suma <= 0.17)
  );

update ticket_items i set monto = round(i.monto * p.factor, 2) from _reparto p where i.registro_ticket_id = p.id;

-- el centavo de redondeo va al renglon de mayor importe
update ticket_items i set monto = i.monto + d.resto
from (
  select p.id, p.total - sum(i2.monto) as resto,
         (select i3.id from ticket_items i3 where i3.registro_ticket_id = p.id order by abs(i3.monto) desc, i3.orden limit 1) as mayor
  from _reparto p join ticket_items i2 on i2.registro_ticket_id = p.id group by p.id, p.total
) d
where i.id = d.mayor and d.resto <> 0;

update registros_tickets r set gemini_raw = r.gemini_raw || jsonb_build_object('_impuestos_repartidos', round(p.factor - 1, 4))
from _reparto p where r.id = p.id;

-- historial de precios WP otra vez solo con confirmados (ahora con IVA): misma logica que 036
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
