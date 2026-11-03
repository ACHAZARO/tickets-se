-- 108 (2026-11-03): el texto de la alerta ahora lleva acento ("terminación"): la busqueda acepta los dos.
create or replace function public.tarjeta_conocida(p_terminacion text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public.mi_cuenta(); v_term text := regexp_replace(coalesce(p_terminacion, ''), '\D', '', 'g'); v_n integer;
begin
  if v_cuenta is null then raise exception 'no autorizado'; end if;
  if length(v_term) < 2 then raise exception 'terminacion invalida'; end if;
  insert into public.cuenta_opciones (cuenta_id, tarjetas_ok) values (v_cuenta, array[v_term])
  on conflict (cuenta_id) do update
    set tarjetas_ok = (select array(select distinct x from unnest(public.cuenta_opciones.tarjetas_ok || array[v_term]) x));
  update public.alertas_tickets a set resuelta = true,
         correccion = coalesce(a.correccion, '{}'::jsonb) || jsonb_build_object('resuelta_por', 'tarjeta conocida')
    from public.registros_tickets r
   where r.id = a.registro_ticket_id and not a.resuelta and a.tipo = 'pago_distinto'
     and r.sucursal_id in (select public.mis_sucursales())
     and a.correccion->>'motivo' ~ ('terminaci[oó]n ' || v_term || '\y');
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
