-- 070: UNIFICAR productos del catalogo que son el mismo insumo (ej. "Mantequilla" y "Mantequilla Gloria 1 kg").
-- Piezas:
--   1) tokens_producto(): palabras "de identidad" de un nombre (sin tamanos, unidades ni plurales).
--   2) unificaciones_descartadas: pares que Alejandro marco "no son iguales" (no se vuelven a preguntar).
--   3) respaldo.unificaciones_productos: cada union guarda el producto absorbido y los renglones/precios/consumos que se movieron.
--   4) _unificar_productos(): el motor (solo service_role). admin_unificar_productos(): la version que llama el admin (is_admin).
--   5) sugerir_unificaciones(): detector de posibles duplicados para Cerebro (alerta + pregunta).
-- Reglas del motor: solo productos de la MISMA categoria y el mismo alcance (misma sucursal, o el destino es global).
-- Cada renglon conserva lo que se capturo (descripcion, cantidad, unidad, monto): solo cambia a que producto pertenece.

-- 1) Palabras de identidad de un nombre.
CREATE OR REPLACE FUNCTION public.tokens_producto(p_texto text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}'::text[]) FROM (
    SELECT DISTINCT CASE WHEN length(t) > 3 AND right(t, 1) = 's' THEN left(t, length(t) - 1) ELSE t END AS x
    FROM unnest(string_to_array(trim(regexp_replace(regexp_replace(regexp_replace(
           lower(translate(COALESCE(p_texto, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
           '[0-9]+([.,][0-9]+)?', ' ', 'g'),
           '\m(kg|g|gr|grs|gramos|ml|lt|lts|l|lb|litro|litros|pz|pza|pzas|pieza|piezas|gal|galon|caja|cajas|c|cal|ft|x|de|del|la|el|los|las|con|en|para|paq|paquete|bolsa|bot|botella|lata|pk|marca|nr)\M', ' ', 'g'),
           '[^a-z ]', ' ', 'g')), ' ')) t
    WHERE length(t) > 1
  ) s
$$;

-- 2) Pares descartados ("no son iguales").
CREATE TABLE IF NOT EXISTS public.unificaciones_descartadas (
  producto_a uuid NOT NULL REFERENCES public.catalogo_productos(id) ON DELETE CASCADE,
  producto_b uuid NOT NULL REFERENCES public.catalogo_productos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (producto_a, producto_b),
  CHECK (producto_a < producto_b)
);
ALTER TABLE public.unificaciones_descartadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_unificaciones_descartadas ON public.unificaciones_descartadas;
CREATE POLICY admin_all_unificaciones_descartadas ON public.unificaciones_descartadas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.unificaciones_descartadas FROM anon;

-- 3) Respaldo de cada union (para poder deshacerla a mano).
CREATE TABLE IF NOT EXISTS respaldo.unificaciones_productos (
  id bigserial PRIMARY KEY,
  fecha timestamptz NOT NULL DEFAULT now(),
  origen jsonb NOT NULL,          -- fila completa del producto absorbido
  destino_id uuid NOT NULL,
  destino_antes jsonb NOT NULL,   -- fila del destino ANTES de la union (sinonimos, equivalencia, etc.)
  items uuid[] NOT NULL DEFAULT '{}',
  precios uuid[] NOT NULL DEFAULT '{}',
  consumos uuid[] NOT NULL DEFAULT '{}',
  por uuid                         -- auth.uid() de quien la pidio (NULL si fue por SQL)
);

