-- Fase 6 (alertas de precio) + Fase 7 (equivalencias/inventario)
-- catalogo_productos.precio_referencia ya existe (numeric): lo usamos como precio
-- unitario de referencia (rolling). Agregamos equivalencia para inventario:
--   1 [unidad_default] contiene <contiene_cantidad> <contiene_unidad>
--   (ej. 1 cono de huevo contiene 30 huevos).
alter table catalogo_productos
  add column if not exists contiene_cantidad numeric,
  add column if not exists contiene_unidad text;

-- Historial de precios unitarios por producto (para detectar saltos y graficar).
create table if not exists precio_historial (
  id uuid primary key default gen_random_uuid(),
  producto_catalogo_id uuid references catalogo_productos(id) on delete cascade,
  sucursal_id uuid,
  registro_ticket_id uuid references registros_tickets(id) on delete set null,
  precio_unitario numeric not null,
  fecha date,
  created_at timestamptz default now()
);
create index if not exists idx_precio_hist_prod on precio_historial(producto_catalogo_id, created_at desc);

alter table precio_historial enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='precio_historial' and policyname='precio_hist read auth') then
    create policy "precio_hist read auth" on precio_historial for select to authenticated using (true);
  end if;
end $$;
