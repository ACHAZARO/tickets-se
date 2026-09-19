-- 053: respuestas de Alejandro (18-sep noche) + correccion de 3 envios contados dos veces. Claude 2026-09-18.
-- 1) Adan Melchor 17-sep: son bolsas metalizadas (gasto de Bodega) y lo escrito a mano ($1,920) incluye el envio
--    ($429.91) que va a Otros gastos operativos.
-- 2) Adan Melchor es proveedor de confianza: sus compras repetidas no son duplicados ni fraude (comercios.confiable).
-- 3) Papel repetido (factura + ticket/remision, reimpresion, foto repetida del mismo papel): se queda RECHAZADO y va a
--    la revision de fraude junto con el original (si el gerente lo reporto dos veces, se le cobra). Desde hoy
--    procesar-ticket lo hace solo. Las fotos identicas (mismo archivo) siguen rechazandose sin ir a fraude.
-- 4) Motos del cafe: "MOTO" se funde en "Moto envio"; categoria por renglon (Ale/Polo/mama Polo/Toto = Extras).
create table if not exists respaldo.r053_tickets as
  select id, estado, monto, fecha_ticket, comercio, es_duplicado, duplicado_de, sospechoso, sospecha_origen, sospecha_estado,
         sospecha_grupo, sospecha_motivo, gemini_raw
  from registros_tickets where sucursal_id in ('fb61b496-894f-4706-98ec-ebb49513fcf3', '84a4c372-c6b8-481f-a700-374423348aa1');
create table if not exists respaldo.r053_items as
  select i.* from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
  where r.id::text like any (array['00fa617a%', '687d524a%', 'a1c09d93%', '65809be7%']);

-- Envio contado dos veces: el revisor ya lo tenia como renglon ("c/envio", "+envio") y 051 agrego otro.
delete from ticket_items i using registros_tickets r
where r.id = i.registro_ticket_id and r.id::text like any (array['00fa617a%', '687d524a%', 'a1c09d93%'])
  and i.descripcion = 'Moto envío' and r.gemini_raw ? '_envio_a_mano';
update registros_tickets set monto = monto - 60,
  gemini_raw = (gemini_raw - '_envio_a_mano') || jsonb_build_object('monto_total', monto - 60,
    'items', (select jsonb_agg(x) from jsonb_array_elements(gemini_raw->'items') x where x->>'descripcion' <> 'Moto envío'))
where id::text like any (array['00fa617a%', '687d524a%', 'a1c09d93%']) and gemini_raw ? '_envio_a_mano';

-- 1) Adan Melchor 17-sep.
insert into ticket_items (registro_ticket_id, descripcion, cantidad, unidad, monto, categoria_id, producto_catalogo_id, necesita_revision, orden)
select r.id, 'Moto envío', 1, 'servicio', 429.91,
  (select id from categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null limit 1),
  (select id from catalogo_productos where nombre = 'Moto envío' and sucursal_id = r.sucursal_id and activo limit 1),
  false, coalesce((select max(i.orden) from ticket_items i where i.registro_ticket_id = r.id), 0) + 1
from registros_tickets r where r.id::text like '65809be7%' and not (r.gemini_raw ? '_envio_a_mano');
update registros_tickets set monto = monto + 429.91,
  gemini_raw = gemini_raw || jsonb_build_object('monto_total', monto + 429.91, '_envio_a_mano', 429.91,
    '_nota_alejandro', 'Bolsas metalizadas de Adan Melchor, gasto de Bodega; el envio es gasto operativo (18-sep).',
    'items', (gemini_raw->'items') || '[{"descripcion": "Moto envío", "cantidad": 1, "unidad": "servicio", "monto": 429.91, "categoria": "Otros gastos operativos"}]'::jsonb)
where id::text like '65809be7%' and not (gemini_raw ? '_envio_a_mano');
update alertas_tickets a set resuelta = true,
  correccion = coalesce(a.correccion, '{}'::jsonb) || '{"respuesta": "Alejandro: bolsas metalizadas Adan Melchor, gasto de Bodega; la diferencia es envio (gasto operativo).", "cerrada": "2026-09-18"}'::jsonb
from registros_tickets r where r.id = a.registro_ticket_id and r.id::text like '65809be7%' and not a.resuelta;

-- 2) Proveedores de confianza.
alter table public.comercios add column if not exists confiable boolean not null default false;
comment on column public.comercios.confiable is 'Proveedor de confianza (Alejandro): sus compras repetidas no se marcan como duplicado ni fraude.';
update public.comercios set confiable = true where nombre ilike '%adan melchor%';
insert into public.comercios (nombre, sucursal_id, confiable)
select 'ADAN MELCHOR MORALES', s.id, true from sucursales s
where s.nombre in ('SANTA ELENA', 'WINGS PALACE')
  and not exists (select 1 from public.comercios c where c.sucursal_id = s.id and c.nombre ilike '%adan melchor%');

