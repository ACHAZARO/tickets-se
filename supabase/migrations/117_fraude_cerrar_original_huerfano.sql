-- 117: al resolver la copia de un papel repetido, la original (que la app marco sola con
-- "Tiene una copia ...") sale de Fraude si en su grupo ya no queda nada abierto.
-- Antes la original quedaba sola en Fraude, sin su copia al lado, y no se entendia por que.
CREATE OR REPLACE FUNCTION public.cerrar_originales_huerfanos(p_grupos uuid[])
 RETURNS int
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  UPDATE registros_tickets o SET
      sospechoso = false, sospecha_estado = 'descartada',
      sospecha_motivo = coalesce(o.sospecha_motivo, '') || ' | '
        || to_char(now() AT TIME ZONE 'America/Mexico_City', 'DD-MM-YYYY') || ': su copia ya se resolvio; este cuenta.'
    WHERE (p_grupos IS NULL OR o.sospecha_grupo = ANY(p_grupos))
      AND o.sospecha_grupo IS NOT NULL
      AND o.sospechoso AND o.sospecha_estado = 'abierta'
      AND o.sospecha_origen = 'auto' AND o.sospecha_motivo LIKE 'Tiene una copia%'
      AND o.estado <> 'rechazado'
      AND NOT EXISTS (SELECT 1 FROM registros_tickets c
                      WHERE c.sospecha_grupo = o.sospecha_grupo AND c.id <> o.id
                        AND c.sospechoso AND c.sospecha_estado = 'abierta');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;
REVOKE ALL ON FUNCTION public.cerrar_originales_huerfanos(uuid[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolver_fraude(p_ids uuid[], p_accion text, p_conservar uuid DEFAULT NULL::uuid, p_rechazar uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
  v_marca text := ' | ' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'DD-MM-YYYY') || ': ';
  v_a_pendiente int := 0;
  v_rechazados int := 0;
  v_grupos uuid[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  IF p_accion NOT IN ('mismo_gasto', 'contar_todos', 'fraude', 'no_fraude') THEN RAISE EXCEPTION 'accion invalida'; END IF;
  p_ids := ARRAY(SELECT DISTINCT unnest(p_ids));
  SELECT count(*) INTO v_n FROM registros_tickets WHERE id = ANY(p_ids);
  IF v_n = 0 OR v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'tickets no encontrados'; END IF;
  v_grupos := ARRAY(SELECT DISTINCT sospecha_grupo FROM registros_tickets WHERE id = ANY(p_ids) AND sospecha_grupo IS NOT NULL);

  IF p_accion = 'mismo_gasto' THEN
    IF v_n < 2 OR p_conservar IS NULL OR NOT (p_conservar = ANY(p_ids)) THEN
      RAISE EXCEPTION 'elige cual ticket se queda';
    END IF;
    UPDATE registros_tickets SET
        sospechoso = false, sospecha_estado = 'descartada',
        sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca || 'mismo gasto: este es el que se queda.',
        estado = CASE WHEN estado = 'rechazado' THEN 'pendiente' ELSE estado END,
        es_duplicado = false, duplicado_de = NULL
      WHERE id = p_conservar;
    SELECT count(*) INTO v_a_pendiente FROM registros_tickets WHERE id = p_conservar AND estado = 'pendiente';
    UPDATE registros_tickets SET
        sospechoso = false, sospecha_estado = 'descartada',
        sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca || 'mismo gasto: se quito, cuenta el otro ticket.',
        estado = 'rechazado', es_duplicado = true, duplicado_de = p_conservar,
        gemini_raw = coalesce(gemini_raw, '{}'::jsonb) || jsonb_build_object('_rechazo_motivo', 'mismo gasto')
      WHERE id = ANY(p_ids) AND id <> p_conservar;
    GET DIAGNOSTICS v_rechazados = ROW_COUNT;
    UPDATE alertas_tickets SET resuelta = true
      WHERE registro_ticket_id = ANY(p_ids) AND registro_ticket_id <> p_conservar AND NOT resuelta;

  ELSIF p_accion IN ('contar_todos', 'no_fraude') THEN
    WITH upd AS (
      UPDATE registros_tickets r SET
          sospechoso = false, sospecha_estado = 'descartada',
          sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca ||
            CASE WHEN p_accion = 'contar_todos' THEN 'no es fraude, cuentan todos.' ELSE 'no es fraude.' END,
          estado = CASE WHEN r.estado = 'rechazado' AND (p_accion = 'contar_todos'
                          OR (r.es_duplicado AND r.gemini_raw->>'_rechazo_auto' = 'posible_duplicado'))
                        THEN 'pendiente' ELSE r.estado END,
          es_duplicado = CASE WHEN r.estado = 'rechazado' AND (p_accion = 'contar_todos'
                          OR (r.es_duplicado AND r.gemini_raw->>'_rechazo_auto' = 'posible_duplicado'))
                        THEN false ELSE r.es_duplicado END,
          duplicado_de = CASE WHEN r.estado = 'rechazado' AND (p_accion = 'contar_todos'
                          OR (r.es_duplicado AND r.gemini_raw->>'_rechazo_auto' = 'posible_duplicado'))
                        THEN NULL ELSE r.duplicado_de END
        WHERE r.id = ANY(p_ids)
        RETURNING r.estado)
    SELECT count(*) FILTER (WHERE estado = 'pendiente') INTO v_a_pendiente FROM upd;

  ELSE
    p_rechazar := ARRAY(SELECT DISTINCT unnest(p_rechazar));
    IF coalesce(cardinality(p_rechazar), 0) = 0 OR NOT (p_rechazar <@ p_ids) THEN RAISE EXCEPTION 'elige cual ticket se rechaza'; END IF;
    UPDATE registros_tickets SET
        sospechoso = true, sospecha_estado = 'confirmada',
        sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca || 'FRAUDE: rechazado, no cuenta.',
        estado = 'rechazado',
        gemini_raw = coalesce(gemini_raw, '{}'::jsonb) || jsonb_build_object('_rechazo_motivo', 'fraude')
      WHERE id = ANY(p_rechazar);
    GET DIAGNOSTICS v_rechazados = ROW_COUNT;
    UPDATE alertas_tickets SET resuelta = true WHERE registro_ticket_id = ANY(p_rechazar) AND NOT resuelta;
    WITH upd AS (
      UPDATE registros_tickets r SET
          sospechoso = false, sospecha_estado = 'descartada',
          sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca || 'este no es fraude, cuenta.',
          estado = CASE WHEN r.estado = 'rechazado' THEN 'pendiente' ELSE r.estado END,
          es_duplicado = CASE WHEN r.estado = 'rechazado' THEN false ELSE r.es_duplicado END,
          duplicado_de = CASE WHEN r.estado = 'rechazado' THEN NULL ELSE r.duplicado_de END
        WHERE r.id = ANY(p_ids) AND NOT (r.id = ANY(p_rechazar))
        RETURNING r.estado)
    SELECT count(*) FILTER (WHERE estado = 'pendiente') INTO v_a_pendiente FROM upd;
  END IF;

  -- La original que solo estaba en Fraude por su copia sale con ella.
  IF cardinality(v_grupos) > 0 THEN PERFORM public.cerrar_originales_huerfanos(v_grupos); END IF;

  RETURN jsonb_build_object('rechazados', v_rechazados, 'a_por_confirmar', v_a_pendiente);
END
$function$;
