-- 067: el envio de una entrega que solo traia material de Bodega tambien es Bodega (Alejandro, 19-sep).
-- Claude 2026-09-19. Si todo lo que venia en el ticket es de Bodega, el flete de esa entrega tambien lo es;
-- si el ticket mezcla cafeteria y Bodega, el envio se queda en Otros gastos operativos.
-- 1) 26 renglones "Moto envio" de Santa Elena (jun-sep), $2,158.75: Adan Melchor, El Bodegon y El Iris.
-- 2) Flete de TRANSPORTES CASTORES del 13-jul, $1,407.53 (guia TOL-734668 desde Toluca): envio de Bodega.
create table if not exists respaldo.r067_items as
  select i.id, i.categoria_id from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' or r.id::text like '5a778cf9%';

-- 1) Envios de entregas 100% de Bodega.
with l as (
  select r.id, i.id item_id, c.nombre cat,
    (coalesce(p.nombre, '') = 'Moto envío'
      or translate(lower(i.descripcion), 'í', 'i') ~ '(\menvio\M|^\s*moto\M)') es_envio
  from registros_tickets r join ticket_items i on i.registro_ticket_id = r.id
  left join categorias_gasto c on c.id = i.categoria_id
  left join catalogo_productos p on p.id = i.producto_catalogo_id
  where r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' and r.estado in ('confirmado', 'pendiente')
), solo_bodega as (
  select id from l group by id
  having count(*) filter (where not es_envio) > 0
     and count(*) filter (where not es_envio) = count(*) filter (where not es_envio and cat = 'Bodega')
)
update ticket_items i set categoria_id = c.id
from l, categorias_gasto c
where l.item_id = i.id and l.es_envio and l.id in (select id from solo_bodega)
  and c.nombre = 'Bodega' and c.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and i.categoria_id is distinct from c.id;

-- 2) Flete de paqueteria de Bodega.
update ticket_items i set categoria_id = c.id
from registros_tickets r, categorias_gasto c
where r.id = i.registro_ticket_id and r.id::text like '5a778cf9%'
  and c.nombre = 'Bodega' and c.sucursal_id = r.sucursal_id and i.categoria_id is distinct from c.id;
update registros_tickets set gemini_raw = gemini_raw || jsonb_build_object('_nota_alejandro',
  'Flete de paqueteria de Bodega (Alejandro, 19-sep).')
where id::text like '5a778cf9%';
