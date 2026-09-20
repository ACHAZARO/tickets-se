-- 072: afina el detector (071) con datos reales.
--  * Los codigos de proveedor ("583245", "10500651": 5+ digitos) no son medidas: se ignoran en numeros_producto().
--  * Un sinonimo solo cuenta si NO contradice las medidas ("FRESA 454 g" como sinonimo de "FRESA 907 g" ya no cuenta).
CREATE OR REPLACE FUNCTION public.numeros_producto(p_texto text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}'::text[]) FROM (
    SELECT DISTINCT replace((regexp_matches(COALESCE(p_texto, ''), '[0-9]+(?:[.,][0-9]+)?', 'g'))[1], ',', '.') AS x
  ) s
  WHERE split_part(x, '.', 1) !~ '^[0-9]{5,}$'
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
    (cardinality(a.nums) > 0 AND cardinality(b.nums) > 0 AND a.nums <> b.nums) AS medidas_distintas,
    -- el nombre de uno esta escrito (misma identidad y sin medidas contradictorias) como sinonimo del otro
    (cardinality(a.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(b.sinonimos) s
        WHERE public.tokens_producto(s) = a.tn
          AND NOT (cardinality(public.numeros_producto(s)) > 0 AND cardinality(a.nums) > 0 AND public.numeros_producto(s) <> a.nums))) AS a_en_b,
    (cardinality(b.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(a.sinonimos) s
        WHERE public.tokens_producto(s) = b.tn
          AND NOT (cardinality(public.numeros_producto(s)) > 0 AND cardinality(b.nums) > 0 AND public.numeros_producto(s) <> b.nums))) AS b_en_a,
    a.tn AS atn, b.tn AS btn,
    a.gasto + b.gasto AS gasto_total
  FROM p a JOIN p b ON a.id < b.id
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT EXISTS (SELECT 1 FROM public.unificaciones_descartadas d WHERE d.producto_a = a.id AND d.producto_b = b.id)
),
clas AS (
  SELECT par.*,
    CASE WHEN a_en_b OR b_en_a THEN 'sinonimo'
         WHEN medidas_distintas THEN NULL
         WHEN cardinality(atn) > 0 AND atn = btn THEN 'igual'
         WHEN cardinality(atn) = 1 AND atn <@ btn THEN 'parecido'
         WHEN cardinality(btn) = 1 AND btn <@ atn THEN 'parecido'
    END AS motivo
  FROM par
)
SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rango')::int, (x->>'gasto_total')::numeric DESC), '[]'::jsonb) FROM (
  SELECT jsonb_build_object(
    'motivo', clas.motivo,
    'rango', CASE clas.motivo WHEN 'sinonimo' THEN 1 WHEN 'igual' THEN 2 ELSE 3 END,
    'gasto_total', round(clas.gasto_total, 2),
    'categoria_id', a.categoria_id, 'sucursal_id', a.sucursal_id,
    'a', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad_default, 'usos', a.usos, 'gasto', round(a.gasto, 2)),
    'b', jsonb_build_object('id', b.id, 'nombre', b.nombre, 'unidad', b.unidad_default, 'usos', b.usos, 'gasto', round(b.gasto, 2))
  ) AS x
  FROM clas JOIN p a ON a.id = clas.a_id JOIN p b ON b.id = clas.b_id
  WHERE clas.motivo IS NOT NULL
  ORDER BY (CASE clas.motivo WHEN 'sinonimo' THEN 1 WHEN 'igual' THEN 2 ELSE 3 END), clas.gasto_total DESC
  LIMIT 200
) q
$function$;
REVOKE EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) TO authenticated, service_role;
