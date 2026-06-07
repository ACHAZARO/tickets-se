-- Backfill: renglones confirmados con categoria pero sin producto (limbo) -> crea el
-- producto en el catalogo de su sucursal y liga el renglon. Resuelve casos como "hielo"
-- que se categorizaron desde Tickets/Editar (que antes NO creaba el producto).
-- (El fix de codigo en tickets/page.tsx evita que se vuelvan a generar limbos.)
with distintos as (
  select distinct on (lower(trim(ti.descripcion)), r.sucursal_id)
    trim(ti.descripcion) as nombre, ti.categoria_id, ti.unidad, r.sucursal_id
  from ticket_items ti
  join registros_tickets r on r.id = ti.registro_ticket_id
  where ti.categoria_id is not null and ti.producto_catalogo_id is null
    and r.estado = 'confirmado' and coalesce(trim(ti.descripcion), '') <> ''
)
insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select d.nombre, '{}', d.categoria_id, d.unidad, d.sucursal_id
from distintos d
where not exists (
  select 1 from catalogo_productos cp
  where lower(cp.nombre) = lower(d.nombre)
    and (cp.sucursal_id is null or cp.sucursal_id = d.sucursal_id)
);

update ticket_items ti
set producto_catalogo_id = cp.id
from registros_tickets r, catalogo_productos cp
where ti.registro_ticket_id = r.id
  and ti.categoria_id is not null and ti.producto_catalogo_id is null
  and lower(cp.nombre) = lower(trim(ti.descripcion))
  and (cp.sucursal_id is null or cp.sucursal_id = r.sucursal_id);
