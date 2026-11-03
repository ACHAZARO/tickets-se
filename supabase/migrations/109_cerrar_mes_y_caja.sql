-- 109_cerrar_mes_y_caja.sql (2026-11-03, Claude; PLAN_BETA_AMIGOS.md)
-- 1) Cerrar mes: un ticket que llega tarde se va al mes de su fecha y, si se aprobaba solo, cambiaba un mes ya cuadrado sin avisar.
--    Con el mes cerrado no se aprueba solo: va a Por revisar con la alerta mes_cerrado y el dueno decide.
-- 2) Tickets faltantes: el reporte de caja del punto de venta (salidas) contra los tickets subidos. Lo que el dueno aclara una vez
--    ("no lleva ticket", "este es su ticket") se queda guardado. Se puede volver a subir el mismo reporte: la huella evita repetidos.

alter table public.alertas_tickets drop constraint if exists alertas_tickets_tipo_check;
alter table public.alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha', 'monto_anomalo',
  'precio_anomalo', 'ia_sin_leer', 'revisar_gerente', 'envio_alto', 'pagos_no_cuadran', 'articulo_no_autorizado',
  'articulo_ocasional', 'articulo_vigilado', 'pago_distinto', 'nota_a_mano', 'cuenta_a_mano', 'mes_cerrado'
]));

create table if not exists public.meses_cerrados (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),
  cerrado_por uuid references auth.users(id) on delete set null,
  cerrado_en timestamptz not null default now(),
  primary key (cuenta_id, mes)
);
alter table public.meses_cerrados enable row level security;
drop policy if exists cuenta_meses_cerrados on public.meses_cerrados;
create policy cuenta_meses_cerrados on public.meses_cerrados for all to authenticated
  using (cuenta_id = (select public.mi_cuenta())) with check (cuenta_id = (select public.mi_cuenta()));
revoke all on public.meses_cerrados from anon;

create table if not exists public.salidas_caja (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null default public.mi_cuenta() references public.cuentas(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  fecha date not null,
  hora text,
  concepto text,
  monto numeric not null check (monto > 0),
  empleado text,
  huella text not null,
  no_lleva boolean not null default false,
  ticket_id uuid references public.registros_tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cuenta_id, huella)
);
create index if not exists salidas_caja_cuenta_fecha_idx on public.salidas_caja (cuenta_id, fecha);
alter table public.salidas_caja enable row level security;
drop policy if exists cuenta_salidas_caja on public.salidas_caja;
create policy cuenta_salidas_caja on public.salidas_caja for all to authenticated
  using (cuenta_id = (select public.mi_cuenta()))
  with check (cuenta_id = (select public.mi_cuenta()) and sucursal_id in (select public.mis_sucursales()));
revoke all on public.salidas_caja from anon;

-- Conceptos que el dueno dijo que no llevan ticket (propinas, bonos...): la siguiente vez ya no se preguntan.
alter table public.cuenta_opciones add column if not exists conceptos_sin_ticket text[] not null default '{}';
