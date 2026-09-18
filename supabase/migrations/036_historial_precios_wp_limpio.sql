-- 036: historial de precios de Wings Palace reconstruido SOLO con tickets confirmados (respaldo en respaldo.r034_precio_historial).
-- Antes se guardaba el precio al subir cada ticket (aunque quedara pendiente y mal leido) y habia totales guardados como
-- precio unitario (gas LP a $77/L). Ahora: un precio por producto y ticket confirmado, misma unidad que el producto,
-- y se descartan valores fuera de 1/3x - 3x de la mediana del producto.
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
