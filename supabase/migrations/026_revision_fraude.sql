-- 026: Revision de fraude. Marca tickets sospechosos (manual, auto o IA).
-- No son necesariamente duplicados ni pares; un grupo puede tener N tickets.
-- APLICADA en produccion por Claude via MCP (2026-06-10).
alter table public.registros_tickets
  add column if not exists sospechoso boolean not null default false,
  add column if not exists sospecha_motivo text,
  add column if not exists sospecha_origen text,                            -- 'manual' | 'auto' | 'ia'
  add column if not exists sospecha_grupo uuid,                             -- liga tickets relacionados (null = aislado)
  add column if not exists sospecha_estado text not null default 'abierta'; -- 'abierta' | 'descartada' | 'confirmada'

comment on column public.registros_tickets.sospechoso is 'Marcado para revision de fraude.';
comment on column public.registros_tickets.sospecha_grupo is 'UUID que agrupa tickets relacionados por la misma sospecha.';

create index if not exists idx_registros_sospechoso
  on public.registros_tickets (sucursal_id, sospechoso, sospecha_estado)
  where sospechoso = true;
