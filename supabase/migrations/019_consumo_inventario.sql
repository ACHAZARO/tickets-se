-- Inventario: movimientos de consumo manual (descuento de stock).
-- disponible = comprado (unidades base, via equivalencias) - consumido.
create table if not exists consumo_inventario (
  id uuid primary key default gen_random_uuid(),
  producto_catalogo_id uuid references catalogo_productos(id) on delete cascade,
  sucursal_id uuid,
  cantidad_base numeric not null,
  nota text,
  fecha date default current_date,
  created_at timestamptz default now()
);
create index if not exists idx_consumo_prod on consumo_inventario(producto_catalogo_id);

alter table consumo_inventario enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='consumo_inventario' and policyname='consumo read auth') then
    create policy "consumo read auth" on consumo_inventario for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='consumo_inventario' and policyname='consumo write auth') then
    create policy "consumo write auth" on consumo_inventario for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='consumo_inventario' and policyname='consumo del auth') then
    create policy "consumo del auth" on consumo_inventario for delete to authenticated using (true);
  end if;
end $$;
