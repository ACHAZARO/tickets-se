-- ============================================================
-- MIGRACION: 090 - Clasificar renglones "sin clasificar" con un NOMBRE LIMPIO (Cerebro, 04-oct-2026)
-- Antes, ligar_huerfano creaba el articulo con el texto crudo del ticket como nombre ("ticket 31 transaccion 1200...").
-- Ahora quien revisa dice QUE ARTICULO ES:
--   * p_producto_id: un articulo que ya existe -> los renglones se ligan a el (con su categoria) y el texto del ticket
--     se guarda como sinonimo, para que la IA lo reconozca la proxima vez.
--   * p_nombre: un articulo NUEVO con ese nombre limpio (+ categoria, unidad y lo que trae: "1 barra trae 90 g"),
--     uno por cada sucursal donde aparece el texto (catalogo por sucursal, 074); el texto crudo queda como sinonimo.
-- Solo toca renglones SIN categoria con ese texto y de tickets NO rechazados (los rechazados no cuentan; 091). ligar_huerfano se queda (no se borra nada).
-- Tambien: defensa en profundidad (revisor 04-oct) -> quitar a anon las tablas nuevas de la 088.
-- ============================================================

REVOKE ALL ON public.cuenta_opciones FROM anon;
REVOKE ALL ON public.conteos_inventario FROM anon;

