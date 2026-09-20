-- 071: el detector de duplicados (070) marcaba de mas: "Tapa 14 oz" / "Tapa 16 oz", "Bolsa de papel #10" / "#14",
-- "XX Lager 1x20 325ml" / "1x12 1.18L" son PRESENTACIONES distintas, no el mismo producto repetido.
--  * Si los dos nombres traen medidas y son distintas -> no se sugiere (salvo que uno ya sea sinonimo del otro).
--  * "parecido" solo cuando el nombre corto es UNA palabra generica contenida en el otro ("Mantequilla" / "Mantequilla Gloria 1 kg").
CREATE OR REPLACE FUNCTION public.numeros_producto(p_texto text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}'::text[]) FROM (
    SELECT DISTINCT replace((regexp_matches(COALESCE(p_texto, ''), '[0-9]+(?:[.,][0-9]+)?', 'g'))[1], ',', '.') AS x
  ) s
$$;

CREATE OR REPLACE FUNCTION public.sugerir_unificaciones(p_sucursal uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $function$
WITH p AS (
  SELECT c.id, c.nombre, c.sucursal_id, c.categoria_id, c.unidad_default, COALESCE(c.sinonimos, '{}') AS sinonimos,
         public.tokens_producto(c.nombre)  AS tn,
         public.numeros_producto(c.nombre) AS nums,
         COALESCE(u.usos, 0) AS usos, COALESCE(u.gasto, 0) AS gasto
  FROM public.catalogo_productos c
  LEFT JOIN LATERAL (
    SELECT count(*) AS usos, sum(i.monto) FILTER (WHERE r.estado = 'confirmado') AS gasto
    FROM public.ticket_items i JOIN public.registros_tickets r ON r.id = i.registro_ticket_id
    WHERE i.producto_catalogo_id = c.id) u ON true
  WHERE c.activo AND c.categoria_id IS NOT NULL
    AND (p_sucursal IS NULL OR c.sucursal_id IS NULL OR c.sucursal_id = p_sucursal)
),
par AS (
  SELECT a.id AS a_id, b.id AS b_id,
    -- medidas incompatibles: las dos traen medidas y no son las mismas
    (cardinality(a.nums) > 0 AND cardinality(b.nums) > 0 AND a.nums <> b.nums) AS medidas_distintas,
    CASE WHEN cardinality(a.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(b.sinonimos) s WHERE public.tokens_producto(s) = a.tn) THEN 'sinonimo'
         WHEN cardinality(b.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(a.sinonimos) s WHERE public.tokens_producto(s) = b.tn) THEN 'sinonimo'
         WHEN cardinality(a.tn) > 0 AND a.tn = b.tn THEN 'igual'
         WHEN cardinality(a.tn) = 1 AND a.tn <@ b.tn THEN 'parecido'
         WHEN cardinality(b.tn) = 1 AND b.tn <@ a.tn THEN 'parecido'
    END AS motivo,
    a.gasto + b.gasto AS gasto_total
  FROM p a JOIN p b ON a.id < b.id
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT EXISTS (SELECT 1 FROM public.unificaciones_descartadas d WHERE d.producto_a = a.id AND d.producto_b = b.id)
)
SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rango')::int, (x->>'gasto_total')::numeric DESC), '[]'::jsonb) FROM (
  SELECT jsonb_build_object(
    'motivo', par.motivo,
    'rango', CASE par.motivo WHEN 'sinonimo' THEN 1 WHEN 'igual' THEN 2 ELSE 3 END,
    'gasto_total', round(par.gasto_total, 2),
    'categoria_id', a.categoria_id, 'sucursal_id', a.sucursal_id,
    'a', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad_default, 'usos', a.usos, 'gasto', round(a.gasto, 2)),
    'b', jsonb_build_object('id', b.id, 'nombre', b.nombre, 'unidad', b.unidad_default, 'usos', b.usos, 'gasto', round(b.gasto, 2))
  ) AS x
  FROM par JOIN p a ON a.id = par.a_id JOIN p b ON b.id = par.b_id
  WHERE par.motivo IS NOT NULL AND (par.motivo = 'sinonimo' OR NOT par.medidas_distintas)
  ORDER BY (CASE par.motivo WHEN 'sinonimo' THEN 1 WHEN 'igual' THEN 2 ELSE 3 END), par.gasto_total DESC
  LIMIT 200
) q
$function$;
REVOKE EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) TO authenticated, service_role;
