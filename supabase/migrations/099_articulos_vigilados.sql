-- ============================================================
-- MIGRACION: 099 - Articulos VIGILADOS (10-oct-2026, decision Alejandro)
--  * catalogo_productos.vigilar: el articulo se compra seguido (sigue contando en gasto, Stock, Entradas y precios
--    como cualquier normal) pero cada ticket que lo traiga va a Por revisar: nunca se aprueba solo y el segundo
--    revisor IA tampoco lo aprueba. Es aparte de `uso` (094): un articulo puede ser normal u ocasional y ademas vigilado.
--  * catalogo_productos.vigilar_motivo: por que se vigila (texto libre para quien revisa; nunca se manda a la IA).
--  * alertas_tickets.tipo: nueva alerta 'articulo_vigilado' (la pone procesar/reprocesar-ticket, _shared/uso-articulos.ts).
-- Solo AGREGA columnas con default: sin articulos vigilados todo funciona igual que antes.
-- ============================================================

ALTER TABLE public.catalogo_productos
  ADD COLUMN IF NOT EXISTS vigilar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vigilar_motivo text;

ALTER TABLE public.alertas_tickets DROP CONSTRAINT IF EXISTS alertas_tickets_tipo_check;
ALTER TABLE public.alertas_tickets ADD CONSTRAINT alertas_tickets_tipo_check CHECK (tipo = ANY (ARRAY[
  'duplicado', 'posible_duplicado', 'ilegible', 'producto_no_reconocido', 'sin_unidad', 'sin_fecha', 'monto_anomalo',
  'precio_anomalo', 'ia_sin_leer', 'revisar_gerente', 'envio_alto', 'pagos_no_cuadran',
  'articulo_no_autorizado', 'articulo_ocasional', 'articulo_vigilado']));
