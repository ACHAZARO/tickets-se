-- ============================================================
-- MIGRACION: 095 - recalcular_precios_ticket ignora articulos ocasionales / no autorizados (094)
-- Misma regla que _shared/precios.ts: solo los articulos de uso 'normal' llevan historial de precios.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalcular_precios_ticket(p_registro uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reg record;
  v_n   integer := 0;
  r     record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  SELECT id, sucursal_id, fecha_ticket, estado INTO v_reg FROM registros_tickets WHERE id = p_registro;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket no encontrado'; END IF;

  DELETE FROM precio_historial WHERE registro_ticket_id = p_registro;
  IF v_reg.estado <> 'confirmado' THEN RETURN 0; END IF;

  FOR r IN
    SELECT DISTINCT ON (ti.producto_catalogo_id)
           ti.producto_catalogo_id AS pid, ti.monto / ti.cantidad AS unit
      FROM ticket_items ti
      JOIN catalogo_productos p ON p.id = ti.producto_catalogo_id
     WHERE ti.registro_ticket_id = p_registro
       AND ti.monto > 0 AND ti.cantidad > 0
       AND (p.unidad_default IS NULL OR ti.unidad IS NULL OR ti.unidad = p.unidad_default)
       AND p.uso = 'normal'
     ORDER BY ti.producto_catalogo_id, ti.orden NULLS LAST, ti.id
  LOOP
    INSERT INTO precio_historial (producto_catalogo_id, sucursal_id, registro_ticket_id, precio_unitario, fecha)
    VALUES (r.pid, v_reg.sucursal_id, p_registro, r.unit, v_reg.fecha_ticket);
    UPDATE catalogo_productos SET precio_referencia = r.unit WHERE id = r.pid;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$$;

REVOKE ALL ON FUNCTION public.recalcular_precios_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_precios_ticket(uuid) TO authenticated, service_role;
