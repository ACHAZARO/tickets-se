-- 115 (2026-11-03): en muchos negocios el gerente paga con su tarjeta y luego toma el efectivo de la caja. Un negocio asi lo dice una vez
-- y el papel que dice tarjeta con efectivo declarado ya no se pregunta. Apagado por defecto: un negocio nuevo sigue viendo la pregunta.
alter table public.cuenta_opciones add column if not exists tarjeta_repone_caja boolean not null default false;

create or replace function public.gerente_paga_con_tarjeta() returns integer
language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.mi_cuenta(); v_n integer;
begin
  if v_cuenta is null then raise exception 'no autorizado'; end if;
  insert into public.cuenta_opciones (cuenta_id, tarjeta_repone_caja) values (v_cuenta, true)
  on conflict (cuenta_id) do update set tarjeta_repone_caja = true;
  update public.alertas_tickets a set resuelta = true,
         correccion = coalesce(a.correccion, '{}'::jsonb) || jsonb_build_object('resuelta_por', 'el gerente paga con su tarjeta')
    from public.registros_tickets r
   where r.id = a.registro_ticket_id and not a.resuelta and a.tipo = 'pago_distinto'
     and r.sucursal_id in (select public.mis_sucursales())
     and a.correccion->>'motivo' ~ '^El (papel dice|ticket dice que se pago con) tarjeta';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.gerente_paga_con_tarjeta() from public, anon;
grant execute on function public.gerente_paga_con_tarjeta() to authenticated, service_role;
