-- Descuentos: categoria operativa global + producto, para que los descuentos del
-- ticket se capturen como un renglon con monto NEGATIVO (dinero ahorrado) y resten
-- del gasto operativo. La IA los detecta (regla en el prompt de procesar-ticket).
insert into categorias_gasto (nombre, orden, activa, sucursal_id, cuenta_operativo)
select 'Descuentos', coalesce((select max(orden) from categorias_gasto where sucursal_id is null), 0) + 1, true, null, true
where not exists (select 1 from categorias_gasto where lower(nombre) = 'descuentos' and sucursal_id is null);

insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id, activo)
select 'Descuentos', array['descuento','promocion','promo','rebaja','ahorro','dscto'],
  (select id from categorias_gasto where lower(nombre) = 'descuentos' and sucursal_id is null limit 1),
  'pz', null, true
where not exists (select 1 from catalogo_productos where lower(nombre) = 'descuentos' and sucursal_id is null);
