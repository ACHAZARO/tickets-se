-- 101_aislamiento_por_cuenta.sql (2026-10-24, Claude; PLAN_BETA_AMIGOS.md)
-- Cada negocio (cuenta) ve y cambia SOLO lo suyo. Antes todo era is_admin() = "esta en admin_users": un admin veia y
-- cambiaba TODOS los negocios (fotos incluidas). Antes de que entre el negocio de otra persona hay que separarlo.
--
-- Modelo:
--   admin_users            = super admin de la plataforma (Alejandro). Puede entrar a cualquier cuenta, UNA a la vez.
--   cuenta_usuarios        = quien administra cada negocio (dueno).
--   usuario_cuenta_activa  = la cuenta que cada usuario esta viendo. El panel siempre trabaja sobre UNA cuenta:
--                            "Todas las sucursales" nunca mezcla negocios.
--   mi_cuenta()            = la cuenta activa del usuario (validada). mis_sucursales() = las sucursales de esa cuenta.
--   is_admin()             = "tiene una cuenta activa" (puerta general). El permiso fino (que el producto, el renglon o la
--                            sucursal sean de SU cuenta) lo revisa cada funcion.
-- Categorias y objetivos "generales" (sucursal_id NULL) pasan a ser de UNA cuenta (cuenta_id).

-- 1. Tablas nuevas y columnas -------------------------------------------------------------------------------------------
create table if not exists public.cuenta_usuarios (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null default 'dueno' check (rol in ('dueno', 'admin')),
  created_at timestamptz not null default now(),
  primary key (cuenta_id, user_id)
);
create index if not exists cuenta_usuarios_user_idx on public.cuenta_usuarios (user_id);
alter table public.cuenta_usuarios enable row level security;

create table if not exists public.usuario_cuenta_activa (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.usuario_cuenta_activa enable row level security;

alter table public.cuentas
  add column if not exists estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  add column if not exists es_prueba boolean not null default false,
  add column if not exists limite_tickets_mes integer check (limite_tickets_mes is null or limite_tickets_mes >= 0),
  add column if not exists creada_por uuid references auth.users(id) on delete set null;
update public.cuentas set es_prueba = true where id = '1495f32b-9c38-4d10-938e-4cede062fab7'; -- PRUEBA ENTRENAMIENTO

-- 2. Funciones de permiso ------------------------------------------------------------------------------------------------
create or replace function public.es_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

-- Cuenta activa: la elegida (si puede verla), si no su primera cuenta; el super admin, la mas antigua.
-- Una cuenta suspendida no la abre nadie salvo el super admin.
create or replace function public.mi_cuenta() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.cuenta_id from public.usuario_cuenta_activa a join public.cuentas c on c.id = a.cuenta_id
      where a.user_id = auth.uid()
        and (exists (select 1 from public.admin_users s where s.user_id = auth.uid())
             or (c.estado = 'activa' and exists (select 1 from public.cuenta_usuarios m
                                                  where m.user_id = auth.uid() and m.cuenta_id = a.cuenta_id)))),
    (select m.cuenta_id from public.cuenta_usuarios m join public.cuentas c on c.id = m.cuenta_id
      where m.user_id = auth.uid() and c.estado = 'activa' order by m.created_at, m.cuenta_id limit 1),
    (select c.id from public.cuentas c where exists (select 1 from public.admin_users s where s.user_id = auth.uid())
      order by c.created_at, c.id limit 1)
  )
$$;

create or replace function public.mis_sucursales() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id from public.sucursales s where s.cuenta_id = public.mi_cuenta()
$$;

