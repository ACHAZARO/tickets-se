-- 105_precios_por_unidad_del_articulo.sql (2026-11-03, Claude)
-- 1) Alerta nueva: cuenta a mano de toda una vuelta de compras.
-- 2) El precio de la misma bolsa se guardaba unas veces por pieza y otras por kg ("ADEREZO RANCH 3.4 KG": $279.53 la pieza contra
--    $82.22 el kg) y salian alarmas de precio falsas. Misma regla que _shared/precios.ts ahora tambien en la base: el historial
--    siempre en la unidad del articulo. Se recalcula el historial; respaldo en respaldo.r105_precio_historial.

alter table public.alertas_tickets drop constraint if exists alertas_tickets_tipo_check;
alter table public.alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha', 'monto_anomalo',
  'precio_anomalo', 'ia_sin_leer', 'revisar_gerente', 'envio_alto', 'pagos_no_cuadran', 'articulo_no_autorizado',
  'articulo_ocasional', 'articulo_vigilado', 'pago_distinto', 'nota_a_mano', 'cuenta_a_mano'
]));

create or replace function public.base_unidad(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p, '')))
    when 'kg' then 'kg' when 'kgs' then 'kg' when 'kilo' then 'kg' when 'kilos' then 'kg'
    when 'g' then 'g' when 'gr' then 'g' when 'grs' then 'g' when 'gramos' then 'g'
    when 'l' then 'l' when 'lt' then 'l' when 'lts' then 'l' when 'litro' then 'l' when 'litros' then 'l'
    when 'ml' then 'ml' end
$$;

-- "HIELO 5 KG" -> 5 si el articulo se mide en kg.
create or replace function public.presentacion_articulo(p_nombre text, p_base text) returns numeric
language plpgsql immutable set search_path = public as $$
declare m text[];
begin
  for m in select regexp_matches(replace(lower(coalesce(p_nombre, '')), ',', '.'), '(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grs?|g|gramos|lts?|litros?|l|ml)(?![a-z])', 'g') loop
    if public.base_unidad(m[2]) = p_base and m[1]::numeric > 0 then return m[1]::numeric; end if;
  end loop;
  return null;
end
$$;

-- Igual que cantidadEnUnidadDelArticulo en _shared/precios.ts. null = no se puede comparar.
create or replace function public.cantidad_en_unidad_articulo(p_cant numeric, p_unidad text, p_nombre text, p_u_prod text) returns numeric
language plpgsql immutable set search_path = public as $$
declare v_base text := public.base_unidad(p_u_prod); v_pres numeric;
begin
  if p_cant is null or p_cant <= 0 then return null; end if;
  if p_u_prod is null or p_unidad is null or p_unidad = p_u_prod then
    if v_base is not null and p_cant = 1 then
      v_pres := public.presentacion_articulo(p_nombre, v_base);
      if v_pres is not null and v_pres <> 1 then return v_pres; end if;
    end if;
    return p_cant;
  end if;
  if v_base is null then return null; end if;
  if public.base_unidad(p_unidad) = v_base then
    v_pres := public.presentacion_articulo(p_nombre, v_base);
    return case when p_cant = 1 and v_pres is not null and v_pres <> 1 then v_pres else p_cant end;
  end if;
  if public.base_unidad(p_unidad) is not null then return null; end if;
  v_pres := public.presentacion_articulo(p_nombre, v_base);
  return case when v_pres is not null then p_cant * v_pres end;
end
$$;

-- Al corregir un ticket confirmado desde la pantalla: la misma regla.
create or replace function public.recalcular_precios_ticket(p_registro uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_reg record; v_n integer := 0; r record;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select id, sucursal_id, fecha_ticket, estado into v_reg from registros_tickets
   where id = p_registro and sucursal_id in (select public.mis_sucursales());
  if not found then raise exception 'ticket no encontrado'; end if;

  delete from precio_historial where registro_ticket_id = p_registro;
  if v_reg.estado <> 'confirmado' then return 0; end if;

  for r in
    select distinct on (ti.producto_catalogo_id)
           ti.producto_catalogo_id as pid,
           ti.monto / public.cantidad_en_unidad_articulo(ti.cantidad, ti.unidad, p.nombre, p.unidad_default) as unit
      from ticket_items ti join catalogo_productos p on p.id = ti.producto_catalogo_id
     where ti.registro_ticket_id = p_registro and ti.monto > 0 and p.uso = 'normal'
       and public.cantidad_en_unidad_articulo(ti.cantidad, ti.unidad, p.nombre, p.unidad_default) > 0
     order by ti.producto_catalogo_id, ti.orden nulls last, ti.id
  loop
    insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha)
    values (r.pid, v_reg.sucursal_id, p_registro, r.unit, v_reg.fecha_ticket);
    update catalogo_productos set precio_referencia = r.unit where id = r.pid;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Historial viejo: se recalcula con su renglon. Lo que no se puede convertir (otra medida) se quita: ya no serviria de referencia.
create schema if not exists respaldo;
create table if not exists respaldo.r105_precio_historial as select * from public.precio_historial;

with calc as (
  select distinct on (h.id) h.id,
         ti.monto / nullif(public.cantidad_en_unidad_articulo(ti.cantidad, ti.unidad, p.nombre, p.unidad_default), 0) as unit
    from public.precio_historial h
    join public.ticket_items ti on ti.registro_ticket_id = h.registro_ticket_id and ti.producto_catalogo_id = h.producto_catalogo_id
    join public.catalogo_productos p on p.id = h.producto_catalogo_id
   where ti.monto > 0
   order by h.id, ti.orden nulls last, ti.id
)
update public.precio_historial h set precio_unitario = c.unit
  from calc c where c.id = h.id and c.unit is not null and abs(c.unit - h.precio_unitario) > 0.005;

delete from public.precio_historial h
 where exists (select 1 from public.ticket_items ti join public.catalogo_productos p on p.id = ti.producto_catalogo_id
                where ti.registro_ticket_id = h.registro_ticket_id and ti.producto_catalogo_id = h.producto_catalogo_id and ti.monto > 0)
   and not exists (select 1 from public.ticket_items ti join public.catalogo_productos p on p.id = ti.producto_catalogo_id
                    where ti.registro_ticket_id = h.registro_ticket_id and ti.producto_catalogo_id = h.producto_catalogo_id and ti.monto > 0
                      and public.cantidad_en_unidad_articulo(ti.cantidad, ti.unidad, p.nombre, p.unidad_default) > 0);
