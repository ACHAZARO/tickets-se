-- 062: el playo de Adan Melchor es de Bodega (Alejandro, 19-sep). Claude 2026-09-19.
-- Es el rollo grande de emplaye: "Playo stretch Reyma 18 cal 80 1300 ft", que solo se le compra a Adan Melchor y solo en
-- Santa Elena (40 rollos, $11,580.36 de junio a septiembre). Pasa a Bodega por producto, como las bolsas metalizadas y la
-- cinta (059). NO se tocan: "Playo stretch Polpusa 18 cal 60 1000 ft" (El Bodegon) ni "Playo clingfilm 30cm x 300m"
-- (pelicula para alimentos, cocina del cafe y de Wings).
create table if not exists respaldo.r062_items as
  select i.id, i.categoria_id from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id
  where p.nombre = 'Playo stretch Reyma 18 cal 80 1300 ft';
create table if not exists respaldo.r062_productos as
  select id, nombre, categoria_id from catalogo_productos where nombre = 'Playo stretch Reyma 18 cal 80 1300 ft';

update catalogo_productos p set categoria_id = c.id
from categorias_gasto c
where c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id and p.nombre = 'Playo stretch Reyma 18 cal 80 1300 ft';
update ticket_items i set categoria_id = p.categoria_id
from catalogo_productos p join categorias_gasto c on c.id = p.categoria_id and c.nombre = 'Bodega'
where p.id = i.producto_catalogo_id and p.nombre = 'Playo stretch Reyma 18 cal 80 1300 ft'
  and i.categoria_id is distinct from p.categoria_id;
