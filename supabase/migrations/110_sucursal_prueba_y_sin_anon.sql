-- 110 (2026-11-03): una sucursal de una cuenta de prueba es de prueba (sus tickets se pueden eliminar). Y el ultimo paso del aislamiento:
-- la pagina del gerente ya usa sucursal_publica, asi que nadie sin sesion puede listar sucursales. Aplicar despues de publicar el frontend.
create or replace function public.tg_sucursal_prueba() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select c.es_prueba from public.cuentas c where c.id = new.cuenta_id) then new.es_prueba := true; end if;
  return new;
end
$$;
drop trigger if exists sucursal_prueba on public.sucursales;
create trigger sucursal_prueba before insert on public.sucursales for each row execute function public.tg_sucursal_prueba();

drop policy if exists sucursales_activas_publicas on public.sucursales;
