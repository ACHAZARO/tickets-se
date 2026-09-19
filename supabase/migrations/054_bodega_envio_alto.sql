-- 054: respuestas de Alejandro (18-sep, mas noche). Claude 2026-09-18.
-- 1) Categoria "Bodega" solo para el cafe Santa Elena (lo del tostador) y que NO cuenta en el gasto de
--    operacion, para que no se mezcle con el costo del cafe. Empieza con las bolsas metalizadas para cafe.
-- 2) Adan Melchor deja de ser proveedor de confianza (se revierte lo de 053): sus tickets pasan por las
--    reglas normales. Se quita comercios.confiable (el codigo ya no la usa).
-- 3) Adan Melchor 17-sep (65809be7): el envio de $429.91 es muy alto (la gerente dice que suele ser $60-80
--    y va a revisar la nota). Regresa a "por revisar" con la alerta de revisar con gerente abierta.
-- 4) Nuevo tipo de alerta 'envio_alto': procesar-ticket y reprocesar-ticket la crean cuando un envio es
--    mucho mas caro de lo normal con ese proveedor.
create table if not exists respaldo.r054_tickets as
  select id, estado, gemini_raw from registros_tickets where id = '65809be7-4f79-42e1-839c-11d43685c5e0';
create table if not exists respaldo.r054_alertas as
  select * from alertas_tickets where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0';
create table if not exists respaldo.r054_items as
  select i.id, i.categoria_id from ticket_items i join catalogo_productos p on p.id = i.producto_catalogo_id
  where p.nombre ilike 'bolsa metalizada%';
create table if not exists respaldo.r054_precios as
  select * from precio_historial where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0';
create table if not exists respaldo.r054_comercios as
  select id, nombre, sucursal_id, confiable from comercios where confiable;

-- 4) Tipo de alerta nuevo.
alter table alertas_tickets drop constraint alertas_tickets_tipo_check;
alter table alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha',
  'monto_anomalo', 'precio_anomalo', 'ia_sin_leer', 'revisar_gerente', 'envio_alto']));

-- 1) Bodega (cafe) y bolsas metalizadas.
insert into categorias_gasto (nombre, sucursal_id, cuenta_operativo, activa, orden)
select 'Bodega', s.id, false, true, (select coalesce(max(orden), 0) + 1 from categorias_gasto)
from sucursales s where s.nombre = 'SANTA ELENA'
  and not exists (select 1 from categorias_gasto c where c.nombre = 'Bodega' and c.sucursal_id = s.id);
update catalogo_productos p set categoria_id = c.id
from categorias_gasto c where c.nombre = 'Bodega' and c.sucursal_id = p.sucursal_id and p.nombre ilike 'bolsa metalizada%';
update ticket_items i set categoria_id = p.categoria_id
from catalogo_productos p where p.id = i.producto_catalogo_id and p.nombre ilike 'bolsa metalizada%'
  and i.categoria_id is distinct from p.categoria_id;

-- 2) Sin proveedores de confianza.
alter table public.comercios drop column if exists confiable;

-- 3) Adan Melchor 17-sep a revision.
update registros_tickets set estado = 'pendiente',
  gemini_raw = gemini_raw || jsonb_build_object('_nota_alejandro',
    'Bolsas metalizadas: gasto de Bodega. El envio de $429.91 esta en duda: con Adan Melchor suele ser $60-80; la gerente va a revisar la nota (18-sep).')
where id = '65809be7-4f79-42e1-839c-11d43685c5e0' and estado = 'confirmado';
delete from precio_historial where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0';
update alertas_tickets set resuelta = false,
  correccion = (coalesce(correccion, '{}'::jsonb) - 'cerrada' - 'respuesta') || jsonb_build_object(
    'motivo', 'Envio de $429.91 anotado a mano ("y envio $1,920"). Con Adan Melchor el envio suele ser $60-80: la gerente va a revisar la nota. Si fue menos, corrige el renglon "Moto envio" y el total.',
    'reabierta', '2026-09-18 (Alejandro)')
where registro_ticket_id = '65809be7-4f79-42e1-839c-11d43685c5e0' and tipo = 'revisar_gerente';
