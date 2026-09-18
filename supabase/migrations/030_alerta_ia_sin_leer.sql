-- 030: alerta 'ia_sin_leer' = la IA (Gemini) NO leyo el ticket (sin cuota / saturada).
-- Antes esos tickets quedaban como 'ilegible' + 'sin_fecha' con la fecha de SUBIDA
-- inventada y un renglon de relleno "Ticket", lo que parecia "la IA lee mal".

-- Respaldo de todo lo que esta migracion modifica, en un esquema NO expuesto por la API
-- (PostgREST solo publica 'public'). Para deshacer: restaurar desde respaldo.r030_*.
create schema if not exists respaldo;
revoke all on schema respaldo from public, anon, authenticated;
create table respaldo.r030_registros as
  select id, estado, fecha_ticket, monto, gemini_raw from public.registros_tickets where estado = 'pendiente';
create table respaldo.r030_items as
  select i.* from public.ticket_items i join public.registros_tickets r on r.id = i.registro_ticket_id
  where r.estado = 'pendiente' and r.gemini_raw ? '_error';
create table respaldo.r030_alertas as
  select a.* from public.alertas_tickets a join public.registros_tickets r on r.id = a.registro_ticket_id
  where r.estado = 'pendiente';
create table respaldo.r030_catalogo as
  select id, sinonimos from public.catalogo_productos where 'Ticket' = any(sinonimos);

alter table public.alertas_tickets drop constraint if exists alertas_tickets_tipo_check;
alter table public.alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad',
  'sin_fecha', 'monto_anomalo', 'precio_anomalo', 'ia_sin_leer'
]));

-- Re-etiquetar los pendientes que la IA nunca leyo (gemini_raw._error de la cadena de modelos).
with fallidos as (
  select id from public.registros_tickets
  where estado = 'pendiente' and gemini_raw ? '_error' and coalesce(jsonb_array_length(gemini_raw->'items'), 0) = 0
)
update public.alertas_tickets a set resuelta = true
from fallidos f
where a.registro_ticket_id = f.id and a.resuelta = false
  and a.tipo in ('ilegible', 'sin_fecha', 'producto_no_reconocido', 'sin_unidad');

with fallidos as (
  select id from public.registros_tickets
  where estado = 'pendiente' and gemini_raw ? '_error' and coalesce(jsonb_array_length(gemini_raw->'items'), 0) = 0
)
insert into public.alertas_tickets (registro_ticket_id, tipo)
select f.id, 'ia_sin_leer' from fallidos f
where not exists (
  select 1 from public.alertas_tickets a where a.registro_ticket_id = f.id and a.tipo = 'ia_sin_leer' and a.resuelta = false
);

-- Quitar el renglon de relleno "Ticket" (sin monto) y la fecha inventada. OJO: ese relleno
-- quedaba ligado a "Viaje de agua 10,000 litros" porque alguien le enseño "Ticket" como sinonimo.
with fallidos as (
  select id from public.registros_tickets
  where estado = 'pendiente' and gemini_raw ? '_error' and coalesce(jsonb_array_length(gemini_raw->'items'), 0) = 0
)
delete from public.ticket_items i using fallidos f
where i.registro_ticket_id = f.id and i.descripcion = 'Ticket' and i.monto is null;

update public.catalogo_productos
set sinonimos = array_remove(sinonimos, 'Ticket')
where 'Ticket' = any(sinonimos);

update public.registros_tickets
set fecha_ticket = null,
    monto = null,
    gemini_raw = gemini_raw - '_fecha_asumida' || jsonb_build_object('_ia_fallo', 'cadena_modelos_vieja')
where estado = 'pendiente' and gemini_raw ? '_error' and coalesce(jsonb_array_length(gemini_raw->'items'), 0) = 0;

-- Pendientes con fecha fuera de lo creible respecto al dia de subida (hora de Mexico): posterior
-- a la subida (+1 dia de tolerancia) o de mas de ~4 meses antes (año mal leido: 2006, 2020, 2024, 2028, 2076...). Con el
-- filtro de Tickets por fecha del ticket quedarian escondidos. Mismas reglas que resolverFecha():
--   1) mismo dia/mes en el año de subida o el anterior, si cae en los 120 dias previos;
--   2) dia y mes volteados (DD/MM <-> MM/DD), si cae en los 120 dias previos;
--   3) si la fecha leida es real y de hace 4-13 meses, se conserva;
--   4) si no, la fecha de subida.
-- Siempre se guarda la fecha leida y se abre 'sin_fecha' ("Fecha asumida") para revisarla.
-- Los CONFIRMADOS no se tocan aqui (cambiaria meses ya revisados): se revisan a mano.
do $$
declare
  r record;
  y int;
  cand date;
  elegida date;
begin
  for r in
    select t.id, t.fecha_ticket as f, (t.created_at at time zone 'America/Mexico_City')::date as sub, t.gemini_raw
    from public.registros_tickets t
    where t.estado = 'pendiente' and t.fecha_ticket is not null
      and (t.fecha_ticket > (t.created_at at time zone 'America/Mexico_City')::date + 1
        or t.fecha_ticket < (t.created_at at time zone 'America/Mexico_City')::date - 120)
  loop
    elegida := null;
    foreach y in array array[extract(year from r.sub)::int, extract(year from r.sub)::int - 1] loop
      begin
        cand := make_date(y, extract(month from r.f)::int, extract(day from r.f)::int);
        if cand <= r.sub + 1 and cand >= r.sub - 120 then elegida := cand; exit; end if;
      exception when others then null; -- 29-feb en año no bisiesto
      end;
    end loop;
    if elegida is null and extract(day from r.f) <= 12 then
      foreach y in array array[extract(year from r.f)::int, extract(year from r.sub)::int] loop
        begin
          cand := make_date(y, extract(day from r.f)::int, extract(month from r.f)::int);
          if cand <= r.sub + 1 and cand >= r.sub - 120 then elegida := cand; exit; end if;
        exception when others then null;
        end;
      end loop;
    end if;
    if elegida is null and r.f <= r.sub + 1 and r.f >= r.sub - 400 then elegida := r.f; end if;
    update public.registros_tickets
    set fecha_ticket = coalesce(elegida, r.sub),
        gemini_raw = coalesce(r.gemini_raw, '{}'::jsonb) || jsonb_build_object('_fecha_asumida', true, '_fecha_leida', r.f::text)
    where id = r.id;
    if not exists (
      select 1 from public.alertas_tickets a where a.registro_ticket_id = r.id and a.tipo = 'sin_fecha' and a.resuelta = false
    ) then
      insert into public.alertas_tickets (registro_ticket_id, tipo) values (r.id, 'sin_fecha');
    end if;
  end loop;
end $$;
