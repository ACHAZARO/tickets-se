-- 081: reporte TICKET POR TICKET (para cuadrar contra el punto de venta / su API).
-- Un elemento por ticket: folio, comercio, sucursal, fecha del ticket, fecha de captura (subida, hora de Mexico),
-- estado, total y su desglose por articulo (producto, cantidad, unidad, monto, categoria). Los descuentos son
-- renglones de la categoria Descuentos en negativo, asi que el desglose suma al total.
-- Mismo periodo/sucursal/cuenta que resumen_tickets (fecha del ticket; sin fecha, la de subida).
-- p_estado: 'confirmado' (default = oficiales) o 'todos'. Maximo 5000 tickets (`truncado` avisa).
-- La usan la edge function api-cuentas (service_role) y el Excel del panel (admin; RLS + is_admin()).
CREATE OR REPLACE FUNCTION public.reporte_tickets(
  p_desde date, p_hasta date,
  p_sucursal uuid DEFAULT NULL, p_cuenta uuid DEFAULT NULL, p_estado text DEFAULT 'confirmado'
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $function$
WITH t AS (
  SELECT r.id, r.folio_ticket, r.comercio, r.fecha_ticket, r.estado, r.monto,
         s.slug AS sucursal_slug, s.nombre AS sucursal_nombre,
         to_char(r.created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') AS capturado
  FROM registros_tickets r
  JOIN sucursales s ON s.id = r.sucursal_id
  WHERE (auth.role() = 'service_role' OR is_admin())
    AND (p_estado = 'todos' OR r.estado = 'confirmado')
    AND (r.fecha_ticket BETWEEN p_desde AND p_hasta
         OR (r.fecha_ticket IS NULL
             AND (r.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_desde AND p_hasta))
    AND ((p_sucursal IS NULL AND s.activa AND NOT s.es_prueba) OR r.sucursal_id = p_sucursal)
    AND (p_cuenta IS NULL OR s.cuenta_id = p_cuenta)
),
lim AS (
  SELECT * FROM t ORDER BY COALESCE(fecha_ticket, capturado::date), capturado, id LIMIT 5000
),
art AS (
  SELECT i.registro_ticket_id AS ticket_id,
         jsonb_agg(jsonb_build_object(
           'producto', COALESCE(NULLIF(trim(p.nombre), ''), NULLIF(trim(i.descripcion), ''), '(sin descripcion)'),
           'descripcion', i.descripcion,
           'cantidad', i.cantidad,
           'unidad', NULLIF(trim(i.unidad), ''),
           'monto', round(COALESCE(i.monto, 0), 2),
           'categoria', COALESCE(c.nombre, 'Sin categoria'))
           ORDER BY i.orden NULLS LAST, i.created_at, i.id) AS articulos,
         round(sum(COALESCE(i.monto, 0)), 2) AS suma
  FROM ticket_items i
  JOIN lim ON lim.id = i.registro_ticket_id
  LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
  LEFT JOIN catalogo_productos p ON p.id = i.producto_catalogo_id
  GROUP BY i.registro_ticket_id
)
SELECT jsonb_build_object(
  'estado', CASE WHEN p_estado = 'todos' THEN 'todos' ELSE 'confirmado' END,
  'total', jsonb_build_object(
     'tickets', (SELECT count(*) FROM t),
     'monto', (SELECT round(COALESCE(sum(monto), 0), 2) FROM t)),
  'truncado', (SELECT count(*) FROM t) > 5000,
  'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'ticket_id', lim.id,
       'folio', NULLIF(trim(lim.folio_ticket), ''),
       'comercio', lim.comercio,
       'sucursal', lim.sucursal_slug,
       'sucursal_nombre', lim.sucursal_nombre,
       'fecha_ticket', lim.fecha_ticket,
       'fecha_captura', lim.capturado,
       'estado', lim.estado,
       'total', round(COALESCE(lim.monto, 0), 2),
       'suma_articulos', COALESCE(art.suma, 0),
       'articulos', COALESCE(art.articulos, '[]'::jsonb))
     ORDER BY COALESCE(lim.fecha_ticket, lim.capturado::date), lim.capturado, lim.id)
     FROM lim LEFT JOIN art ON art.ticket_id = lim.id), '[]'::jsonb)
)
$function$;

REVOKE EXECUTE ON FUNCTION public.reporte_tickets(date, date, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporte_tickets(date, date, uuid, uuid, text) TO authenticated, service_role;
