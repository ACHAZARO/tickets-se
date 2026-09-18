-- 032: alerta 'revisar_gerente' ("Revisar con gerente") + reglas de moto (decision Alejandro 2026-09-18).
-- 'revisar_gerente' = hay que preguntarle al gerente; el motivo va en alertas_tickets.correccion->>'motivo'.

alter table public.alertas_tickets drop constraint if exists alertas_tickets_tipo_check;
alter table public.alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad',
  'sin_fecha', 'monto_anomalo', 'precio_anomalo', 'ia_sin_leer', 'revisar_gerente'
]));

-- WP: "moto + otro nombre" -> Extras (no operativo) y revisar con gerente.
insert into public.alertas_tickets (registro_ticket_id, tipo, correccion)
select v.ticket::uuid, 'revisar_gerente', jsonb_build_object('motivo', v.motivo)
from (values
  ('abef7643-fa26-4af7-9ac5-f46cce0ac137', 'Moto con nombre ("Motos Servicios de Marquez escobar y steven", $110): ¿insumos (Otros gastos operativos) o envio (Extras)? Por ahora en Extras.'),
  ('534a9e31-73ef-4ee8-af75-0b9dff63655d', 'Moto con nombre ("Moto servicio Fav Villarroel", $100): ¿insumos (Otros gastos operativos) o envio (Extras)? Por ahora en Extras.')
) as v(ticket, motivo)
where not exists (
  select 1 from public.alertas_tickets a where a.registro_ticket_id = v.ticket::uuid and a.tipo = 'revisar_gerente' and not a.resuelta
);

update public.ticket_items
set categoria_id = (select id from public.categorias_gasto where nombre = 'Extras' and sucursal_id is null)
where id in ('e8829bcb-7066-4ed9-a1a2-37791a886ae9', '2e0a6de5-4476-4f28-84db-217fd04a9719');

-- Santa Elena: "MOTO" = envio -> Extras; "Moto insumos" -> Otros gastos operativos.
insert into public.catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select 'Moto (envio)', array['MOTO', 'MOTO 1', 'MOTO 2', 'MOTO1', 'Moto', 'Envio cliente', 'Envio Ale', 'Envio mama Polo'],
  (select id from public.categorias_gasto where nombre = 'Extras' and sucursal_id is null),
  'servicio', 'fb61b496-894f-4706-98ec-ebb49513fcf3'
where not exists (select 1 from public.catalogo_productos where nombre = 'Moto (envio)' and sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3');

insert into public.catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select 'Moto insumos', array['MOTO INSUMOS', 'Moto compra insumos'],
  (select id from public.categorias_gasto where nombre = 'Otros gastos operativos' and sucursal_id is null),
  'servicio', 'fb61b496-894f-4706-98ec-ebb49513fcf3'
where not exists (select 1 from public.catalogo_productos where nombre = 'Moto insumos' and sucursal_id = 'fb61b496-894f-4706-98ec-ebb49513fcf3');

-- WP: envio de comida al dueño pagado por la sucursal -> Extras.
insert into public.catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id)
select 'Envio al dueño (Ale moto)', array['Ale moto', 'Envio Ale', 'Envio a Ale'],
  (select id from public.categorias_gasto where nombre = 'Extras' and sucursal_id is null),
  'servicio', '84a4c372-c6b8-481f-a700-374423348aa1'
where not exists (select 1 from public.catalogo_productos where nombre = 'Envio al dueño (Ale moto)' and sucursal_id = '84a4c372-c6b8-481f-a700-374423348aa1');
