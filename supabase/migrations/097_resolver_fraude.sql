-- ============================================================
-- MIGRACION: 097 - Resolver un grupo de Fraude con una sola accion (05-oct-2026, pedido de Alejandro)
--  Botones nuevos en la pestana Fraude:
--   * 'mismo_gasto'  -> "Es el mismo gasto": se deja SOLO p_conservar; los demas del grupo se rechazan como
--                       duplicado de el (no se borran: la foto queda como evidencia; regla "evidencia siempre").
--   * 'contar_todos' -> "Contar ambos tickets": no es fraude; los que estaban rechazados vuelven a Por confirmar.
--   * 'fraude'       -> "Es fraude": se rechazan p_rechazar (uno o todos) y quedan marcados como fraude, AUNQUE
--                       estuvieran confirmados (antes "Es fraude" dejaba contando un ticket confirmado). Los demas
--                       del grupo cuentan.
--   * 'no_fraude'    -> ticket suelto: "No es fraude" (igual que el Descartar de antes).
--  Todo en una transaccion: no queda un grupo a medias.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolver_fraude(
  p_ids uuid[], p_accion text, p_conservar uuid DEFAULT NULL, p_rechazar uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_n int;
  v_marca text := ' | ' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'DD-MM-YYYY') || ': ';
  v_a_pendiente int := 0;
  v_rechazados int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  IF p_accion NOT IN ('mismo_gasto', 'contar_todos', 'fraude', 'no_fraude') THEN RAISE EXCEPTION 'accion invalida'; END IF;
  p_ids := ARRAY(SELECT DISTINCT unnest(p_ids));
  SELECT count(*) INTO v_n FROM registros_tickets WHERE id = ANY(p_ids);
  IF v_n = 0 OR v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'tickets no encontrados'; END IF;

  IF p_accion = 'mismo_gasto' THEN
    IF v_n < 2 OR p_conservar IS NULL OR NOT (p_conservar = ANY(p_ids)) THEN
      RAISE EXCEPTION 'elige cual ticket se queda';
    END IF;
    -- El que se queda: cuenta. Si estaba rechazado, vuelve a Por confirmar.
    UPDATE registros_tickets SET
        sospechoso = false, sospecha_estado = 'descartada',
        sospecha_motivo = coalesce(sospecha_motivo, '') || v_marca || 'mismo gasto: este es el que se queda.',
        estado = CASE WHEN estado = 'rechazado' THEN 'pendiente' ELSE estado END,
        es_duplicado = false, duplicado_de = NULL
      WHERE id = p_conservar;
    SELECT count(*) INTO v_a_pendiente FROM registros_tickets WHERE id = p_conservar AND estado = 'pendiente';
    -- Los demas: rechazados como copia del que se queda (no es fraude).
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
    -- No es fraude. En grupo ("Contar ambos") todos cuentan: los rechazados vuelven a Por confirmar.
    -- Suelto ("No es fraude"): solo regresa la foto repetida que el sistema rechazo solo (como el Descartar de antes).
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

  ELSE -- fraude
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
    -- Los que no son fraude cuentan (si estaban rechazados, vuelven a Por confirmar).
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

  RETURN jsonb_build_object('rechazados', v_rechazados, 'a_por_confirmar', v_a_pendiente);
END
$$;

REVOKE ALL ON FUNCTION public.resolver_fraude(uuid[], text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_fraude(uuid[], text, uuid, uuid[]) TO authenticated, service_role;
