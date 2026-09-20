-- 063: limpieza de catalogo del playo (Santa Elena). Claude 2026-09-19, al mover el playo a Bodega (062).
-- 1) Habia DOS productos activos para el mismo rollo grande, con el mismo sinonimo "STRETCH 18 CAL 80 PIES 1300 REYMA":
--    "Playo stretch Reyma 18 cal 80 1300 ft" (19 compras, ya en Bodega) y "Playo stretch 18 cal 80 1300 pies" (0 compras).
--    Se funden en el primero: la IA ya no puede dudar entre los dos.
-- 2) "Playo stretch Polpusa 18 cal 60 1000 ft" tenia colado el sinonimo "10000007 MINERAL 24/.355L RT" (agua mineral):
--    con eso, un renglon de refresco podia acabar contado como playo. Se quita.
create table if not exists respaldo.r063_productos as
  select id, nombre, sinonimos, activo, categoria_id from catalogo_productos
  where id in ('a0e4e989-7f1d-4092-a979-a2007a7e219f', 'dbed7113-7ade-4ac9-a89e-d724fdecde09', '4594a3c8-fee3-46fd-b545-fcdbf1994b8f');

-- 1) Fundir el duplicado vacio en el bueno.
do $$ declare bueno uuid := '4594a3c8-fee3-46fd-b545-fcdbf1994b8f'; malo uuid := 'a0e4e989-7f1d-4092-a979-a2007a7e219f';
begin
  if exists (select 1 from catalogo_productos where id = malo) then
    update catalogo_productos b
      set sinonimos = (select array_agg(distinct x) from unnest(b.sinonimos || m.sinonimos || array[m.nombre]) x)
      from catalogo_productos m where b.id = bueno and m.id = malo;
    update ticket_items set producto_catalogo_id = bueno where producto_catalogo_id = malo;
    update precio_historial set producto_catalogo_id = bueno where producto_catalogo_id = malo;
    update catalogo_productos set activo = false where id = malo;
  end if;
end $$;

-- 2) Quitar el sinonimo de agua mineral del playo Polpusa.
update catalogo_productos set sinonimos = array_remove(sinonimos, '10000007 MINERAL 24/.355L RT')
where id = 'dbed7113-7ade-4ac9-a89e-d724fdecde09';