-- 4) Motor. Solo service_role / postgres.
CREATE OR REPLACE FUNCTION public._unificar_productos(p_origen uuid, p_destino uuid, p_por uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, respaldo AS $function$
DECLARE
  o public.catalogo_productos%ROWTYPE;
  d public.catalogo_productos%ROWTYPE;
  v_items uuid[]; v_precios uuid[]; v_consumos uuid[];
  v_sin text[];
BEGIN
  IF p_origen = p_destino THEN RAISE EXCEPTION 'origen y destino son el mismo producto'; END IF;
  SELECT * INTO o FROM public.catalogo_productos WHERE id = p_origen FOR UPDATE;
  SELECT * INTO d FROM public.catalogo_productos WHERE id = p_destino FOR UPDATE;
  IF o.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'producto no encontrado'; END IF;
  IF o.categoria_id IS DISTINCT FROM d.categoria_id THEN
    RAISE EXCEPTION 'solo se unifican productos de la misma categoria (mueve uno de categoria primero)';
  END IF;
  IF o.sucursal_id IS DISTINCT FROM d.sucursal_id AND d.sucursal_id IS NOT NULL THEN
    RAISE EXCEPTION 'los productos son de sucursales distintas';
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_items    FROM public.ticket_items       WHERE producto_catalogo_id = o.id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_precios  FROM public.precio_historial   WHERE producto_catalogo_id = o.id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_consumos FROM public.consumo_inventario WHERE producto_catalogo_id = o.id;

  INSERT INTO respaldo.unificaciones_productos (origen, destino_id, destino_antes, items, precios, consumos, por)
  VALUES (to_jsonb(o), d.id, to_jsonb(d), v_items, v_precios, v_consumos, p_por);

  UPDATE public.ticket_items       SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;
  UPDATE public.precio_historial   SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;
  UPDATE public.consumo_inventario SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;

  -- El destino aprende todos los nombres del absorbido (incluido su nombre) para que la IA siga ligando ambos a el.
  SELECT COALESCE(array_agg(DISTINCT s), '{}') INTO v_sin
  FROM unnest(COALESCE(d.sinonimos, '{}') || COALESCE(o.sinonimos, '{}') || ARRAY[o.nombre]) s
  WHERE trim(s) <> '' AND lower(trim(s)) <> lower(trim(d.nombre));

  UPDATE public.catalogo_productos SET
    sinonimos        = v_sin,
    veces_matched    = COALESCE(d.veces_matched, 0) + COALESCE(o.veces_matched, 0),
    precio_referencia = COALESCE(d.precio_referencia, o.precio_referencia),
    -- si el destino no tenia equivalencia y el absorbido si, se hereda
    contiene_cantidad     = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_cantidad ELSE d.contiene_cantidad END,
    contiene_unidad       = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_unidad ELSE d.contiene_unidad END,
    contiene_sub_cantidad = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_sub_cantidad ELSE d.contiene_sub_cantidad END,
    contiene_sub_unidad   = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_sub_unidad ELSE d.contiene_sub_unidad END
  WHERE id = d.id;

  DELETE FROM public.catalogo_productos WHERE id = o.id;   -- (las filas de unificaciones_descartadas se van en cascada)

  RETURN jsonb_build_object('origen', o.nombre, 'destino', d.nombre,
    'renglones', cardinality(v_items), 'precios', cardinality(v_precios), 'consumos', cardinality(v_consumos));
END
$function$;
REVOKE EXECUTE ON FUNCTION public._unificar_productos(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._unificar_productos(uuid, uuid, uuid) TO service_role;

-- Version del admin (pantalla): exige is_admin().
CREATE OR REPLACE FUNCTION public.admin_unificar_productos(p_origen uuid, p_destino uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  RETURN public._unificar_productos(p_origen, p_destino, auth.uid());
END
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_unificar_productos(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_unificar_productos(uuid, uuid) TO authenticated, service_role;

-- "No son iguales": no se vuelve a preguntar por este par.
CREATE OR REPLACE FUNCTION public.admin_descartar_unificacion(p_a uuid, p_b uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  INSERT INTO public.unificaciones_descartadas (producto_a, producto_b)
  VALUES (LEAST(p_a, p_b), GREATEST(p_a, p_b)) ON CONFLICT DO NOTHING;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_descartar_unificacion(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_descartar_unificacion(uuid, uuid) TO authenticated, service_role;

-- 5) Detector. Devuelve un arreglo de pares con contexto, mas probables y de mayor gasto primero.
--    'igual'    = mismo nombre sin tamanos/plurales ("Aguacates" / "AGUACATE").
--    'sinonimo' = el nombre de uno ya esta escrito como sinonimo del otro.
--    'parecido' = todas las palabras de uno (nombre + sinonimos) estan en el otro ("Mantequilla" / "Mantequilla Gloria 1 kg").
--    Solo la misma categoria y la misma sucursal. p_sucursal NULL = todas.
CREATE OR REPLACE FUNCTION public.sugerir_unificaciones(p_sucursal uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $function$
WITH p AS (
  SELECT c.id, c.nombre, c.sucursal_id, c.categoria_id, c.unidad_default, COALESCE(c.sinonimos, '{}') AS sinonimos,
         public.tokens_producto(c.nombre) AS tn,
         public.tokens_producto(c.nombre || ' ' || COALESCE(array_to_string(c.sinonimos, ' '), '')) AS tns,
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
    CASE WHEN cardinality(a.tn) > 0 AND a.tn = b.tn THEN 'igual'
         WHEN cardinality(a.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(b.sinonimos) s WHERE public.tokens_producto(s) = a.tn) THEN 'sinonimo'
         WHEN cardinality(b.tn) > 0 AND EXISTS (SELECT 1 FROM unnest(a.sinonimos) s WHERE public.tokens_producto(s) = b.tn) THEN 'sinonimo'
         WHEN cardinality(a.tn) > 0 AND cardinality(b.tn) > 0 AND (a.tns <@ b.tns OR b.tns <@ a.tns) THEN 'parecido'
    END AS motivo,
    a.gasto + b.gasto AS gasto_total
  FROM p a JOIN p b ON a.id < b.id
       AND a.categoria_id = b.categoria_id AND a.sucursal_id IS NOT DISTINCT FROM b.sucursal_id
  WHERE NOT EXISTS (SELECT 1 FROM public.unificaciones_descartadas d WHERE d.producto_a = a.id AND d.producto_b = b.id)
)
SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rango')::int, (x->>'gasto_total')::numeric DESC), '[]'::jsonb) FROM (
  SELECT jsonb_build_object(
    'motivo', par.motivo,
    'rango', CASE par.motivo WHEN 'igual' THEN 1 WHEN 'sinonimo' THEN 2 ELSE 3 END,
    'gasto_total', round(par.gasto_total, 2),
    'categoria_id', a.categoria_id, 'sucursal_id', a.sucursal_id,
    'a', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad_default, 'usos', a.usos, 'gasto', round(a.gasto, 2)),
    'b', jsonb_build_object('id', b.id, 'nombre', b.nombre, 'unidad', b.unidad_default, 'usos', b.usos, 'gasto', round(b.gasto, 2))
  ) AS x
  FROM par JOIN p a ON a.id = par.a_id JOIN p b ON b.id = par.b_id
  WHERE par.motivo IS NOT NULL
  ORDER BY (CASE par.motivo WHEN 'igual' THEN 1 WHEN 'sinonimo' THEN 2 ELSE 3 END), par.gasto_total DESC
  LIMIT 200
) q
$function$;
REVOKE EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sugerir_unificaciones(uuid) TO authenticated, service_role;
