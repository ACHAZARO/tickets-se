-- Fase 0 del "Cerebro": productos huerfanos + ligar/back-fill
-- - categoria_id pasa a NULLABLE: un producto puede existir sin categoria (huerfano/nodo).
-- - ligar_huerfano(): crea/actualiza un producto y rellena hacia atras los renglones
--   sin categoria que coincidan (por producto o por nombre). Es el motor del cerebro
--   y de la cola de huerfanos: ligar un huerfano lo manda solo a su categoria, tambien
--   retroactivamente.

alter table catalogo_productos alter column categoria_id drop not null;

create or replace function ligar_huerfano(
  p_nombre text,
  p_categoria_id uuid,
  p_sucursal_id uuid default null,
  p_unidad text default null,
  p_sinonimos text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_prod_id uuid;
begin
  select id into v_prod_id from catalogo_productos
   where lower(nombre) = lower(trim(p_nombre))
     and (sucursal_id is null or sucursal_id = p_sucursal_id)
   limit 1;

  if v_prod_id is null then
    insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
    values (trim(p_nombre), coalesce(p_sinonimos, '{}'), p_categoria_id, p_unidad, p_sucursal_id)
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
   where ti.categoria_id is null
     and (ti.producto_catalogo_id = v_prod_id or lower(ti.descripcion) = lower(trim(p_nombre)));

  return v_prod_id;
end; $$;

grant execute on function ligar_huerfano(text, uuid, uuid, text, text[]) to authenticated;
