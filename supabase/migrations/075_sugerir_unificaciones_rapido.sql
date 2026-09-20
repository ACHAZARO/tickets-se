-- 075: el detector de duplicados (070-072) tardaba 2 a 8 s y en produccion fallaba por limite de tiempo (500).
-- Causas: (a) no habia indice por producto en ticket_items / precio_historial / consumo_inventario, asi que cada
-- producto recorria toda la tabla; (b) se comparaban TODOS los pares y por cada par se re-tokenizaban los sinonimos.
-- Ahora: indices + candidatos por joins baratos (nombre igual / sinonimo con la identidad del otro / palabra generica),
-- los sinonimos se tokenizan una sola vez y el gasto se calcula solo para los productos de los pares que sobreviven.
-- Mismo resultado que 072 (mismas reglas); solo mas rapido.
CREATE INDEX IF NOT EXISTS idx_ticket_items_producto     ON public.ticket_items (producto_catalogo_id);
CREATE INDEX IF NOT EXISTS idx_precio_historial_producto ON public.precio_historial (producto_catalogo_id);
CREATE INDEX IF NOT EXISTS idx_consumo_inventario_producto ON public.consumo_inventario (producto_catalogo_id);

CREATE OR REPLACE FUNCTION public.sugerir_unificaciones(p_sucursal uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $function$
WITH p AS (
  SELECT c.id, c.nombre, c.sucursal_id, c.categoria_id, c.unidad_default, COALESCE(c.sinonimos, '{}') AS sinonimos,
         public.tokens_producto(c.nombre)  AS tn,
         public.numeros_producto(c.nombre) AS nums
  FROM public.catalogo_productos c
  WHERE c.activo AND c.categoria_id IS NOT NULL
    AND (p_sucursal IS NULL OR c.sucursal_id IS NULL OR c.sucursal_id = p_sucursal)
),
sm AS (   -- cada sinonimo tokenizado UNA vez
  SELECT p.id, p.categoria_id, p.sucursal_id, public.tokens_producto(s) AS tk, public.numeros_producto(s) AS nm
  FROM p CROSS JOIN LATERAL unnest(p.sinonimos) AS s
),
cand AS (
  -- 'sinonimo': un sinonimo de X tiene la identidad del nombre de A (sin medidas contradictorias)
  SELECT LEAST(a.id, m.id) AS x, GREATEST(a.id, m.id) AS y, 1 AS rango
  FROM sm m JOIN p a ON a.tn = m.tk AND a.id <> m.id AND cardinality(a.tn) > 0
       AND a.categoria_id = m.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM m.sucursal_id
  WHERE NOT (cardinality(m.nm) > 0 AND cardinality(a.nums) > 0 AND m.nm <> a.nums)
  UNION ALL
  -- 'igual': mismo nombre sin tamanos/plurales y sin medidas distintas
  SELECT a.id, b.id, 2
  FROM p a JOIN p b ON a.id < b.id AND a.tn = b.tn AND cardinality(a.tn) > 0
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT (cardinality(a.nums) > 0 AND cardinality(b.nums) > 0 AND a.nums <> b.nums)
  UNION ALL
  -- 'parecido': el nombre corto es UNA palabra contenida en el otro
  SELECT LEAST(g.id, b.id), GREATEST(g.id, b.id), 3
  FROM p g JOIN p b ON g.id <> b.id AND cardinality(g.tn) = 1 AND b.tn @> g.tn AND cardinality(b.tn) > 1
       AND g.categoria_id = b.categoria_id AND g.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT (cardinality(g.nums) > 0 AND cardinality(b.nums) > 0 AND g.nums <> b.nums)
),
par AS (
  SELECT x, y, min(rango) AS rango FROM cand
  WHERE NOT EXISTS (SELECT 1 FROM public.unificaciones_descartadas d WHERE d.producto_a = cand.x AND d.producto_b = cand.y)
  GROUP BY x, y
),
uso AS (  -- gasto solo de los productos que aparecen en algun par
  SELECT i.producto_catalogo_id AS id, count(*) AS usos,
         COALESCE(sum(i.monto) FILTER (WHERE r.estado = 'confirmado'), 0) AS gasto
  FROM public.ticket_items i JOIN public.registros_tickets r ON r.id = i.registro_ticket_id
  WHERE i.producto_catalogo_id IN (SELECT x FROM par UNION SELECT y FROM par)
  GROUP BY i.producto_catalogo_id
)
SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'rango')::int, (j->>'gasto_total')::numeric DESC), '[]'::jsonb) FROM (
  SELECT jsonb_build_object(
    'motivo', CASE par.rango WHEN 1 THEN 'sinonimo' WHEN 2 THEN 'igual' ELSE 'parecido' END,
    'rango', par.rango,
    'gasto_total', round(COALESCE(ua.gasto, 0) + COALESCE(ub.gasto, 0), 2),
    'categoria_id', a.categoria_id, 'sucursal_id', a.sucursal_id,
    'a', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad_default, 'usos', COALESCE(ua.usos, 0), 'gasto', round(COALESCE(ua.gasto, 0), 2)),
    'b', jsonb_build_object('id', b.id, 'nombre', b.nombre, 'unidad', b.unidad_default, 'usos', COALESCE(ub.usos, 0), 'gasto', round(COALESCE(ub.gasto, 0), 2))
  ) AS j
  FROM par JOIN p a ON a.id = par.x JOIN p b ON b.id = par.y
       LEFT JOIN uso ua ON ua.id = a.id LEFT JOIN uso ub ON ub.id = b.id
  ORDER BY par.rango, COALESCE(ua.gasto, 0) + COALESCE(ub.gasto, 0) DESC
  LIMIT 200
) q
$function$;
REVOKE EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) TO authenticated, service_role;