CREATE OR REPLACE FUNCTION public.clasificar_renglones(
  p_descripcion       text,
  p_sucursal_id       uuid    DEFAULT NULL,
  p_producto_id       uuid    DEFAULT NULL,
  p_nombre            text    DEFAULT NULL,
  p_categoria_id      uuid    DEFAULT NULL,
  p_unidad            text    DEFAULT NULL,
  p_contiene_cantidad numeric DEFAULT NULL,
  p_contiene_unidad   text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_desc     text := btrim(p_descripcion);
  v_nombre   text := btrim(p_nombre);
  v_unidad   text := nullif(btrim(p_unidad), '');
  v_cont_u   text := nullif(btrim(p_contiene_unidad), '');
  v_cat      uuid;
  v_cat_suc  uuid;
  v_prod     uuid;
  v_prod_suc uuid;
  v_suc      uuid;
  v_n        int;
  v_total    int := 0;
  v_primero  uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  IF v_desc IS NULL OR v_desc = '' THEN RAISE EXCEPTION 'falta el texto del renglon'; END IF;

  -- 1) Es un articulo que YA existe
  IF p_producto_id IS NOT NULL THEN
    SELECT categoria_id, sucursal_id INTO v_cat, v_prod_suc FROM catalogo_productos WHERE id = p_producto_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'articulo no encontrado'; END IF;
    v_cat := coalesce(v_cat, p_categoria_id);
    IF v_cat IS NULL THEN RAISE EXCEPTION 'ese articulo no tiene categoria: elige una'; END IF;

    UPDATE catalogo_productos
       SET categoria_id = v_cat,
           sinonimos = (SELECT array(SELECT DISTINCT s FROM unnest(coalesce(sinonimos, '{}') || ARRAY[v_desc]) s))
     WHERE id = p_producto_id;

    UPDATE ticket_items ti
       SET categoria_id = v_cat,
           producto_catalogo_id = p_producto_id,
           unidad = coalesce(ti.unidad, v_unidad),
           necesita_revision = (coalesce(ti.unidad, v_unidad) IS NULL),
           motivo_revision = CASE WHEN coalesce(ti.unidad, v_unidad) IS NULL THEN 'sin_unidad' ELSE NULL END
      FROM registros_tickets r
     WHERE r.id = ti.registro_ticket_id
       AND ti.categoria_id IS NULL
       AND lower(btrim(ti.descripcion)) = lower(v_desc) AND r.estado <> 'rechazado'
       AND (v_prod_suc IS NULL OR r.sucursal_id = v_prod_suc)
       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id);
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN jsonb_build_object('producto_id', p_producto_id, 'renglones', v_total, 'nuevo', false);
  END IF;

  -- 2) Es un articulo NUEVO con nombre limpio
  IF v_nombre IS NULL OR v_nombre = '' THEN RAISE EXCEPTION 'falta el nombre del articulo'; END IF;
  IF p_categoria_id IS NULL THEN RAISE EXCEPTION 'falta la categoria'; END IF;
  SELECT sucursal_id INTO v_cat_suc FROM categorias_gasto WHERE id = p_categoria_id;

  FOR v_suc IN
    SELECT DISTINCT r.sucursal_id
      FROM ticket_items ti JOIN registros_tickets r ON r.id = ti.registro_ticket_id
     WHERE ti.categoria_id IS NULL AND lower(btrim(ti.descripcion)) = lower(v_desc) AND r.estado <> 'rechazado'
       AND (p_sucursal_id IS NULL OR r.sucursal_id = p_sucursal_id)
     ORDER BY 1
  LOOP
    IF v_cat_suc IS NOT NULL AND v_cat_suc <> v_suc THEN CONTINUE; END IF;

    v_prod := NULL;
    SELECT id INTO v_prod FROM catalogo_productos WHERE lower(nombre) = lower(v_nombre) AND sucursal_id = v_suc LIMIT 1;
    IF v_prod IS NULL THEN
      INSERT INTO catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id, contiene_cantidad, contiene_unidad)
      VALUES (v_nombre,
              CASE WHEN lower(v_desc) <> lower(v_nombre) THEN ARRAY[v_desc] ELSE '{}'::text[] END,
              p_categoria_id, v_unidad, v_suc,
              CASE WHEN p_contiene_cantidad > 0 AND v_cont_u IS NOT NULL THEN p_contiene_cantidad END,
              CASE WHEN p_contiene_cantidad > 0 AND v_cont_u IS NOT NULL THEN v_cont_u END)
      RETURNING id INTO v_prod;
    ELSE
      UPDATE catalogo_productos
         SET categoria_id = coalesce(categoria_id, p_categoria_id),
             unidad_default = coalesce(unidad_default, v_unidad),
             contiene_cantidad = coalesce(contiene_cantidad, CASE WHEN p_contiene_cantidad > 0 AND v_cont_u IS NOT NULL THEN p_contiene_cantidad END),
             contiene_unidad = coalesce(contiene_unidad, CASE WHEN p_contiene_cantidad > 0 AND v_cont_u IS NOT NULL THEN v_cont_u END),
             sinonimos = (SELECT array(SELECT DISTINCT s FROM unnest(coalesce(sinonimos, '{}') || ARRAY[v_desc]) s))
       WHERE id = v_prod;
    END IF;

    UPDATE ticket_items ti
       SET categoria_id = p_categoria_id,
           producto_catalogo_id = v_prod,
           unidad = coalesce(ti.unidad, v_unidad),
           necesita_revision = (coalesce(ti.unidad, v_unidad) IS NULL),
           motivo_revision = CASE WHEN coalesce(ti.unidad, v_unidad) IS NULL THEN 'sin_unidad' ELSE NULL END
      FROM registros_tickets r
     WHERE r.id = ti.registro_ticket_id AND r.sucursal_id = v_suc
       AND ti.categoria_id IS NULL
       AND lower(btrim(ti.descripcion)) = lower(v_desc) AND r.estado <> 'rechazado';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    IF v_primero IS NULL THEN v_primero := v_prod; END IF;
  END LOOP;

  RETURN jsonb_build_object('producto_id', v_primero, 'renglones', v_total, 'nuevo', true);
END
$$;

REVOKE ALL ON FUNCTION public.clasificar_renglones(text, uuid, uuid, text, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clasificar_renglones(text, uuid, uuid, text, uuid, text, numeric, text) TO authenticated, service_role;
