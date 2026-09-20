-- 074: CERO productos globales: lo que aprende un negocio no debe aparecerle a otro. Claude 2026-09-20.
-- Habia 21 productos con sucursal_id NULL (aprendidos de nuestros tickets): cualquier negocio nuevo los heredaria con
-- todo y sinonimos, y sus precios moverian nuestra referencia. Se reparten entre Santa Elena (SE) y Wings Palace (WP):
--   1) los que solo usa una sucursal se le asignan (no se mueve ni un renglon);
--   2) los 6 que usan las dos: la fila original se queda donde mas se usa y se crea una COPIA en la otra; a la copia se
--      pasan los renglones y precios de esa sucursal. Unidad y precio de referencia quedan como estaban (la copia los
--      hereda). No se fusiona con otros productos parecidos: eso lo decide Alejandro desde "Unificar productos" (070).
--   3) los 3 sin ningun uso quedan inactivos en WP (no se borra nada).
--   4) ligar_huerfano deja de crear productos globales y de reclasificar renglones de otras sucursales.
--   5) candado: catalogo_productos.sucursal_id NOT NULL.
create table if not exists respaldo.r074_productos as select * from catalogo_productos where sucursal_id is null;
create table if not exists respaldo.r074_items as
  select i.id, i.producto_catalogo_id from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id where p.sucursal_id is null;
create table if not exists respaldo.r074_precios as
  select h.id, h.producto_catalogo_id from precio_historial h join catalogo_productos p on p.id = h.producto_catalogo_id where p.sucursal_id is null;

create temp table _r074_divididos (id uuid primary key);

do $$
declare
  se constant uuid := 'fb61b496-894f-4706-98ec-ebb49513fcf3';
  wp constant uuid := '84a4c372-c6b8-481f-a700-374423348aa1';
  g record; n_se int; n_wp int; n_otras int; casa uuid; otra uuid; copia uuid;
  total_antes int; total_despues int;
begin
  select count(*) into total_antes from ticket_items where producto_catalogo_id is not null;

  for g in select * from catalogo_productos where sucursal_id is null loop
    select count(*) filter (where r.sucursal_id = se), count(*) filter (where r.sucursal_id = wp),
           count(*) filter (where r.sucursal_id not in (se, wp))
      into n_se, n_wp, n_otras
      from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id where i.producto_catalogo_id = g.id;
    if n_otras > 0 then raise exception 'El producto global % se usa en otra sucursal: revisar a mano', g.nombre; end if;

    if n_se = 0 and n_wp = 0 then            -- 3) sin uso: inactivo en WP
      update catalogo_productos set sucursal_id = wp, activo = false where id = g.id;
      continue;
    end if;
    casa := case when n_se >= n_wp then se else wp end;
    otra := case when casa = se then wp else se end;
    update catalogo_productos set sucursal_id = casa where id = g.id;   -- 1) y la parte "original" de 2)
    if least(n_se, n_wp) = 0 then continue; end if;

    -- 2) copia para la otra sucursal, con sus renglones y precios.
    insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, precio_referencia, veces_matched, activo,
      sucursal_id, contiene_cantidad, contiene_unidad, contiene_sub_cantidad, contiene_sub_unidad)
    values (g.nombre, g.sinonimos, g.categoria_id, g.unidad_default, g.precio_referencia, 0, g.activo,
      otra, g.contiene_cantidad, g.contiene_unidad, g.contiene_sub_cantidad, g.contiene_sub_unidad)
    returning id into copia;
    insert into _r074_divididos values (g.id), (copia);
    update ticket_items i set producto_catalogo_id = copia
      from registros_tickets r where r.id = i.registro_ticket_id and i.producto_catalogo_id = g.id and r.sucursal_id = otra;
    update precio_historial set producto_catalogo_id = copia where producto_catalogo_id = g.id and sucursal_id = otra;
  end loop;

  -- Los que se dividieron: cada lado con su conteo real de usos. La unidad y el precio de referencia NO se tocan (la
  -- copia hereda los del original): cambiarlos ahora dejaria precios guardados en otra unidad y alertas falsas de
  -- precio (cebolla y limones de WP). Queda igual que hoy; la unidad por sucursal se ajusta aparte, con su historial.
  update catalogo_productos p set
    veces_matched = (select count(*) from ticket_items i where i.producto_catalogo_id = p.id)
  where p.id in (select id from _r074_divididos);

  select count(*) into total_despues from ticket_items where producto_catalogo_id is not null;
  if total_antes <> total_despues then raise exception 'Se perdieron ligas: % -> %', total_antes, total_despues; end if;
  if exists (select 1 from catalogo_productos where sucursal_id is null) then raise exception 'Quedaron productos globales'; end if;
  if exists (select 1 from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
             join catalogo_productos p on p.id = i.producto_catalogo_id where p.sucursal_id <> r.sucursal_id) then
    raise exception 'Hay renglones ligados a un producto de otra sucursal';
  end if;
  if exists (select 1 from precio_historial h join catalogo_productos p on p.id = h.producto_catalogo_id
             where h.sucursal_id is not null and p.sucursal_id <> h.sucursal_id) then
    raise exception 'Hay precios ligados a un producto de otra sucursal';
  end if;