-- 3) Papeles repetidos a la revision de fraude (rechazados, en grupo con su original).
-- Primero, los rechazados de mayo-julio que se quedaron sin encabezado: fecha/comercio/monto de su lectura revisada.
update registros_tickets set fecha_ticket = (gemini_raw->>'fecha')::date, comercio = gemini_raw->>'comercio',
  monto = (gemini_raw->>'monto_total')::numeric, folio_ticket = coalesce(folio_ticket, gemini_raw->>'folio_ticket')
where estado = 'rechazado' and fecha_ticket is null and gemini_raw->'_revision'->>'lote' = 'wp_resto'
  and gemini_raw->>'fecha' ~ '^\d{4}-\d{2}-\d{2}$';
create temp table _par(d8 text, o8 text) on commit drop;
insert into _par values
  ('87ce5f9e', 'bc9bda1f'), ('e05ac7fc', '99a7d24c'), ('8d1240cc', '2deb711b'), ('d7ddf0cd', 'ac71b45d'), ('cf3c1566', '3e4ea1c7'),
  ('17ee27b6', '0a9071f1'), ('af6a8763', 'ebb49822'), ('658b6020', 'fee140ce'), ('ee4491c6', '07918aae'), ('11fc5f27', '3a6c7d5d'),
  ('a5b4e428', '5a1b9cd9'), ('e3e59de5', 'e96e57c9'), ('bf02ea57', 'a8c1b07a'), ('6eebeec7', '91e00a41'), ('65a99b31', '9c72df7b'),
  ('38aaf437', 'fae3bff4'), ('77b91b7f', 'c8f33137'), ('4734daea', '2be0bc3f'), ('07fc1c38', '793afd0a'), ('f074acf8', '3978d251'),
  ('169e9e1c', 'f5f8c397'), ('22f9f3a2', '00fa673f'), ('3198d371', '82672b5b'), ('f051feca', '64792177'), ('5a475fd0', 'aa08d085');
create temp table _p on commit drop as
select d.id did, o.id oid, coalesce(d.sospecha_grupo, o.sospecha_grupo, gen_random_uuid()) g
from _par p join registros_tickets d on d.id::text like p.d8 || '%' join registros_tickets o on o.id::text like p.o8 || '%';
update registros_tickets r set es_duplicado = true, duplicado_de = p.oid,
  sospechoso = true, sospecha_origen = coalesce(r.sospecha_origen, 'auto'), sospecha_estado = 'abierta', sospecha_grupo = p.g,
  sospecha_motivo = coalesce(nullif(r.sospecha_motivo, ''), 'Papel repetido de otro ticket ya contado.')
    || ' | 18-sep (Alejandro): papel repetido -> rechazado y en revision de fraude; si el gerente lo reporto dos veces, se le cobra.'
from _p p where r.id = p.did and r.estado = 'rechazado';
update registros_tickets r set sospechoso = true, sospecha_origen = coalesce(r.sospecha_origen, 'auto'), sospecha_estado = 'abierta',
  sospecha_grupo = p.g,
  sospecha_motivo = coalesce(nullif(r.sospecha_motivo, ''), 'Tiene un papel repetido (rechazado). Este si cuenta.')
from _p p where r.id = p.oid and (r.sospecha_grupo is null or r.sospecha_grupo = p.g);

-- 4) Motos del cafe: un solo producto "Moto envio" (la categoria va por renglon).
do $$ declare
  suc uuid := 'fb61b496-894f-4706-98ec-ebb49513fcf3';
  malo uuid; bueno uuid;
begin
  select id into malo from catalogo_productos where nombre = 'MOTO' and sucursal_id = suc and activo limit 1;
  select id into bueno from catalogo_productos where nombre = 'Moto envío' and sucursal_id = suc and activo limit 1;
  if malo is not null and bueno is not null then
    update catalogo_productos b set sinonimos = (select array_agg(distinct x) from unnest(b.sinonimos || m.sinonimos || array[m.nombre]) x)
      from catalogo_productos m where b.id = bueno and m.id = malo;
    update ticket_items set producto_catalogo_id = bueno where producto_catalogo_id = malo;
    update precio_historial set producto_catalogo_id = bueno where producto_catalogo_id = malo;
    update catalogo_productos set activo = false where id = malo;
  end if;
end $$;
