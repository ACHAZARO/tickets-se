-- 031: categoria "Otros gastos operativos" (decision Alejandro 2026-09-18).
-- Gastos necesarios para operar que no son insumos, gas, luz, limpieza ni desechables:
--   * Moto servicio (lleva insumos al restaurante)  -> Otros gastos operativos
--     (envio tipo "Ale moto" = comida enviada al dueño pagada por la sucursal -> Extras, NO operativo;
--      "moto + otro nombre" -> preguntar a Alejandro / dejar a revision)
--   * Vacaciones / prima vacacional (no es la nomina corriente) -> Otros gastos operativos
--   * Viaje de agua (pipa) -> Otros gastos operativos. MONITOREAR frecuencia: posible robo hormiga.

-- Respaldo de lo que cambia (esquema no expuesto por la API).
create table if not exists respaldo.r031_items as
  select i.id, i.categoria_id from public.ticket_items i
  join public.registros_tickets r on r.id = i.registro_ticket_id
  where r.sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1'
    and i.descripcion ~* 'viaje.{0,4}agua' and r.estado = 'confirmado';
create table if not exists respaldo.r031_catalogo as
  select id, nombre, sinonimos, categoria_id, unidad_default from public.catalogo_productos
  where id = '7e0b9d08-50b3-43f2-a107-39db7cdf82fc';

insert into public.categorias_gasto (nombre, orden, activa, sucursal_id, cuenta_operativo)
select 'Otros gastos operativos', 8, true, null, true
where not exists (select 1 from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null);

-- Viaje de agua: producto existente (WP) pasa a Otros gastos operativos, con sinonimos vistos en tickets.
update public.catalogo_productos
set categoria_id = (select id from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null),
    unidad_default = 'viaje',
    sinonimos = array(select distinct unnest(sinonimos || array[
      'VIAJE DE AGUA 10,000', 'Viaje de agua de 10,000 litros', 'Viaje de agua', 'Viaje d''Agua 10,000 L.', 'Pipa de agua'
    ]))
where id = '7e0b9d08-50b3-43f2-a107-39db7cdf82fc';

-- Renglones YA confirmados de viaje de agua en WP (estaban en Insumos/Extras).
update public.ticket_items i
set categoria_id = (select id from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null),
    producto_catalogo_id = '7e0b9d08-50b3-43f2-a107-39db7cdf82fc'
from respaldo.r031_items b
where i.id = b.id;

-- Moto servicio (solo Wings Palace por ahora; en Santa Elena "MOTO" esta pendiente de decidir).
insert into public.catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select 'Moto servicio', array['Moto Servicio', 'Mto Servicio', 'Moto Sercicio', 'Moto servicio'],
  (select id from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null),
  'servicio', '84a4c372-c6b8-481f-a700-374423348aa1'
where not exists (select 1 from public.catalogo_productos where nombre = 'Moto servicio' and sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1');

-- Vacaciones / prima vacacional (global).
insert into public.catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select 'Vacaciones y prima vacacional', array['Vacaciones', 'Prima Vacacional', 'Prima vacacional'],
  (select id from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null),
  'pago', null
where not exists (select 1 from public.catalogo_productos where nombre = 'Vacaciones y prima vacacional');