end $$;

drop table _r074_divididos;

-- 5) Candado: un producto siempre es de una sucursal.
alter table public.catalogo_productos alter column sucursal_id set not null;

-- 4) Ligar huerfanos sin cruzar negocios: trabaja sucursal por sucursal.
-- Con p_sucursal_id NULL (panel en "Todas") recorre las sucursales donde aparece ese huerfano y en CADA una crea o
-- actualiza SU producto; los renglones de una sucursal nunca se ligan al producto de otra. Una categoria propia de una
-- sucursal (p. ej. Bodega) solo se aplica en esa sucursal. Devuelve el producto de la primera sucursal tocada.
create or replace function public.ligar_huerfano(
  p_nombre text, p_categoria_id uuid, p_sucursal_id uuid default null, p_unidad text default null, p_sinonimos text[] default '{}')
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_suc uuid; v_prod_id uuid; v_primero uuid; v_cat_suc uuid;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  select sucursal_id into v_cat_suc from categorias_gasto where id = p_categoria_id;

  for v_suc in
    select distinct r.sucursal_id
      from ticket_items ti join registros_tickets r on r.id = ti.registro_ticket_id
     where ti.categoria_id is null and lower(ti.descripcion) = lower(trim(p_nombre))
       and (p_sucursal_id is null or r.sucursal_id = p_sucursal_id)
    union
    select p_sucursal_id where p_sucursal_id is not null
    order by 1
  loop
    if v_cat_suc is not null and v_cat_suc <> v_suc then continue; end if;

    select id into v_prod_id from catalogo_productos
     where lower(nombre) = lower(trim(p_nombre)) and sucursal_id = v_suc limit 1;
    if v_prod_id is null then
      insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
      values (trim(p_nombre), coalesce(p_sinonimos, '{}'), p_categoria_id, p_unidad, v_suc)
      returning id into v_prod_id;
    else
      update catalogo_productos
         set categoria_id = p_categoria_id,
             unidad_default = coalesce(p_unidad, unidad_default),
             sinonimos = (select array(select distinct unnest(sinonimos || coalesce(p_sinonimos, '{}'))))
       where id = v_prod_id;
    end if;

    update ticket_items ti
       set categoria_id = p_categoria_id,
           producto_catalogo_id = v_prod_id,
           unidad = coalesce(ti.unidad, p_unidad),
           necesita_revision = (coalesce(ti.unidad, p_unidad) is null),
           motivo_revision = case when coalesce(ti.unidad, p_unidad) is null then 'sin_unidad' else null end
      from registros_tickets r
     where r.id = ti.registro_ticket_id and r.sucursal_id = v_suc
       and ti.categoria_id is null
       and (ti.producto_catalogo_id = v_prod_id or lower(ti.descripcion) = lower(trim(p_nombre)));

    if v_primero is null then v_primero := v_prod_id; end if;
    v_prod_id := null;
  end loop;

  return v_primero;
end; $function$;
revoke all on function public.ligar_huerfano(text, uuid, uuid, text, text[]) from public, anon;
grant execute on function public.ligar_huerfano(text, uuid, uuid, text, text[]) to authenticated, service_role;
