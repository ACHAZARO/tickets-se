-- 073: lo propio de cada negocio sale del codigo compartido y vive como DATO por cuenta/sucursal. Claude 2026-09-20.
-- Motivo (Alejandro): la app se va a vender a otros locales; lo que la IA sabe de Wings Palace y del cafe Santa Elena no
-- debe afectar a otros negocios. Antes estaban escritos en _shared/gemini.ts los nombres de los negocios, la regla de
-- motos de la familia y la regla de Bodega; y en _shared/duplicados.ts las palabras 'wings','palace','santa','elena'.
-- Ahora el codigo solo trae reglas universales y lee de aqui:
--   * sucursales.nombres_cliente: como aparece el negocio (el que COMPRA) en los tickets.
--   * reglas_ia: reglas de lectura propias del negocio. sucursal_id NULL = todas las sucursales de esa cuenta.
alter table public.sucursales add column if not exists nombres_cliente text[] not null default '{}';
comment on column public.sucursales.nombres_cliente is
  'Como aparece este negocio como CLIENTE en los tickets (para que la IA no lo confunda con el proveedor). Vacio = usa el nombre.';

create table if not exists public.reglas_ia (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  titulo text not null,
  texto text not null,
  activa boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.reglas_ia is
  'Reglas de lectura de tickets PROPIAS de un negocio. Se agregan al final del prompt de la IA solo para las sucursales de esa cuenta (sucursal_id NULL = todas). Nunca escribir reglas de un negocio en el codigo compartido.';
create index if not exists reglas_ia_cuenta_idx on public.reglas_ia (cuenta_id, sucursal_id) where activa;
alter table public.reglas_ia enable row level security;
drop policy if exists admin_all_reglas_ia on public.reglas_ia;
create policy admin_all_reglas_ia on public.reglas_ia for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.reglas_ia from anon;

-- Como aparecen nuestros negocios en los tickets (antes escrito en el prompt).
update public.sucursales set nombres_cliente = array['Santa Elena', 'Cafe Santa Elena']
  where id = 'fb61b496-894f-4706-98ec-ebb49513fcf3' and nombres_cliente = '{}';
update public.sucursales set nombres_cliente = array['Wings Palace', 'Restaurant Wings Palace']
  where id = '84a4c372-c6b8-481f-a700-374423348aa1' and nombres_cliente = '{}';

-- Reglas que estaban en el prompt compartido (mismo texto).
insert into public.reglas_ia (cuenta_id, sucursal_id, titulo, texto, orden)
select s.cuenta_id, null, 'Motos del dueno y su familia', $r$MOTOS DEL DUENO: un servicio de moto o de envio para el dueno o su familia (dice "Ale", "Polo", "mama Polo" o "Toto") va con "categoria": "Extras"; cualquier otra moto o envio va en "Otros gastos operativos".$r$, 10
from public.sucursales s where s.id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and not exists (select 1 from public.reglas_ia r where r.titulo = 'Motos del dueno y su familia' and r.cuenta_id = s.cuenta_id);
insert into public.reglas_ia (cuenta_id, sucursal_id, titulo, texto, orden)
select s.cuenta_id, s.id, 'Bodega (tostador)', $r$BODEGA (solo si "Bodega" esta en las categorias validas): cuenta SOLO la palabra "Bodega" ESCRITA A MANO sobre el papel (otra tinta o lapiz, en el margen o junto a un renglon); NO cuenta impresa en el nombre del proveedor ("EL BODEGON DE SEMILLAS", "BODEGA AURRERA") ni en campos impresos como almacen, bodega de salida o sucursal. Si esta a mano manda sobre los renglones que senala (llave, circulo, flecha o escrita a un lado); si esta en el encabezado sin senalar renglones, aplicala a todo el ticket solo cuando todos los renglones son material de empaque del tostador, y si no, solo a los de empaque. El renglon de "Moto envio" va en "Bodega" SOLO cuando todo lo demas del ticket es material de Bodega (el flete de esa entrega tambien es de Bodega); si el ticket mezcla cafeteria y Bodega, el envio va en "Otros gastos operativos". Un renglon de "Descuento" sigue la categoria de la compra a la que le baja el precio. Aunque nadie lo escriba, van siempre en "Bodega" las bolsas metalizadas para cafe (empaque del cafe en grano del tostador), la cinta de empaque canela o transparente de 48 mm con su despachador (no la cinta de aislar ni la de teflon) y el playo stretch o "strech" en rollo de 18 pulgadas de 1000 o 1300 pies (Polpusa, Reyma). El clingfilm o pelicula para alimentos de 30 cm NO es de Bodega aunque su descripcion diga "playo": va en "Desechables", salvo que ese renglon este marcado a mano. Si "Bodega" no esta en la lista de categorias validas, ignora la anotacion a mano y clasifica cada renglon por si mismo; esos empaques del tostador van en "Desechables".$r$, 20
from public.sucursales s where s.id = 'fb61b496-894f-4706-98ec-ebb49513fcf3'
  and not exists (select 1 from public.reglas_ia r where r.titulo = 'Bodega (tostador)' and r.sucursal_id = s.id);
