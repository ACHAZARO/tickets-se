-- 055: Adan Melchor 17-sep resuelto (gerente via Alejandro, 19-sep). Claude 2026-09-19.
-- La gerente escribio a mano $1,920 en el ticket de Adan Melchor sumando tres cosas del mismo dia:
--   Adan Melchor (playo + bolsas metalizadas) $1,490.09 + El Fenix cinta de empaque $339.60 + moto $90 = $1,919.69.
-- El ticket de El Fenix SI se subio aparte (87ede10d, folio 300470, trae "Bodega" a mano): se deja como esta.
-- El de Adan (65809be7) queda en $1,580.09: sus productos + "Moto envio" de $90, y se confirma.
-- Sin renglones ajenos ni sinonimos nuevos: no cambia lo que aprende la IA (catalogo, categorias por proveedor,
-- envios por proveedor, precios). La cinta de El Fenix 17-sep es insumo de Bodega (Alejandro).
-- Limpieza de precios: dos renglones de cinta (12 rollos) venian en "pz" y no entraban al historial de precios.
create table if not exists respaldo.r055_tickets as
  select id, estado, monto, confirmado_en, gemini_raw from registros_tickets
  where id in ('65809be7-4f79-42e1-839c-11d43685c5e0', '87ede10d-435a-4052-b47e-2cc35cb7ebbf') or id::text like '7ccc2089%';
create table if not exists respaldo.r055_items as
  select * from ticket_items where registro_ticket_id in (select id from respaldo.r055_tickets);
create table if not exists respaldo.r055_alertas as
  select * from alertas_tickets where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0';

-- 1) Adan Melchor 17-sep: moto $90, total $1,580.09, confirmado.
update ticket_items set monto = 90
where id = '2a6c4606-ca12-47e9-966c-ac6b546fb96e' and descripcion = 'Moto envío' and monto = 429.91;
update registros_tickets set monto = 1580.09, estado = 'confirmado', confirmado_en = now(),
  gemini_raw = gemini_raw || jsonb_build_object(
    'monto_total', 1580.09,
    '_envio_a_mano', 90,
    'items', (select jsonb_agg(case when x->>'descripcion' = 'Moto envío' then jsonb_set(x, '{monto}', '90'::jsonb) else x end)
              from jsonb_array_elements(gemini_raw->'items') x),
    '_suma_a_mano_gerente', jsonb_build_object('total_escrito', 1920, 'adan_melchor', 1490.09,
      'el_fenix_cinta_87ede10d', 339.60, 'moto', 90),
    '_nota_alejandro', 'La gerente sumo a mano Adan Melchor ($1,490.09) + El Fenix del mismo dia (cinta de empaque $339.60, ticket 87ede10d aparte) + moto $90 = $1,920. Aqui solo cuenta Adan + moto $90. Bolsas metalizadas = Bodega (19-sep).')
where id = '65809be7-4f79-42e1-839c-11d43685c5e0' and estado = 'pendiente' and monto = 1920;
update alertas_tickets set resuelta = true,
  correccion = coalesce(correccion, '{}'::jsonb) || jsonb_build_object(
    'respuesta', 'Gerente (19-sep): el $1,920 junta Adan $1,490.09 + El Fenix $339.60 (ticket aparte) + moto $90. Queda Adan + moto $90 = $1,580.09.',
    'cerrada', '2026-09-19')
where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0' and not resuelta;
-- Precios de este ticket (misma regla que guardarPrecios: solo renglones en la unidad del producto).
delete from precio_historial where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0';
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha)
select distinct on (i.producto_catalogo_id) i.producto_catalogo_id, r.sucursal_id, r.id, i.monto / i.cantidad, r.fecha_ticket
from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id join catalogo_productos p on p.id = i.producto_catalogo_id
where r.id = '65809be7-4f79-42e1-839c-11d43685c5e0' and r.estado = 'confirmado' and i.monto > 0 and i.cantidad > 0
  and (p.unidad_default is null or i.unidad is null or i.unidad = p.unidad_default)
order by i.producto_catalogo_id, i.orden;

-- 2) Cinta de empaque de El Fenix 17-sep = Bodega; unidad "rollo" (12 rollos).
update ticket_items i set categoria_id = c.id, unidad = 'rollo'
from categorias_gasto c, registros_tickets r
where r.id = i.registro_ticket_id and r.id = '87ede10d-435a-4052-b47e-2cc35cb7ebbf'
  and c.nombre = 'Bodega' and c.sucursal_id = r.sucursal_id and i.descripcion ilike 'CINTA PARA EMPAQUE%';

-- 3) La misma cinta de El Iris 7-sep tambien venia en "pz": unidad "rollo" (la categoria no se toca).
update ticket_items i set unidad = 'rollo'
from registros_tickets r, catalogo_productos p
where r.id = i.registro_ticket_id and r.id::text like '7ccc2089%' and p.id = i.producto_catalogo_id
  and p.nombre = 'Cinta de empaque transparente 48x150' and i.unidad = 'pz';

-- 4) Historial de precios de esas dos cintas (faltaba por la unidad).
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha)
select i.producto_catalogo_id, r.sucursal_id, r.id, i.monto / i.cantidad, r.fecha_ticket
from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id join catalogo_productos p on p.id = i.producto_catalogo_id
where (r.id = '87ede10d-435a-4052-b47e-2cc35cb7ebbf' or r.id::text like '7ccc2089%') and r.estado = 'confirmado'
  and p.nombre = 'Cinta de empaque transparente 48x150' and i.unidad = p.unidad_default and i.monto > 0 and i.cantidad > 0
  and not exists (select 1 from precio_historial h where h.registro_ticket_id = r.id and h.producto_catalogo_id = i.producto_catalogo_id);