create or replace function public.puede_sucursal(p_sucursal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_sucursal is not null
     and exists (select 1 from public.sucursales s where s.id = p_sucursal and s.cuenta_id = public.mi_cuenta())
$$;

-- Puerta general: tiene una cuenta activa (dueno de un negocio o super admin).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_cuenta() is not null
$$;

-- Para las edge functions (corren como service_role, sin auth.uid()): puede ese usuario ver esa sucursal (cualquier
-- cuenta suya, no solo la activa).
create or replace function public.usuario_puede_sucursal(p_user uuid, p_sucursal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = p_user)
      or exists (select 1 from public.sucursales s
                   join public.cuenta_usuarios m on m.cuenta_id = s.cuenta_id
                   join public.cuentas c on c.id = s.cuenta_id
                  where s.id = p_sucursal and m.user_id = p_user and c.estado = 'activa')
$$;

-- Lista para el selector de negocio (super admin: todas; dueno: las suyas).
create or replace function public.mis_cuentas_lista()
returns table (id uuid, nombre text, es_prueba boolean, estado text, activa boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre, c.es_prueba, c.estado, c.id = public.mi_cuenta()
    from public.cuentas c
   where public.es_superadmin()
      or (c.estado = 'activa' and exists (select 1 from public.cuenta_usuarios m where m.user_id = auth.uid() and m.cuenta_id = c.id))
   order by c.es_prueba, c.created_at
$$;

create or replace function public.elegir_cuenta(p_cuenta uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'no autorizado'; end if;
  if not (public.es_superadmin() or exists (
      select 1 from public.cuenta_usuarios m join public.cuentas c on c.id = m.cuenta_id
       where m.user_id = auth.uid() and m.cuenta_id = p_cuenta and c.estado = 'activa')) then
    raise exception 'no autorizado';
  end if;
  insert into public.usuario_cuenta_activa (user_id, cuenta_id, updated_at) values (auth.uid(), p_cuenta, now())
  on conflict (user_id) do update set cuenta_id = excluded.cuenta_id, updated_at = now();
end
$$;

-- La pagina del gerente (sin sesion) busca SOLO su sucursal por el enlace; ya no puede listar las de todos.
create or replace function public.sucursal_publica(p_slug text)
returns table (id uuid, nombre text, slug text)
language sql stable security definer set search_path = public as $$
  select s.id, s.nombre, s.slug from public.sucursales s join public.cuentas c on c.id = s.cuenta_id
   where s.slug = p_slug and s.activa and c.estado = 'activa'
$$;

-- 3. Datos: cuenta de cada categoria, objetivo y empleado ----------------------------------------------------------------
-- Alejandro (super admin) tambien es dueno de su cuenta principal: asi su cuenta por defecto es la suya.
insert into public.cuenta_usuarios (cuenta_id, user_id, rol)
select 'c559a659-c170-4b04-8574-b7aac622f68c', user_id, 'dueno' from public.admin_users
on conflict do nothing;

alter table public.categorias_gasto add column if not exists cuenta_id uuid references public.cuentas(id) on delete cascade;
update public.categorias_gasto c set cuenta_id = s.cuenta_id from public.sucursales s where s.id = c.sucursal_id and c.cuenta_id is null;
-- Las 8 generales eran de la cuenta principal (la unica que existia).
update public.categorias_gasto set cuenta_id = 'c559a659-c170-4b04-8574-b7aac622f68c' where cuenta_id is null;

drop index if exists public.idx_categoria_nombre_suc;
create unique index idx_categoria_nombre_cuenta_suc on public.categorias_gasto
  (cuenta_id, lower(nombre), coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.categorias_gasto alter column cuenta_id set not null;

alter table public.objetivos_costo add column if not exists cuenta_id uuid references public.cuentas(id) on delete cascade;
update public.objetivos_costo o set cuenta_id = coalesce((select s.cuenta_id from public.sucursales s where s.id = o.sucursal_id),
                                                         (select g.cuenta_id from public.categorias_gasto g where g.id = o.categoria_id))
 where o.cuenta_id is null;
alter table public.objetivos_costo alter column cuenta_id set not null;

alter table public.empleados add column if not exists cuenta_id uuid references public.cuentas(id) on delete cascade;
update public.empleados e set cuenta_id = (select s.cuenta_id from public.sucursal_empleados se join public.sucursales s on s.id = se.sucursal_id
                                            where se.empleado_id = e.id order by se.created_at limit 1)
 where e.cuenta_id is null;
alter table public.empleados alter column cuenta_id set default public.mi_cuenta();
alter table public.empleados alter column cuenta_id set not null;

alter table public.sucursales alter column cuenta_id set default public.mi_cuenta();
alter table public.sucursales alter column cuenta_id set not null;

-- Categorias y objetivos: la cuenta sale de la sucursal; si son de toda la cuenta, de la cuenta activa.
create or replace function public.tg_cuenta_de_sucursal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sucursal_id is not null then
    new.cuenta_id := (select s.cuenta_id from public.sucursales s where s.id = new.sucursal_id);
  elsif new.cuenta_id is null then
    new.cuenta_id := public.mi_cuenta();
  end if;
  return new;
end
$$;
drop trigger if exists categorias_cuenta on public.categorias_gasto;
create trigger categorias_cuenta before insert or update of sucursal_id, cuenta_id on public.categorias_gasto
  for each row execute function public.tg_cuenta_de_sucursal();
drop trigger if exists objetivos_cuenta on public.objetivos_costo;
create trigger objetivos_cuenta before insert or update of sucursal_id, cuenta_id on public.objetivos_costo
  for each row execute function public.tg_cuenta_de_sucursal();

-- Para que las fotos se busquen rapido por ruta (politicas de storage).
create index if not exists idx_tickets_path_original on public.registros_tickets (storage_path_original);
create index if not exists idx_tickets_path_archivo on public.registros_tickets (storage_path_archivo);
create index if not exists idx_categorias_cuenta on public.categorias_gasto (cuenta_id);
create index if not exists idx_empleados_cuenta on public.empleados (cuenta_id);
create index if not exists idx_sucursales_cuenta on public.sucursales (cuenta_id);

-- 4. Politicas (RLS) por cuenta -------------------------------------------------------------------------------------------
-- Se quitan las de "cualquier admin ve todo" y se ponen las de la cuenta activa.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
            and policyname in ('admin_all_alertas_tickets', 'admin_all_catalogo_productos', 'admin_all_categorias_gasto',
              'admin_all_comercios', 'admin_all_consumo_inventario', 'admin_all_conteos_inventario', 'admin_all_cuenta_opciones',
              'admin_read_cuentas', 'admin_all_empleados', 'admin_all_formas_pago', 'admin_all_insumos', 'admin_all_objetivos_costo',
              'admin_read_plantillas_categorias', 'admin_all_precio_historial', 'admin_all_precios_revisados', 'admin_all_presupuestos',
              'admin_all_registros_tickets', 'admin_all_reglas_ia', 'revisor_ia_pruebas_admin_read', 'admin_all_sucursal_empleados',
              'admin_all_sucursales', 'sucursales_activas_publicas', 'admin_all_ticket_items', 'admin_all_ticket_pagos',
              'admin_all_unificaciones_descartadas', 'admin_all_ventas', 'admin_users_select',
              'tmp_bake_insert_admin', 'tmp_carga_insert_admin', 'tmp_firmas_insert_admin', 'tmp_firmas_update_admin')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Tickets y todo lo que cuelga de un ticket
create policy cuenta_registros_tickets on public.registros_tickets for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_ticket_items on public.ticket_items for all to authenticated
  using (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())))
  with check (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())));
