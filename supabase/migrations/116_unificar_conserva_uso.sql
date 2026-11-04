-- 116_unificar_conserva_uso.sql (2026-11-04, Claude, pedido de Alejandro)
--  * Antes: al unificar un articulo No autorizado u Ocasional dentro de uno normal, se perdia la marca. Ahora el destino
--    se queda con la mas estricta: no_autorizado > ocasional > normal.
--  * Antes: mover los renglones disparaba tg_autorizacion_renglon. Un renglon No aprobado volvia a contar si el destino
--    era normal, y compras ya aprobadas regresaban a Fraude si el destino era No autorizado. Ahora cada renglon conserva
--    su decision: la marca aplica de aqui en adelante.
--  * Mismo cuerpo que la version en produccion (100 + 101) mas lo anterior. El respaldo (destino_antes) ya guarda el uso.
CREATE OR REPLACE FUNCTION public._unificar_productos(p_origen uuid, p_destino uuid, p_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'respaldo'
AS $function$
DECLARE
  o public.catalogo_productos%ROWTYPE;
  d public.catalogo_productos%ROWTYPE;
  v_items uuid[]; v_precios uuid[]; v_consumos uuid[];
  v_sin text[];
  v_uso text;
  v_decisiones jsonb;
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

  v_uso := CASE WHEN 'no_autorizado' IN (o.uso, d.uso) THEN 'no_autorizado'
                WHEN 'ocasional' IN (o.uso, d.uso) THEN 'ocasional'
                ELSE COALESCE(d.uso, 'normal') END;

  -- Cada renglon conserva su decision. Con el destino en normal mientras se mueven no nacen alertas nuevas; al final se restaura.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'a', autorizacion, 'p', autorizacion_por, 'e', autorizacion_en)), '[]')
    INTO v_decisiones FROM public.ticket_items WHERE producto_catalogo_id = o.id;
  UPDATE public.catalogo_productos SET uso = 'normal' WHERE id = d.id;

  UPDATE public.ticket_items       SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;
  UPDATE public.precio_historial   SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;
  UPDATE public.consumo_inventario SET producto_catalogo_id = d.id WHERE producto_catalogo_id = o.id;

  UPDATE public.ticket_items i SET
      autorizacion = x.a, autorizacion_por = x.p, autorizacion_en = x.e
    FROM jsonb_to_recordset(v_decisiones) AS x(id uuid, a text, p text, e timestamptz)
   WHERE i.id = x.id;

  SELECT COALESCE(array_agg(DISTINCT s), '{}') INTO v_sin
  FROM unnest(COALESCE(d.sinonimos, '{}') || COALESCE(o.sinonimos, '{}') || ARRAY[o.nombre]) s
  WHERE trim(s) <> '' AND lower(trim(s)) <> lower(trim(d.nombre));

  UPDATE public.catalogo_productos SET
    sinonimos        = v_sin,
    veces_matched    = COALESCE(d.veces_matched, 0) + COALESCE(o.veces_matched, 0),
    precio_referencia = COALESCE(d.precio_referencia, o.precio_referencia),
    contiene_cantidad     = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_cantidad ELSE d.contiene_cantidad END,
    contiene_unidad       = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_unidad ELSE d.contiene_unidad END,
    contiene_sub_cantidad = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_sub_cantidad ELSE d.contiene_sub_cantidad END,
    contiene_sub_unidad   = CASE WHEN d.contiene_cantidad IS NULL THEN o.contiene_sub_unidad ELSE d.contiene_sub_unidad END,
    vigilar        = d.vigilar OR o.vigilar,
    vigilar_motivo = CASE WHEN d.vigilar THEN COALESCE(d.vigilar_motivo, o.vigilar_motivo)
                          ELSE COALESCE(o.vigilar_motivo, d.vigilar_motivo) END,
    uso            = v_uso
  WHERE id = d.id;

  DELETE FROM public.catalogo_productos WHERE id = o.id;

  RETURN jsonb_build_object('origen', o.nombre, 'destino', d.nombre,
    'renglones', cardinality(v_items), 'precios', cardinality(v_precios), 'consumos', cardinality(v_consumos));
END
$function$;
