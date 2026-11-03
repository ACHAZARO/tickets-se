-- El papel dice tarjeta o transferencia y el gerente declaro que salio de la caja: lo decide una persona.
alter table public.alertas_tickets drop constraint if exists alertas_tickets_tipo_check;
alter table public.alertas_tickets add constraint alertas_tickets_tipo_check check (tipo = any (array[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha', 'monto_anomalo',
  'precio_anomalo', 'ia_sin_leer', 'revisar_gerente', 'envio_alto', 'pagos_no_cuadran', 'articulo_no_autorizado',
  'articulo_ocasional', 'articulo_vigilado', 'pago_distinto'
]));