create policy cuenta_alertas_tickets on public.alertas_tickets for all to authenticated
  using (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())))
  with check (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())));
create policy cuenta_ticket_pagos on public.ticket_pagos for all to authenticated
  using (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())))
  with check (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())));
create policy cuenta_revisor_ia_pruebas on public.revisor_ia_pruebas for select to authenticated
  using (registro_ticket_id in (select r.id from public.registros_tickets r where r.sucursal_id in (select public.mis_sucursales())));
create policy cuenta_precios_revisados on public.precios_revisados for all to authenticated
  using (item_ultimo in (select i.id from public.ticket_items i join public.registros_tickets r on r.id = i.registro_ticket_id
                          where r.sucursal_id in (select public.mis_sucursales())))
  with check (item_ultimo in (select i.id from public.ticket_items i join public.registros_tickets r on r.id = i.registro_ticket_id
                               where r.sucursal_id in (select public.mis_sucursales())));

-- Tablas por sucursal
create policy cuenta_catalogo_productos on public.catalogo_productos for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_comercios on public.comercios for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_consumo_inventario on public.consumo_inventario for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_conteos_inventario on public.conteos_inventario for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_insumos on public.insumos for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_precio_historial on public.precio_historial for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_presupuestos on public.presupuestos for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_ventas on public.ventas for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_sucursal_empleados on public.sucursal_empleados for all to authenticated
  using (sucursal_id in (select public.mis_sucursales())) with check (sucursal_id in (select public.mis_sucursales()));
