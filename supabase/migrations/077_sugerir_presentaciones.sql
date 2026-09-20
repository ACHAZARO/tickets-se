-- 077: el detector tambien propone AGRUPAR presentaciones del mismo insumo (076), no solo unificar (070).
--   * motivo 'presentacion': mismo nombre de identidad pero medidas distintas ("FRESA 907 G" / "FRESA 454 G",
--     "Tapa negra 16 oz" / "8 oz"). Antes se descartaban en silencio (071); ahora se preguntan aparte, porque
--     para el INVENTARIO si son el mismo insumo aunque cada tamano tenga su precio.
--   * cada par trae lo necesario para el formulario: cuanto trae cada presentacion (lo guardado o lo leido del
--     nombre) y una propuesta de nombre + unidad base del insumo.
--   * los pares que YA comparten insumo no se vuelven a preguntar.

-- Nombre propuesto para el insumo: el nombre mas corto sin su medida ("FRESA 907 G" -> "Fresa").
CREATE OR REPLACE FUNCTION public.nombre_insumo_sugerido(a text, b text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  WITH c AS (
    SELECT btrim(regexp_replace(regexp_replace(n,
             '\m[0-9]+(?:[.,][0-9]+)?\s*(kgs?|kilos?|kilogramos?|grs?|gramos?|g|lts?|litros?|l|mls?|mililitros?|ml|oz|onzas?|lbs?|pz|pzas?|piezas?)\M',
             ' ', 'gi'), '\s{2,}', ' ', 'g')) AS n
    FROM unnest(ARRAY[a, b]) AS n
  ), l AS (
    SELECT btrim(regexp_replace(n, '[\s(),/#-]+$', '')) AS n FROM c WHERE btrim(n) <> ''
  )
  SELECT COALESCE(
    (SELECT initcap(lower(n)) FROM l ORDER BY length(n), n LIMIT 1),
    initcap(lower(COALESCE(NULLIF(btrim(a), ''), btrim(b))))
  )
$function$;

CREATE OR REPLACE FUNCTION public.sugerir_unificaciones(p_sucursal uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $function$
WITH p AS (
  SELECT c.id, c.nombre, c.sucursal_id, c.categoria_id, c.unidad_default, c.insumo_id,
         COALESCE(c.sinonimos, '{}') AS sinonimos,
         c.contiene_cantidad, c.contiene_unidad,
         public.tokens_producto(c.nombre)  AS tn,
         public.numeros_producto(c.nombre) AS nums,
         public.leer_contenido(c.nombre)   AS leido
  FROM public.catalogo_productos c
  WHERE c.activo AND c.categoria_id IS NOT NULL
    AND (p_sucursal IS NULL OR c.sucursal_id IS NULL OR c.sucursal_id = p_sucursal)
),
sm AS (
  SELECT p.id, p.categoria_id, p.sucursal_id, public.tokens_producto(s) AS tk, public.numeros_producto(s) AS nm
  FROM p CROSS JOIN LATERAL unnest(p.sinonimos) AS s
),
cand AS (
  SELECT LEAST(a.id, m.id) AS x, GREATEST(a.id, m.id) AS y, 1 AS rango
  FROM sm m JOIN p a ON a.tn = m.tk AND a.id <> m.id AND cardinality(a.tn) > 0
       AND a.categoria_id = m.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM m.sucursal_id
  WHERE NOT (cardinality(m.nm) > 0 AND cardinality(a.nums) > 0 AND m.nm <> a.nums)
  UNION ALL
  SELECT a.id, b.id, 2
  FROM p a JOIN p b ON a.id < b.id AND a.tn = b.tn AND cardinality(a.tn) > 0
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT (cardinality(a.nums) > 0 AND cardinality(b.nums) > 0 AND a.nums <> b.nums)
  UNION ALL
  SELECT LEAST(g.id, b.id), GREATEST(g.id, b.id), 3
  FROM p g JOIN p b ON g.id <> b.id AND cardinality(g.tn) = 1 AND b.tn @> g.tn AND cardinality(b.tn) > 1
       AND g.categoria_id = b.categoria_id AND g.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT (cardinality(g.nums) > 0 AND cardinality(b.nums) > 0 AND g.nums <> b.nums)
  UNION ALL
  -- NUEVO: mismo insumo, distinto tamano
  SELECT a.id, b.id, 4
  FROM p a JOIN p b ON a.id < b.id AND a.tn = b.tn AND cardinality(a.tn) > 0
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE cardinality(a.nums) > 0 AND cardinality(b.nums) > 0 AND a.nums <> b.nums
),
par AS (
  SELECT cand.x, cand.y, min(cand.rango) AS rango FROM cand
  JOIN p pa ON pa.id = cand.x JOIN p pb ON pb.id = cand.y
  WHERE NOT EXISTS (SELECT 1 FROM public.unificaciones_descartadas d WHERE d.producto_a = cand.x AND d.producto_b = cand.y)
    AND NOT (pa.insumo_id IS NOT NULL AND pa.insumo_id = pb.insumo_id)   -- ya resuelto: mismo insumo
  GROUP BY cand.x, cand.y
),
uso AS (
  SELECT i.producto_catalogo_id AS id, count(*) AS usos,
         COALESCE(sum(i.monto) FILTER (WHERE r.estado = 'confirmado'), 0) AS gasto
  FROM public.ticket_items i JOIN public.registros_tickets r ON r.id = i.registro_ticket_id
  WHERE i.producto_catalogo_id IN (SELECT x FROM par UNION SELECT y FROM par)
  GROUP BY i.producto_catalogo_id
)
SELECT COALESCE(jsonb_agg(j ORDER BY (j->>'rango')::int, (j->>'gasto_total')::numeric DESC), '[]'::jsonb) FROM (
  SELECT jsonb_build_object(
    'motivo', CASE par.rango WHEN 1 THEN 'sinonimo' WHEN 2 THEN 'igual' WHEN 3 THEN 'parecido' ELSE 'presentacion' END,
    'rango', par.rango,
    'gasto_total', round(COALESCE(ua.gasto, 0) + COALESCE(ub.gasto, 0), 2),
    'categoria_id', a.categoria_id, 'sucursal_id', a.sucursal_id,
    -- propuesta para el formulario de "mismo insumo"
    'insumo_sugerido', public.nombre_insumo_sugerido(a.nombre, b.nombre),
    'unidad_base_sugerida', CASE
        WHEN COALESCE(a.contiene_unidad, a.leido->>'unidad', a.unidad_default) IN ('kg','g','gr')
          OR COALESCE(b.contiene_unidad, b.leido->>'unidad', b.unidad_default) IN ('kg','g','gr') THEN 'kg'
        WHEN COALESCE(a.contiene_unidad, a.leido->>'unidad', a.unidad_default) IN ('lt','l','ml','galon')
          OR COALESCE(b.contiene_unidad, b.leido->>'unidad', b.unidad_default) IN ('lt','l','ml','galon') THEN 'lt'
        ELSE 'pz' END,
    'a', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad_default,
           'usos', COALESCE(ua.usos, 0), 'gasto', round(COALESCE(ua.gasto, 0), 2),
           'insumo_id', a.insumo_id,
           'contiene', CASE WHEN a.contiene_cantidad IS NOT NULL
                            THEN jsonb_build_object('cantidad', a.contiene_cantidad, 'unidad', a.contiene_unidad)
                            ELSE a.leido END),
    'b', jsonb_build_object('id', b.id, 'nombre', b.nombre, 'unidad', b.unidad_default,
           'usos', COALESCE(ub.usos, 0), 'gasto', round(COALESCE(ub.gasto, 0), 2),
           'insumo_id', b.insumo_id,
           'contiene', CASE WHEN b.contiene_cantidad IS NOT NULL
                            THEN jsonb_build_object('cantidad', b.contiene_cantidad, 'unidad', b.contiene_unidad)
                            ELSE b.leido END)
  ) AS j
  FROM par JOIN p a ON a.id = par.x JOIN p b ON b.id = par.y
       LEFT JOIN uso ua ON ua.id = a.id LEFT JOIN uso ub ON ub.id = b.id
  ORDER BY par.rango, COALESCE(ua.gasto, 0) + COALESCE(ub.gasto, 0) DESC
  LIMIT 200
) q
$function$;
REVOKE EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) TO authenticated, service_role;
