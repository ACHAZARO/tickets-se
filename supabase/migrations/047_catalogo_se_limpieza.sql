-- 047: productos basura de Santa Elena (nombres mal leidos por la IA vieja) se funden en su producto correcto:
-- su nombre y sinonimos pasan como sinonimos del bueno, sus renglones/precios/consumos se reapuntan y se desactivan.
-- Ademas: categorias/unidades mal puestas y el producto "Moto envio" (envio de insumos, decision Alejandro 18-sep). Claude 2026-09-18.
do $$ declare
  suc uuid := 'fb61b496-894f-4706-98ec-ebb49513fcf3';
  f record; malo uuid; bueno uuid;
begin
  for f in select * from (values
    ('Almenda.', 'PAN DE ALMENDRA'), ('Almenra', 'PAN DE ALMENDRA'), ('Guayaana.', 'PAN DE GUAYABA'), ('Guaynac', 'PAN DE GUAYABA'),
    ('Pistene', 'Pan de pistache'), ('Rel', 'PAN ROL'), ('Requesun', 'Pan de Requesón'), ('Zarta', 'Pan de Zarzamora'),
    ('agua purificada', 'GARRAFON'), ('25 x seta Charola de Setas', 'SETAS'), ('Nutella', 'Pan de Nutella'), ('Cajeta', 'Pan de Cajeta'),
    ('Higo', 'Pan de Higo'), ('Manzana', 'Pan de manzana'), ('Piña', 'Pan de Piña'), ('LECHE D', 'Leche deslactosada'),
    ('LIMON', 'Limones'), ('CEBOLLINES', 'Cebollin'), ('Arindano', null)
  ) v(malo, bueno) loop
    select id into malo from catalogo_productos where nombre = f.malo and sucursal_id = suc and activo limit 1;
    if malo is null then continue; end if;
    bueno := null;
    if f.bueno is not null then
      select id into bueno from catalogo_productos where lower(nombre) = lower(f.bueno) and activo and (sucursal_id = suc or sucursal_id is null)
        order by (sucursal_id is null) limit 1;
    end if;
    if bueno is not null then
      update catalogo_productos b set sinonimos = (select array_agg(distinct x) from unnest(b.sinonimos || m.sinonimos || array[m.nombre]) x)
        from catalogo_productos m where b.id = bueno and m.id = malo;
      update ticket_items set producto_catalogo_id = bueno where producto_catalogo_id = malo;
      update precio_historial set producto_catalogo_id = bueno where producto_catalogo_id = malo;
      update consumo_inventario set producto_catalogo_id = bueno where producto_catalogo_id = malo;
    else
      update ticket_items set producto_catalogo_id = null where producto_catalogo_id = malo;
      delete from precio_historial where producto_catalogo_id = malo;
    end if;
    update catalogo_productos set activo = false where id = malo;
  end loop;

  update catalogo_productos set categoria_id = (select id from categorias_gasto where nombre = 'Insumos Alimentos' and sucursal_id is null limit 1)
    where nombre = 'AVE ACTION FRY 10L' and activo;
  update catalogo_productos set categoria_id = (select id from categorias_gasto where nombre = 'Descuentos' and sucursal_id is null limit 1)
    where nombre = 'CUPON DE DESCUENTO' and sucursal_id = suc and activo;
  update catalogo_productos set unidad_default = 'bolsa' where nombre = 'HIELO ROCIO 5 KG' and sucursal_id = suc and activo;
  update catalogo_productos set unidad_default = 'pz' where nombre = 'GARRAFON' and sucursal_id = suc and activo;
  update catalogo_productos set sinonimos = (select array_agg(distinct x) from unnest(sinonimos || array['envío', 'envio', 'c/envío', 'c/envio', 'con envío', 'con envio', 'Moto envio']) x)
    where nombre = 'Moto envío' and sucursal_id = suc and activo;
end $$;