create policy cuenta_unificaciones_descartadas on public.unificaciones_descartadas for all to authenticated
  using (producto_a in (select p.id from public.catalogo_productos p where p.sucursal_id in (select public.mis_sucursales())))
  with check (producto_a in (select p.id from public.catalogo_productos p where p.sucursal_id in (select public.mis_sucursales())));

-- Tablas por cuenta
create policy cuenta_categorias_gasto on public.categorias_gasto for all to authenticated
  using (cuenta_id = (select public.mi_cuenta()))
  with check (cuenta_id = (select public.mi_cuenta()) and (sucursal_id is null or sucursal_id in (select public.mis_sucursales())));
create policy cuenta_objetivos_costo on public.objetivos_costo for all to authenticated
  using (cuenta_id = (select public.mi_cuenta()))
  with check (cuenta_id = (select public.mi_cuenta()) and (sucursal_id is null or sucursal_id in (select public.mis_sucursales())));
create policy cuenta_empleados on public.empleados for all to authenticated
  using (cuenta_id = (select public.mi_cuenta())) with check (cuenta_id = (select public.mi_cuenta()));
create policy cuenta_formas_pago on public.formas_pago for all to authenticated
  using (cuenta_id = (select public.mi_cuenta())) with check (cuenta_id = (select public.mi_cuenta()));
create policy cuenta_cuenta_opciones on public.cuenta_opciones for all to authenticated
  using (cuenta_id = (select public.mi_cuenta())) with check (cuenta_id = (select public.mi_cuenta()));
create policy cuenta_reglas_ia on public.reglas_ia for all to authenticated
  using (cuenta_id = (select public.mi_cuenta()))
  with check (cuenta_id = (select public.mi_cuenta()) and (sucursal_id is null or sucursal_id in (select public.mis_sucursales())));
create policy cuenta_sucursales on public.sucursales for all to authenticated
  using (cuenta_id = (select public.mi_cuenta())) with check (cuenta_id = (select public.mi_cuenta()));
-- Pagina publica del gerente (sin sesion): igual que antes mientras se publica la pantalla nueva (que usa
-- sucursal_publica); SOLO para anon, para que un dueno con sesion no vea las sucursales de otros negocios.
create policy sucursales_activas_publicas on public.sucursales for select to anon using (activa = true);
create policy cuenta_cuentas on public.cuentas for select to authenticated using (id = (select public.mi_cuenta()));
create policy cuenta_usuarios_propios on public.cuenta_usuarios for select to authenticated
  using (user_id = auth.uid() or public.es_superadmin());
create policy cuenta_activa_propia on public.usuario_cuenta_activa for select to authenticated using (user_id = auth.uid());
create policy plantillas_lectura on public.plantillas_categorias for select to authenticated using (true);

-- Solo la plataforma
create policy admin_users_select on public.admin_users for select to authenticated using (public.es_superadmin());
create policy tmp_bake_insert_admin on public._tmp_bake for insert to authenticated with check (public.es_superadmin());
create policy tmp_carga_insert_admin on public._tmp_carga for insert to authenticated with check (public.es_superadmin());
create policy tmp_firmas_insert_admin on public._tmp_firmas for insert to authenticated with check (public.es_superadmin());
create policy tmp_firmas_update_admin on public._tmp_firmas for update to authenticated
  using (public.es_superadmin()) with check (public.es_superadmin());

