-- 065: el papel del 7-sep dice "Bodega hojas" a mano -> Bodega (regla de Alejandro: si el ticket dice Bodega, es Bodega).
-- Claude 2026-09-19. Ticket 1bc46ca7 (Office Depot, resma de papel bond carta, $99 neto tras $10 de promocion).
-- Se mueve SOLO ese renglon, no el producto: el papel del cafe (oficina, caja) sigue siendo gasto operativo salvo que
-- el ticket diga Bodega.
-- Nota: el renglon de la promocion (-$10) se llama "Promocion 114911", no "Descuento", asi que tambien quedo en Bodega.
-- Se deja asi a proposito: Bodega cuenta los $99 netos y el descuento no le abona al cafe un gasto que no es suyo.
create table if not exists respaldo.r065_items as
  select i.id, i.categoria_id from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.id::text like '1bc46ca7%';

update ticket_items i set categoria_id = c.id
from registros_tickets r, categorias_gasto c
where r.id = i.registro_ticket_id and r.id::text like '1bc46ca7%'
  and c.nombre = 'Bodega' and c.sucursal_id = r.sucursal_id
  and i.descripcion not ilike '%descuento%' and i.descripcion not ilike '%moto%' and i.descripcion not ilike '%envio%'
  and i.categoria_id is distinct from c.id;
update registros_tickets set gemini_raw = gemini_raw || jsonb_build_object('_nota_alejandro',
  'El ticket trae "Bodega hojas" escrito a mano: el papel va a Bodega (19-sep).')
where id::text like '1bc46ca7%';
