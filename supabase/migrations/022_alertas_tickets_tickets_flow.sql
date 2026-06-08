-- Consolidacion de revision en /admin/tickets.
-- Amplia los tipos de alerta que ya genera el backend y permite mostrar
-- fecha asumida / productos nuevos sin romper el CHECK constraint.

alter table public.alertas_tickets
  drop constraint if exists alertas_tickets_tipo_check;

alter table public.alertas_tickets
  add constraint alertas_tickets_tipo_check check (tipo in (
    'duplicado',
    'posible_duplicado',
    'ilegible',
    'producto_no_reconocido',
    'sin_unidad',
    'sin_fecha',
    'monto_anomalo',
    'precio_anomalo'
  ));