-- Fotos: solo las de tickets de mis sucursales.
drop policy if exists admin_select_fotos on storage.objects;
drop policy if exists admin_delete_fotos on storage.objects;
create policy admin_select_fotos on storage.objects for select to authenticated
  using (bucket_id in ('por-revisar', 'archivo') and exists (
    select 1 from public.registros_tickets r
     where r.sucursal_id in (select public.mis_sucursales())
       and ((objects.bucket_id = 'por-revisar' and r.storage_path_original = objects.name)
         or (objects.bucket_id = 'archivo' and r.storage_path_archivo = objects.name))));
create policy admin_delete_fotos on storage.objects for delete to authenticated
  using (bucket_id in ('por-revisar', 'archivo') and exists (
    select 1 from public.registros_tickets r
     where r.sucursal_id in (select public.mis_sucursales())
       and ((objects.bucket_id = 'por-revisar' and r.storage_path_original = objects.name)
         or (objects.bucket_id = 'archivo' and r.storage_path_archivo = objects.name))));

-- 5. PIN de gerente: una cuenta suspendida ya no deja entrar.
create or replace function public.verificar_pin(p_slug text, p_pin text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_sucursal_id  uuid;
  v_empleado_id  uuid;
begin
  select s.id into v_sucursal_id
  from public.sucursales s join public.cuentas c on c.id = s.cuenta_id
  where s.slug = p_slug and s.activa = true and c.estado = 'activa'
  limit 1;

  if v_sucursal_id is null then
    return null;
  end if;

  select e.id into v_empleado_id
  from public.empleados e
  join public.sucursal_empleados se on se.empleado_id = e.id
  where se.sucursal_id = v_sucursal_id
    and se.activo = true
    and e.activo = true
    and e.pin_hash = crypt(p_pin, e.pin_hash)
  limit 1;

  return v_empleado_id;
end;
$function$;

-- 6. Funciones SECURITY DEFINER con candado por cuenta (generadas desde la version en produccion) ------------------------
-- 6. Funciones SECURITY DEFINER con candado por cuenta.
-- Se toma la definicion vigente y se le agregan SOLO los candados (cada texto debe estar exactamente una vez).
create or replace function pg_temp.parchar(p_firma text, p_viejo text, p_nuevo text) returns void language plpgsql as $f$
declare d text; n int;
begin
  d := pg_get_functiondef(p_firma::regprocedure);
  n := (length(d) - length(replace(d, p_viejo, ''))) / length(p_viejo);
  if n <> 1 then raise exception '101: en % el texto aparece % veces: %', p_firma, n, left(p_viejo, 80); end if;
  execute replace(d, p_viejo, p_nuevo);
end $f$;

-- admin_agrupar_insumo
select pg_temp.parchar('public.admin_agrupar_insumo(uuid[], text, text, jsonb)',
  '  v_suc := v_sucs[1];
',
  '  v_suc := v_sucs[1];
  -- 101: solo productos de la cuenta activa.
  IF NOT public.puede_sucursal(v_suc) THEN RAISE EXCEPTION ''no autorizado''; END IF;
');
-- admin_descartar_unificacion
select pg_temp.parchar('public.admin_descartar_unificacion(uuid, uuid)',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
  -- 101: los dos productos deben ser de la cuenta activa.
  IF (SELECT count(*) FROM public.catalogo_productos WHERE id IN (p_a, p_b) AND sucursal_id IN (SELECT public.mis_sucursales())) < 2 THEN
    RAISE EXCEPTION ''no autorizado'';
  END IF;
');
-- admin_guardar_empleado
select pg_temp.parchar('public.admin_guardar_empleado(uuid, text, text, boolean, uuid)',
  '  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
',
  '  -- 101: la sucursal y el empleado deben ser de la cuenta activa (empleados.cuenta_id lo pone su DEFAULT).
  IF p_sucursal_id IS NOT NULL AND NOT public.puede_sucursal(p_sucursal_id) THEN RAISE EXCEPTION ''no autorizado''; END IF;
  IF p_id IS NULL AND p_sucursal_id IS NULL THEN RAISE EXCEPTION ''falta la sucursal del empleado''; END IF;
  IF p_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.empleados WHERE id = p_id AND cuenta_id = public.mi_cuenta()) THEN RAISE EXCEPTION ''no autorizado''; END IF;

  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
');
-- admin_quitar_de_insumo
select pg_temp.parchar('public.admin_quitar_de_insumo(uuid)',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalogo_productos WHERE id = p_producto AND sucursal_id IN (SELECT public.mis_sucursales())) THEN
    RAISE EXCEPTION ''no autorizado'';
  END IF;
');
-- admin_unificar_productos
select pg_temp.parchar('public.admin_unificar_productos(uuid, uuid)',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
  -- 101: los dos productos deben ser de la cuenta activa.
  IF (SELECT count(*) FROM public.catalogo_productos WHERE id IN (p_origen, p_destino) AND sucursal_id IN (SELECT public.mis_sucursales())) < 2 THEN
    RAISE EXCEPTION ''no autorizado'';
  END IF;
');
-- categoria_extra_de
select pg_temp.parchar('public.categoria_extra_de(uuid)',
  'WHERE cp.id = p_producto
',
  'WHERE cp.id = p_producto
      -- 101: solo productos de la cuenta activa (o la plataforma).
      AND (auth.role() = ''service_role'' OR cp.sucursal_id IN (SELECT public.mis_sucursales()))
');
select pg_temp.parchar('public.categoria_extra_de(uuid)',
  'AND (c.sucursal_id IS NULL OR c.sucursal_id = p.sucursal_id)',
  'AND (c.sucursal_id = p.sucursal_id OR (c.sucursal_id IS NULL AND c.cuenta_id = p.cuenta_id))');
-- clasificar_renglones
select pg_temp.parchar('public.clasificar_renglones(text, uuid, uuid, text, uuid, text, numeric, text)',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
',
  '  IF NOT public.is_admin() THEN RAISE EXCEPTION ''no autorizado''; END IF;
  -- 101: sucursal, articulo y categoria de la cuenta activa.
  IF p_sucursal_id IS NOT NULL AND NOT public.puede_sucursal(p_sucursal_id) THEN RAISE EXCEPTION ''no autorizado''; END IF;
  IF p_producto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.catalogo_productos WHERE id = p_producto_id AND sucursal_id IN (SELECT public.mis_sucursales())) THEN
    RAISE EXCEPTION ''no autorizado'';
  END IF;
  IF p_categoria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias_gasto WHERE id = p_categoria_id AND cuenta_id = public.mi_cuenta()) THEN
    RAISE EXCEPTION ''no autorizado'';
  END IF;
');
select pg_temp.parchar('public.clasificar_renglones(text, uuid, uuid, text, uuid, text, numeric, text)',
  '       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id);
    GET DIAGNOSTICS v_total = ROW_COUNT;',
  '       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id)
       AND r.sucursal_id IN (SELECT public.mis_sucursales());
    GET DIAGNOSTICS v_total = ROW_COUNT;');
select pg_temp.parchar('public.clasificar_renglones(text, uuid, uuid, text, uuid, text, numeric, text)',
  '       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id)
     ORDER BY 1',
  '       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id)
       AND r.sucursal_id IN (SELECT public.mis_sucursales())
     ORDER BY 1');
-- decidir_renglon_no_autorizado
select pg_temp.parchar('public.decidir_renglon_no_autorizado(uuid, boolean, uuid)',
  '  IF p_categoria IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE id = p_categoria) THEN',
  '  -- 101: el renglon y la categoria deben ser de la cuenta activa.
  IF NOT EXISTS (SELECT 1 FROM ticket_items i JOIN registros_tickets r ON r.id = i.registro_ticket_id
                  WHERE i.id = p_item AND r.sucursal_id IN (SELECT public.mis_sucursales())) THEN RAISE EXCEPTION ''no autorizado''; END IF;
  IF p_categoria IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE id = p_categoria AND cuenta_id = public.mi_cuenta()) THEN');
-- ligar_huerfano
select pg_temp.parchar('public.ligar_huerfano(text, uuid, uuid, text, text[])',
  '  if not public.is_admin() then raise exception ''no autorizado''; end if;
',
  '  if not public.is_admin() then raise exception ''no autorizado''; end if;
  -- 101: sucursal y categoria de la cuenta activa.
  if p_sucursal_id is not null and not public.puede_sucursal(p_sucursal_id) then raise exception ''no autorizado''; end if;
  if not exists (select 1 from categorias_gasto where id = p_categoria_id and cuenta_id = public.mi_cuenta()) then raise exception ''no autorizado''; end if;
');
select pg_temp.parchar('public.ligar_huerfano(text, uuid, uuid, text, text[])',
  '       and (p_sucursal_id is null or r.sucursal_id = p_sucursal_id)
    union',
  '       and (p_sucursal_id is null or r.sucursal_id = p_sucursal_id)
       and r.sucursal_id in (select public.mis_sucursales())
    union');
-- marcar_uso_articulo
select pg_temp.parchar('public.marcar_uso_articulo(uuid, text, boolean)',
  '  PERFORM 1 FROM catalogo_productos WHERE id = p_producto;
',
  '  -- 101: solo articulos de la cuenta activa.
  PERFORM 1 FROM catalogo_productos WHERE id = p_producto AND sucursal_id IN (SELECT public.mis_sucursales());
');
select pg_temp.parchar('public.marcar_uso_articulo(uuid, text, boolean)',
  '       AND NOT EXISTS (SELECT 1 FROM ticket_items i WHERE i.registro_ticket_id = a.registro_ticket_id AND i.autorizacion = ''pendiente'');',
  '       AND a.registro_ticket_id IN (SELECT r.id FROM registros_tickets r WHERE r.sucursal_id IN (SELECT public.mis_sucursales()))
       AND NOT EXISTS (SELECT 1 FROM ticket_items i WHERE i.registro_ticket_id = a.registro_ticket_id AND i.autorizacion = ''pendiente'');');
-- recalcular_precios_ticket
select pg_temp.parchar('public.recalcular_precios_ticket(uuid)',
  '  SELECT id, sucursal_id, fecha_ticket, estado INTO v_reg FROM registros_tickets WHERE id = p_registro;
',
  '  -- 101: solo tickets de la cuenta activa.
  SELECT id, sucursal_id, fecha_ticket, estado INTO v_reg FROM registros_tickets
   WHERE id = p_registro AND sucursal_id IN (SELECT public.mis_sucursales());
');

-- 7. Permisos de ejecucion ------------------------------------------------------------------------------------------------
-- Supabase da EXECUTE a anon/authenticated por defecto: se quita lo que no deben llamar.
revoke all on function public.es_superadmin() from public, anon;
revoke all on function public.mi_cuenta() from public, anon;
revoke all on function public.mis_sucursales() from public, anon;
revoke all on function public.puede_sucursal(uuid) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.mis_cuentas_lista() from public, anon;
revoke all on function public.elegir_cuenta(uuid) from public, anon;
revoke all on function public.usuario_puede_sucursal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tg_cuenta_de_sucursal() from public, anon, authenticated;
revoke all on function public.sucursal_publica(text) from public;
grant execute on function public.es_superadmin(), public.mi_cuenta(), public.mis_sucursales(), public.puede_sucursal(uuid),
  public.is_admin(), public.mis_cuentas_lista(), public.elegir_cuenta(uuid) to authenticated;
grant execute on function public.usuario_puede_sucursal(uuid, uuid) to service_role;
grant execute on function public.sucursal_publica(text) to anon, authenticated;
revoke all on function public.verificar_pin(text, text) from public, anon, authenticated;
grant execute on function public.verificar_pin(text, text) to service_role;
