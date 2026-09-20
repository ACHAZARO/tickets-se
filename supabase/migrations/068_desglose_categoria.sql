-- 068: desglose de UNA categoria por producto (para la API: "de Bodega, cuanto en playo, bolsas, envios...").
-- Solo lo AUTORIZADO (tickets confirmados), con el mismo periodo/sucursal/cuenta que resumen_tickets, asi que el
-- total de la categoria coincide con `oficiales_por_categoria` del resumen. Producto = el del catalogo si el renglon
-- esta ligado; si no, la descripcion escrita. p_detalle = true agrega cada renglon (maximo 1000).
CREATE OR REPLACE FUNCTION public.desglose_categoria(
  p_desde date, p_hasta date, p_categoria text,
  p_sucursal uuid DEFAULT NULL, p_cuenta uuid DEFAULT NULL, p_detalle boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $function$
WITH b AS (
  SELECT i.id AS item_id, r.id AS ticket_id, r.fecha_ticket, r.comercio,
         COALESCE(c.nombre, 'Sin categoria')         AS categoria,
         COALESCE(c.cuenta_operativo, true)          AS cuenta_operativo,
         COALESCE(NULLIF(trim(p.nombre), ''), NULLIF(trim(i.descripcion), ''), '(sin descripcion)') AS producto,
         i.descripcion, i.cantidad, NULLIF(trim(i.unidad), '') AS unidad, COALESCE(i.monto, 0) AS monto
  FROM ticket_items i
  JOIN registros_tickets r ON r.id = i.registro_ticket_id AND r.estado = 'confirmado'
  JOIN sucursales s ON s.id = r.sucursal_id
  LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
  LEFT JOIN catalogo_productos p ON p.id = i.producto_catalogo_id
  WHERE lower(COALESCE(c.nombre, 'Sin categoria')) = lower(trim(p_categoria))
    AND (r.fecha_ticket BETWEEN p_desde AND p_hasta
         OR (r.fecha_ticket IS NULL
             AND (r.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_desde AND p_hasta))
    AND ((p_sucursal IS NULL AND s.activa AND NOT s.es_prueba) OR r.sucursal_id = p_sucursal)
    AND (p_cuenta IS NULL OR s.cuenta_id = p_cuenta)
),
tot AS (
  SELECT COALESCE(sum(monto), 0) AS monto, count(*) AS renglones, count(DISTINCT ticket_id) AS tickets,
         min(categoria) AS categoria, bool_and(cuenta_operativo) AS cuenta_operativo
  FROM b
),
prod AS (
  SELECT producto, count(*) AS renglones, round(sum(monto), 2) AS monto,
         (SELECT jsonb_agg(jsonb_build_object('unidad', u.unidad, 'cantidad', u.cant) ORDER BY u.cant DESC)
            FROM (SELECT unidad, sum(cantidad) AS cant FROM b b2 WHERE b2.producto = b.producto
                  GROUP BY unidad HAVING sum(cantidad) IS NOT NULL) u) AS cantidades
  FROM b GROUP BY producto
)
SELECT (jsonb_build_object(
  'categoria', COALESCE((SELECT categoria FROM tot WHERE renglones > 0), p_categoria),
  'cuenta_operativo', (SELECT cuenta_operativo FROM tot WHERE renglones > 0),
  'total', (SELECT jsonb_build_object('monto', round(monto, 2), 'renglones', renglones, 'tickets', tickets) FROM tot),
  'por_producto', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'producto', producto, 'monto', monto, 'renglones', renglones,
        'cantidades', COALESCE(cantidades, '[]'::jsonb),
        'pct_de_la_categoria', CASE WHEN (SELECT monto FROM tot) <> 0
                                    THEN round(100 * monto / (SELECT monto FROM tot), 1) END)
        ORDER BY monto DESC) FROM prod), '[]'::jsonb),
  'renglones', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'fecha' DESC, x->>'ticket_id') FROM (
        SELECT jsonb_build_object('fecha', fecha_ticket, 'comercio', comercio, 'ticket_id', ticket_id,
               'producto', producto, 'descripcion', descripcion, 'cantidad', cantidad, 'unidad', unidad,
               'monto', round(monto, 2)) AS x
        FROM b ORDER BY fecha_ticket DESC NULLS LAST, ticket_id, item_id LIMIT 1000) q), '[]'::jsonb),
  'renglones_truncados', (SELECT renglones FROM tot) > 1000
) - CASE WHEN p_detalle THEN ARRAY[]::text[] ELSE ARRAY['renglones', 'renglones_truncados'] END)
$function$;

-- Solo la edge function (service_role) la usa.
REVOKE EXECUTE ON FUNCTION public.desglose_categoria(date, date, text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desglose_categoria(date, date, text, uuid, uuid, boolean) TO service_role;
