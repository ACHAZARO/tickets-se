-- 052: Santa Elena. "PLAYO COMIDA" mezclaba dos presentaciones (El Bodegon: Polpusa 18" x1000 ft cal 60 a ~$131;
-- Adan Melchor: Reyma 18 cal 80 x1300 ft a ~$288-320) y daba un "aumento" falso de 120% en Precios. Se separan.
-- "Moto (envio)" (Extras, viejo) se funde en "Moto envio" (Otros gastos operativos). Claude 2026-09-18.
-- Despues de 050/051 (envios) se reconstruyo tambien el historial de precios de ambas sucursales.
do $$ declare
  suc uuid := 'fb61b496-894f-4706-98ec-ebb49513fcf3';
  cat_des uuid := (select id from categorias_gasto where nombre = 'Desechables' and sucursal_id is null limit 1);
  playo uuid; reyma uuid; env_viejo uuid; env uuid;
begin
  select id into playo from catalogo_productos where nombre = 'PLAYO COMIDA' and sucursal_id = suc and activo limit 1;
  if playo is not null then
    insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id, activo)
    values ('Playo stretch Reyma 18 cal 80 1300 ft', array['STRETCH 18 CAL 80 PIES 1300 REYMA', 'STRECH 18 CAL 80 PIES 1300 REYMA'], cat_des, 'pz', suc, true)
    returning id into reyma;
    update catalogo_productos set nombre = 'Playo stretch Polpusa 18 cal 60 1000 ft',
      sinonimos = array(select x from unnest(sinonimos) x where x not ilike '%1300%' and x not ilike '%reyma%')
      where id = playo;
    update ticket_items set producto_catalogo_id = reyma where producto_catalogo_id = playo and (descripcion ilike '%1300%' or descripcion ilike '%reyma%');
  end if;
  select id into env_viejo from catalogo_productos where nombre = 'Moto (envio)' and sucursal_id = suc and activo limit 1;
  select id into env from catalogo_productos where nombre = 'Moto envío' and sucursal_id = suc and activo limit 1;
  if env_viejo is not null and env is not null then
    update catalogo_productos b set sinonimos = (select array_agg(distinct x) from unnest(b.sinonimos || m.sinonimos || array[m.nombre]) x)
      from catalogo_productos m where b.id = env and m.id = env_viejo;
    update ticket_items set producto_catalogo_id = env where producto_catalogo_id = env_viejo;
    update precio_historial set producto_catalogo_id = env where producto_catalogo_id = env_viejo;
    update catalogo_productos set activo = false where id = env_viejo;
  end if;
end $$;

delete from precio_historial where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3';
insert into precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha, created_at)
select distinct on (r.id, i.producto_catalogo_id)
  i.producto_catalogo_id, r.sucursal_id, r.id, round(i.monto / i.cantidad, 4), r.fecha_ticket, coalesce(r.confirmado_en, r.created_at)
from ticket_items i
join registros_tickets r on r.id = i.registro_ticket_id
join catalogo_productos p on p.id = i.producto_catalogo_id
where r.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' and r.estado = 'confirmado'
  and i.monto > 0 and i.cantidad > 0
  and (i.unidad is null or p.unidad_default is null or lower(i.unidad) = lower(p.unidad_default))
order by r.id, i.producto_catalogo_id, i.orden;
with m as (
  select producto_catalogo_id, percentile_cont(0.5) within group (order by precio_unitario) med, count(*) n
  from precio_historial where sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' group by 1
)
delete from precio_historial h using m
where h.producto_catalogo_id = m.producto_catalogo_id and h.sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and m.n >= 4 and (h.precio_unitario > m.med * 3 or h.precio_unitario < m.med / 3);
