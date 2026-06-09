-- Endurece RLS: solo admins (allowlist admin_users) acceden al backoffice.
-- Antes cualquier usuario 'authenticated' tenia acceso TOTAL cross-sucursal.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
insert into admin_users (user_id)
select id from auth.users where email = 'alepolch@gmail.com'
on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

alter table admin_users enable row level security;
drop policy if exists admin_users_select on admin_users;
create policy admin_users_select on admin_users for select to authenticated using (public.is_admin());

do $$
declare t text;
begin
  drop policy if exists "Admin full access alertas" on alertas_tickets;
  drop policy if exists "Admin full access catalogo" on catalogo_productos;
  drop policy if exists "Admin full access categorias" on categorias_gasto;
  drop policy if exists "Admin full access comercios" on comercios;
  drop policy if exists "consumo del auth" on consumo_inventario;
  drop policy if exists "consumo read auth" on consumo_inventario;
  drop policy if exists "consumo write auth" on consumo_inventario;
  drop policy if exists "Admin full access empleados" on empleados;
  drop policy if exists "Admin read empleados" on empleados;
  drop policy if exists "Admin full access objetivos" on objetivos_costo;
  drop policy if exists "precio_hist read auth" on precio_historial;
  drop policy if exists "Admin full access presupuestos" on presupuestos;
  drop policy if exists "Admin delete registros" on registros_tickets;
  drop policy if exists "Admin read registros" on registros_tickets;
  drop policy if exists "Admin update registros" on registros_tickets;
  drop policy if exists "Admin full access sucursal_empleados" on sucursal_empleados;
  drop policy if exists "Admin full access sucursales" on sucursales;
  drop policy if exists "Admin full access ticket_items" on ticket_items;
  drop policy if exists "Admin full access ventas" on ventas;

  foreach t in array array[
    'alertas_tickets','catalogo_productos','categorias_gasto','comercios','consumo_inventario',
    'empleados','objetivos_costo','precio_historial','presupuestos','registros_tickets',
    'sucursal_empleados','sucursales','ticket_items','ventas'
  ] loop
    execute format('create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', 'admin_all_'||t, t);
  end loop;
end $$;

drop policy if exists "Sucursales activas son públicas para lectura" on sucursales;
create policy "sucursales_activas_publicas" on sucursales for select using (activa = true);
