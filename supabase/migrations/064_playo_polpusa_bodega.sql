-- 064: el playo Polpusa de 1000 pies tambien es de Bodega (Alejandro, 19-sep). Claude 2026-09-19.
-- "Playo stretch Polpusa 18 cal 60 1000 ft" (El Bodegon de Semillas): 2 compras en junio, 6 rollos, $786.
-- Es el mismo uso que el rollo grande de Reyma (emplayar paquetes), solo que mas chico y mas barato.
-- NO se toca "Playo clingfilm 30cm x 300m": es pelicula para alimentos y Wings Palace tambien la compra.
create table if not exists respaldo.r064_items as
  select i.id, i.categoria_id from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id
  where p.nombre = 'Playo stretch Polpusa 18 cal 60 1000 ft';
create table if not exists respaldo.r064_productos as
  select id, nombre, categoria_id from catalogo_productos where nombre = 'Playo stretch Polpusa 18 cal 60 1000 ft';

update catalogo_productos p set categoria_id = c.id
from categorias_gasto c
where c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id and p.nombre = 'Playo stretch Polpusa 18 cal 60 1000 ft';
update ticket_items i set categoria_id = p.categoria_id
from catalogo_productos p join categorias_gasto c on c.id = p.categoria_id and c.nombre = 'Bodega'
where p.id = i.producto_catalogo_id and p.nombre = 'Playo stretch Polpusa 18 cal 60 1000 ft'
  and i.categoria_id is distinct from p.categoria_id;
