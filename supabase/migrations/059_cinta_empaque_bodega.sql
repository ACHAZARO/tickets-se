-- 059: la cinta de empaque del cafe es de Bodega (Alejandro, 19-sep). Claude 2026-09-19.
-- Por PRODUCTO, no por comercio: El Fenix / El Iris tambien venden cosas de la cafeteria (grapas, papeleria).
-- Productos de Santa Elena: "Cinta de empaque transparente 48x150" y "Despachador con cinta de empaque 48mm".
-- Pasan a Bodega por default y tambien sus compras anteriores. Wings no tiene Bodega: no se toca.
create table if not exists respaldo.r059_items as
  select i.id, i.categoria_id from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id
  join categorias_gasto c on c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id
  where p.nombre in ('Cinta de empaque transparente 48x150', 'Despachador con cinta de empaque 48mm');
create table if not exists respaldo.r059_productos as
  select p.id, p.categoria_id from catalogo_productos p
  join categorias_gasto c on c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id
  where p.nombre in ('Cinta de empaque transparente 48x150', 'Despachador con cinta de empaque 48mm');

update catalogo_productos p set categoria_id = c.id
from categorias_gasto c
where c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id
  and p.nombre in ('Cinta de empaque transparente 48x150', 'Despachador con cinta de empaque 48mm');
update ticket_items i set categoria_id = p.categoria_id
from catalogo_productos p join categorias_gasto c on c.id = p.categoria_id and c.nombre = 'Bodega'
where p.id = i.producto_catalogo_id
  and p.nombre in ('Cinta de empaque transparente 48x150', 'Despachador con cinta de empaque 48mm')
  and i.categoria_id is distinct from p.categoria_id;
