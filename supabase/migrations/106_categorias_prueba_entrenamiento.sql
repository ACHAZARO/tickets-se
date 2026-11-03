-- 106 (2026-11-03): la cuenta PRUEBA ENTRENAMIENTO usaba categorias generales de la cuenta principal. Con el aislamiento (101) cada
-- cuenta tiene las suyas: se le copian y sus datos apuntan a la copia. Las de la cuenta principal no se tocan.
create temp table _mapa_cat on commit drop as
  select g.id as viejo, gen_random_uuid() as nuevo, g.nombre, g.orden, g.activa, g.cuenta_operativo
    from public.categorias_gasto g where g.sucursal_id is null and g.cuenta_id = 'c559a659-c170-4b04-8574-b7aac622f68c';
insert into public.categorias_gasto (id, nombre, orden, activa, sucursal_id, cuenta_operativo, cuenta_id)
select m.nuevo, m.nombre, m.orden, m.activa, null, m.cuenta_operativo, '1495f32b-9c38-4d10-938e-4cede062fab7' from _mapa_cat m
 where not exists (select 1 from public.categorias_gasto x where x.cuenta_id = '1495f32b-9c38-4d10-938e-4cede062fab7' and x.sucursal_id is null and lower(x.nombre) = lower(m.nombre));
create temp table _sucs_pe on commit drop as select id from public.sucursales where cuenta_id = '1495f32b-9c38-4d10-938e-4cede062fab7';
update public.ticket_items i set categoria_id = m.nuevo from _mapa_cat m, public.registros_tickets r where i.categoria_id = m.viejo and r.id = i.registro_ticket_id and r.sucursal_id in (select id from _sucs_pe);
update public.catalogo_productos p set categoria_id = m.nuevo from _mapa_cat m where p.categoria_id = m.viejo and p.sucursal_id in (select id from _sucs_pe);
update public.comercios c set categoria_id = m.nuevo from _mapa_cat m where c.categoria_id = m.viejo and c.sucursal_id in (select id from _sucs_pe);
update public.registros_tickets r set categoria_id = m.nuevo from _mapa_cat m where r.categoria_id = m.viejo and r.sucursal_id in (select id from _sucs_pe);
update public.presupuestos p set categoria_id = m.nuevo from _mapa_cat m where p.categoria_id = m.viejo and p.sucursal_id in (select id from _sucs_pe);
update public.objetivos_costo o set categoria_id = m.nuevo from _mapa_cat m where o.categoria_id = m.viejo and o.sucursal_id in (select id from _sucs_pe);
update public.cuenta_opciones o set categoria_extra_id = m.nuevo from _mapa_cat m where o.categoria_extra_id = m.viejo and o.cuenta_id = '1495f32b-9c38-4d10-938e-4cede062fab7';
