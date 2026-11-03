-- 104_invitaciones_y_alta.sql (2026-11-03, Claude; PLAN_BETA_AMIGOS.md)
-- Beta cerrada: un negocio nuevo entra SOLO con una invitacion que genera el super admin (enlace de un solo uso). El alta la hace
-- la edge function crear-cuenta; aqui viven la invitacion, la cuenta nueva en una sola transaccion, el tope de tickets por mes y
-- el resumen de negocios para el super admin.

create table if not exists public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  nota text,
  limite_tickets_mes integer default 300 check (limite_tickets_mes is null or limite_tickets_mes >= 0),
  es_prueba boolean not null default false,
  creada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expira timestamptz not null default now() + interval '30 days',
  usada_en timestamptz,
  cuenta_id uuid references public.cuentas(id) on delete set null
);
alter table public.invitaciones enable row level security;
drop policy if exists invitaciones_super on public.invitaciones;
create policy invitaciones_super on public.invitaciones for all to authenticated
  using (public.es_superadmin()) with check (public.es_superadmin());
revoke all on public.invitaciones from anon;

-- A donde llegan los correos de alerta de cada negocio; sin valor, al correo de sus duenos.
alter table public.cuentas add column if not exists correo_alertas text;
update public.cuentas set correo_alertas = 'alepolch@gmail.com'
 where id = 'c559a659-c170-4b04-8574-b7aac622f68c' and correo_alertas is null;

-- La pagina de registro pregunta si el enlace sirve antes de pintar el formulario.
create or replace function public.invitacion_valida(p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invitaciones where codigo = p_codigo and usada_en is null and expira > now())
$$;
revoke all on function public.invitacion_valida(text) from public;
grant execute on function public.invitacion_valida(text) to anon, authenticated, service_role;

create or replace function public.crear_invitacion(p_nota text default null, p_limite integer default 300, p_es_prueba boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  if not public.es_superadmin() then raise exception 'no autorizado'; end if;
  insert into public.invitaciones (nota, limite_tickets_mes, es_prueba, creada_por)
  values (nullif(btrim(p_nota), ''), p_limite, coalesce(p_es_prueba, false), auth.uid())
  returning codigo into v_codigo;
  return v_codigo;
end
$$;
revoke all on function public.crear_invitacion(text, integer, boolean) from public, anon;
grant execute on function public.crear_invitacion(text, integer, boolean) to authenticated, service_role;

-- Cuenta nueva completa en una sola transaccion. Solo la llama crear-cuenta (service_role): ahi ya se creo el usuario.
-- El candado "for update" hace que un mismo enlace abierto dos veces solo cree una cuenta.
create or replace function public.alta_cuenta(p_codigo text, p_user uuid, p_negocio text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv public.invitaciones%rowtype; v_cuenta uuid;
begin
  select * into v_inv from public.invitaciones where codigo = p_codigo for update;
  if not found or v_inv.usada_en is not null or v_inv.expira <= now() then raise exception 'invitacion_invalida'; end if;
  if p_negocio is null or length(btrim(p_negocio)) < 2 then raise exception 'falta el nombre del negocio'; end if;

  insert into public.cuentas (nombre, estado, es_prueba, limite_tickets_mes, creada_por)
  values (btrim(p_negocio), 'activa', v_inv.es_prueba, v_inv.limite_tickets_mes, v_inv.creada_por)
  returning id into v_cuenta;
  insert into public.cuenta_usuarios (cuenta_id, user_id, rol) values (v_cuenta, p_user, 'dueno');
  insert into public.usuario_cuenta_activa (user_id, cuenta_id) values (p_user, v_cuenta)
    on conflict (user_id) do update set cuenta_id = excluded.cuenta_id, updated_at = now();
  -- Empieza en entrenamiento: la IA acepta lo que sube el dueno y aprende (PLAN_MODO_ENTRENAMIENTO.md).
  insert into public.cuenta_opciones (cuenta_id, entrenamiento, entrenamiento_desde, bienvenida_vista)
  values (v_cuenta, true, now(), true)
  on conflict (cuenta_id) do update set entrenamiento = true, entrenamiento_desde = now(), bienvenida_vista = true;
  update public.invitaciones set usada_en = now(), cuenta_id = v_cuenta where id = v_inv.id;
  return v_cuenta;
end
$$;
revoke all on function public.alta_cuenta(text, uuid, text) from public, anon, authenticated;
grant execute on function public.alta_cuenta(text, uuid, text) to service_role;

-- Antes de aceptar una foto: null = puede subir; 'suspendida' o 'tope' = no. El mes es el calendario de la hora de Mexico.
create or replace function public.puede_subir(p_sucursal uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.estado <> 'activa' then 'suspendida'
    when c.limite_tickets_mes is not null and (
      select count(*) from public.registros_tickets r join public.sucursales s2 on s2.id = r.sucursal_id
       where s2.cuenta_id = c.id
         and r.created_at >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'
    ) >= c.limite_tickets_mes then 'tope'
  end
  from public.sucursales s join public.cuentas c on c.id = s.cuenta_id where s.id = p_sucursal
$$;
revoke all on function public.puede_subir(uuid) from public, anon, authenticated;
grant execute on function public.puede_subir(uuid) to service_role;

-- Panel de negocios del super admin.
create or replace function public.negocios_resumen()
returns table (id uuid, nombre text, estado text, es_prueba boolean, limite_tickets_mes integer, creada timestamptz, duenos text,
               sucursales bigint, tickets_mes bigint, tickets_total bigint, ultimo_ticket timestamptz, entrenamiento boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'no autorizado'; end if;
  return query
  select c.id, c.nombre, c.estado, c.es_prueba, c.limite_tickets_mes, c.created_at,
         (select string_agg(u.email::text, ', ') from public.cuenta_usuarios m join auth.users u on u.id = m.user_id where m.cuenta_id = c.id),
         (select count(*) from public.sucursales s where s.cuenta_id = c.id),
         (select count(*) from public.registros_tickets r join public.sucursales s on s.id = r.sucursal_id
           where s.cuenta_id = c.id and r.created_at >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'),
         (select count(*) from public.registros_tickets r join public.sucursales s on s.id = r.sucursal_id where s.cuenta_id = c.id),
         (select max(r.created_at) from public.registros_tickets r join public.sucursales s on s.id = r.sucursal_id where s.cuenta_id = c.id),
         coalesce((select o.entrenamiento from public.cuenta_opciones o where o.cuenta_id = c.id), false)
    from public.cuentas c
   order by c.es_prueba, c.created_at;
end
$$;
revoke all on function public.negocios_resumen() from public, anon;
grant execute on function public.negocios_resumen() to authenticated, service_role;

-- p_limite: -1 = sin tope; null = no cambiar. p_estado: null = no cambiar.
create or replace function public.negocio_cambiar(p_cuenta uuid, p_estado text default null, p_limite integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'no autorizado'; end if;
  if p_estado is not null and p_estado not in ('activa', 'suspendida') then raise exception 'estado invalido'; end if;
  update public.cuentas set
    estado = coalesce(p_estado, estado),
    limite_tickets_mes = case when p_limite is null then limite_tickets_mes when p_limite < 0 then null else p_limite end
   where id = p_cuenta;
end
$$;
revoke all on function public.negocio_cambiar(uuid, text, integer) from public, anon;
grant execute on function public.negocio_cambiar(uuid, text, integer) to authenticated, service_role;
