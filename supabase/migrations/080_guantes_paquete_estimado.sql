-- 080: el paquete de guantes de Walmart se registra en PIEZAS, estimadas por precio (Alejandro, 2026-09-20).
-- "Guantes" quedo unificado dentro de "Guantes desechables", pero sus dos compras venian en unidades distintas y
-- el inventario no podia sumarlas:
--   * Costco 3-jul: 400 pz por $612.75  ->  $1.5319 por pieza
--   * Walmart 20-jul: 1 "paquete" por $30, sin decir cuantas trae
-- Decision de Alejandro: estimar las piezas del paquete con el precio del otro: 30 / 1.5319 = 19.58 -> 20 pz.
-- Es una APROXIMACION a proposito (el gasto NO cambia: sigue siendo $30). Asi Entradas/Stock suman 420 pz.
-- El renglon original queda en respaldo.r080_guantes por si aparece el dato real del paquete.
CREATE TABLE IF NOT EXISTS respaldo.r080_guantes AS
  SELECT * FROM public.ticket_items WHERE id = '72d209c8-e4d5-48ec-8c51-e1f72212c5cf';

UPDATE public.ticket_items
   SET cantidad = 20, unidad = 'pz'
 WHERE id = '72d209c8-e4d5-48ec-8c51-e1f72212c5cf'
   AND monto = 30 AND unidad = 'paquete';   -- candado: solo si sigue como lo dejamos
