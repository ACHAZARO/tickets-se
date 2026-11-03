-- 113 (2026-11-03): una salida de caja puede comprobarse con varios tickets (una vuelta de compras). ticket_id es el primero, tickets_extra los demas.
alter table public.salidas_caja add column if not exists tickets_extra uuid[] not null default '{}';
