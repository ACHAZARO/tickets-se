-- ============================================================
-- MIGRACION: 097 - Al APROBAR un renglon no autorizado se elige la categoria (05-oct-2026, Alejandro)
-- p_categoria: la que elige quien revisa; si no manda ninguna, la del articulo (gasto extra).
-- ============================================================
DROP FUNCTION IF EXISTS public.decidir_renglon_no_autorizado(uuid, boolean);

CREATE OR REPLACE FUNCTION public.decidir_renglon_no_autorizado(p_item uuid, p_aprobar boolean, p_categoria uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket uuid;
  v_pend   integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  IF p_categoria IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias_gasto WHERE id = p_categoria) THEN
    RAISE EXCEPTION 'categoria no encontrada';
  END IF;
  UPDATE ticket_items i SET
      autorizacion = CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END,
      categoria_id = CASE WHEN p_aprobar
                          THEN COALESCE(p_categoria, (SELECT categoria_id FROM catalogo_productos WHERE id = i.producto_catalogo_id), i.categoria_id)
                          ELSE i.categoria_id END,
      autorizacion_por = COALESCE(auth.jwt() ->> 'email', 'admin'),
      autorizacion_en = now(),
      aviso_gerente_visto = NULL
   WHERE i.id = p_item AND i.autorizacion IN ('pendiente', 'aprobado', 'rechazado')
  RETURNING i.registro_ticket_id INTO v_ticket;
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'renglon no encontrado o sin revision pendiente'; END IF;
  SELECT count(*) INTO v_pend FROM ticket_items WHERE registro_ticket_id = v_ticket AND autorizacion = 'pendiente';
  IF v_pend = 0 THEN
    UPDATE alertas_tickets SET resuelta = true WHERE registro_ticket_id = v_ticket AND tipo = 'articulo_no_autorizado' AND NOT resuelta;
  END IF;
  RETURN jsonb_build_object('ticket_id', v_ticket, 'pendientes', v_pend);
END
$$;
REVOKE ALL ON FUNCTION public.decidir_renglon_no_autorizado(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_renglon_no_autorizado(uuid, boolean, uuid) TO authenticated, service_role;
