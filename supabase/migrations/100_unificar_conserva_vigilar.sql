-- ============================================================
-- MIGRACION: 100 - Unificar productos conserva "Vigilar" (10-oct-2026, revision del diff de la 099)
--  * Antes: al unificar un articulo VIGILADO dentro de otro, el destino no heredaba `vigilar` y la vigilancia se perdia
--    sin aviso (el origen se borra). Ahora: el destino queda vigilado si cualquiera de los dos lo estaba; el motivo es el
--    del que estaba vigilado (si ambos, el del destino).
--  * Mismo cuerpo que la version en produccion (070) + solo las dos lineas de vigilar. El respaldo (destino_antes) ya
--    guarda la fila completa, asi que deshacer la unificacion regresa el valor anterior.
--  * PENDIENTE DE APLICAR: se aplica junto con el push de la pantalla de "Vigilar" a main (antes nadie puede marcar
--    articulos vigilados, asi que no hay hueco mientras tanto).
-- ============================================================

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
                          ELSE COALESCE(o.vigilar_motivo, d.vigilar_motivo) END
  WHERE id = d.id;

  DELETE FROM public.catalogo_productos WHERE id = o.id;

  RETURN jsonb_build_object('origen', o.nombre, 'destino', d.nombre,
    'renglones', cardinality(v_items), 'precios', cardinality(v_precios), 'consumos', cardinality(v_consumos));
END
$function$;
