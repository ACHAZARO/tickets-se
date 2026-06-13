-- Orden estable de renglones dentro de cada ticket.
-- Sin esta columna, los inserts masivos quedan con timestamps muy cercanos y
-- ordenar por UUID puede cambiar el orden visual respecto al ticket original.

alter table public.ticket_items
  add column if not exists orden integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by registro_ticket_id
      order by created_at asc, id asc
    ) - 1 as rn
  from public.ticket_items
)
update public.ticket_items ti
set orden = ranked.rn
from ranked
where ti.id = ranked.id
  and ti.orden is null;

alter table public.ticket_items
  alter column orden set default 0,
  alter column orden set not null;

create index if not exists idx_ticket_items_registro_orden
  on public.ticket_items(registro_ticket_id, orden, created_at, id);
