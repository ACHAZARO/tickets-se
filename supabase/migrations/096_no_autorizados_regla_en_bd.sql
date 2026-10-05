-- ============================================================
-- MIGRACION: 096 - Articulos no autorizados: la REGLA vive en la base (revision 05-oct-2026)
--  * Trigger en ticket_items: si un renglon se liga (alta o cambio de articulo) a un articulo NO AUTORIZADO, queda
--    'pendiente' y su ticket lleva la alerta articulo_no_autorizado; si se cambia a otro articulo, deja de estar
--    pendiente. Asi no importa desde que pantalla o funcion se ligue (Tickets, Precios, IA, unificar).
--  * Lo PENDIENTE tampoco cuenta como gasto hasta que se decida (igual que un ticket por revisar): solo cuentan los
--    renglones 'normal' y 'aprobado'. resumen_tickets separa: renglones_no_aprobados y renglones_por_decidir.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_autorizacion_renglon()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uso text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.producto_catalogo_id IS NOT DISTINCT FROM OLD.producto_catalogo_id THEN
    RETURN NEW;
  END IF;
  SELECT uso INTO v_uso FROM catalogo_productos WHERE id = NEW.producto_catalogo_id;
  IF v_uso = 'no_autorizado' THEN
    IF NEW.autorizacion = 'normal' OR TG_OP = 'UPDATE' THEN
      NEW.autorizacion := 'pendiente';
      NEW.autorizacion_por := NULL;
      NEW.autorizacion_en := NULL;
    END IF;
  ELSIF NEW.autorizacion <> 'normal' THEN
    -- Ya no es un articulo no autorizado: la decision anterior no aplica.
    NEW.autorizacion := 'normal';
    NEW.autorizacion_por := NULL;
    NEW.autorizacion_en := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.tg_autorizacion_alerta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.autorizacion = 'pendiente' THEN
    INSERT INTO alertas_tickets (registro_ticket_id, tipo, resuelta)
    SELECT NEW.registro_ticket_id, 'articulo_no_autorizado', false
     WHERE NOT EXISTS (SELECT 1 FROM alertas_tickets a WHERE a.registro_ticket_id = NEW.registro_ticket_id
                         AND a.tipo = 'articulo_no_autorizado' AND NOT a.resuelta);
  ELSIF TG_OP = 'UPDATE' AND OLD.autorizacion = 'pendiente' THEN
    UPDATE alertas_tickets SET resuelta = true
     WHERE registro_ticket_id = NEW.registro_ticket_id AND tipo = 'articulo_no_autorizado' AND NOT resuelta
       AND NOT EXISTS (SELECT 1 FROM ticket_items i WHERE i.registro_ticket_id = NEW.registro_ticket_id AND i.autorizacion = 'pendiente');
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS ticket_items_autorizacion ON public.ticket_items;
CREATE TRIGGER ticket_items_autorizacion
  BEFORE INSERT OR UPDATE OF producto_catalogo_id ON public.ticket_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_autorizacion_renglon();

DROP TRIGGER IF EXISTS ticket_items_autorizacion_alerta ON public.ticket_items;
CREATE TRIGGER ticket_items_autorizacion_alerta
  AFTER INSERT OR UPDATE OF producto_catalogo_id ON public.ticket_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_autorizacion_alerta();

-- ---------- Solo cuenta lo normal y lo aprobado ----------
CREATE OR REPLACE FUNCTION public.resumen_tickets(p_desde date, p_hasta date, p_sucursal uuid DEFAULT NULL::uuid, p_comercio text DEFAULT NULL::text, p_cuenta uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH t AS (
  SELECT r.id, r.estado,
         COALESCE(r.monto, 0) AS monto_cap,
         (r.es_duplicado OR r.duplicado_de IS NOT NULL) AS es_dup,
         CASE WHEN r.estado = 'rechazado' THEN
                CASE WHEN r.sospechoso AND COALESCE(r.sospecha_estado, 'abierta') <> 'descartada' THEN 'fraude'
                     WHEN r.es_duplicado OR r.duplicado_de IS NOT NULL THEN 'duplicado'
                     ELSE 'otro' END
         END AS motivo,
         COALESCE((SELECT sum(COALESCE(i.monto, 0)) FROM ticket_items i
                    WHERE i.registro_ticket_id = r.id AND i.autorizacion = 'rechazado'), 0) AS m_no_aut,
         (SELECT count(*) FROM ticket_items i WHERE i.registro_ticket_id = r.id AND i.autorizacion = 'rechazado') AS n_no_aut,
         COALESCE((SELECT sum(COALESCE(i.monto, 0)) FROM ticket_items i
                    WHERE i.registro_ticket_id = r.id AND i.autorizacion = 'pendiente'), 0) AS m_pend,
         (SELECT count(*) FROM ticket_items i WHERE i.registro_ticket_id = r.id AND i.autorizacion = 'pendiente') AS n_pend
  FROM registros_tickets r
  JOIN sucursales s ON s.id = r.sucursal_id
  WHERE (r.fecha_ticket BETWEEN p_desde AND p_hasta
         OR (r.fecha_ticket IS NULL
             AND (r.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_desde AND p_hasta))
    AND ((p_sucursal IS NULL AND s.activa AND NOT s.es_prueba) OR r.sucursal_id = p_sucursal)
    AND (p_cuenta IS NULL OR s.cuenta_id = p_cuenta)
    AND (p_comercio IS NULL OR r.comercio = p_comercio)
),
tot AS (
  SELECT
    count(*)                                                        AS n,
    COALESCE(sum(monto_cap), 0)                                     AS m,
    count(*) FILTER (WHERE estado = 'confirmado')                   AS n_of,
    COALESCE(sum(monto_cap - m_no_aut - m_pend) FILTER (WHERE estado = 'confirmado'), 0) AS m_of,
    COALESCE(sum(m_no_aut) FILTER (WHERE estado = 'confirmado'), 0) AS m_na,
    COALESCE(sum(n_no_aut) FILTER (WHERE estado = 'confirmado'), 0) AS n_na,
    COALESCE(sum(m_pend) FILTER (WHERE estado = 'confirmado'), 0)   AS m_pd,
    COALESCE(sum(n_pend) FILTER (WHERE estado = 'confirmado'), 0)   AS n_pd,
    count(*) FILTER (WHERE estado = 'pendiente')                    AS n_rev,
    COALESCE(sum(monto_cap) FILTER (WHERE estado = 'pendiente'), 0)  AS m_rev,
    count(*) FILTER (WHERE estado = 'rechazado')                    AS n_rech,
    COALESCE(sum(monto_cap) FILTER (WHERE estado = 'rechazado'), 0)  AS m_rech,
    count(*) FILTER (WHERE estado NOT IN ('confirmado', 'pendiente', 'rechazado'))                    AS n_otro,
    COALESCE(sum(monto_cap) FILTER (WHERE estado NOT IN ('confirmado', 'pendiente', 'rechazado')), 0) AS m_otro,
    count(*) FILTER (WHERE motivo = 'duplicado')                    AS n_dup,
    COALESCE(sum(monto_cap) FILTER (WHERE motivo = 'duplicado'), 0)  AS m_dup,
    count(*) FILTER (WHERE motivo = 'fraude')                       AS n_fra,
    COALESCE(sum(monto_cap) FILTER (WHERE motivo = 'fraude'), 0)     AS m_fra,
    count(*) FILTER (WHERE motivo = 'otro')                         AS n_mot,
    COALESCE(sum(monto_cap) FILTER (WHERE motivo = 'otro'), 0)       AS m_mot,
    count(*) FILTER (WHERE monto_cap <= 0 AND NOT es_dup)            AS n_sin_monto
  FROM t
),
cat AS (
  SELECT COALESCE(c.nombre, 'Sin categoria') AS categoria,
         COALESCE(c.cuenta_operativo, true)  AS cuenta_operativo,
         count(*)                            AS renglones,
         round(COALESCE(sum(i.monto), 0), 2) AS monto
  FROM ticket_items i
  JOIN t ON t.id = i.registro_ticket_id AND t.estado = 'confirmado'
  LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
  WHERE i.autorizacion IN ('normal', 'aprobado')
  GROUP BY 1, 2
)
SELECT jsonb_build_object(
  'periodo',   jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
  'subidos',   jsonb_build_object('tickets', tot.n,     'monto', round(tot.m, 2)),
  'oficiales', jsonb_build_object('tickets', tot.n_of,  'monto', round(tot.m_of, 2)),
  'en_revision', jsonb_build_object('tickets', tot.n_rev, 'monto', round(tot.m_rev, 2)),
  'no_validos', jsonb_build_object(
      'tickets', tot.n_rech, 'monto', round(tot.m_rech, 2),
      'por_motivo', jsonb_build_object(
        'duplicado', jsonb_build_object('tickets', tot.n_dup, 'monto', round(tot.m_dup, 2)),
        'fraude',    jsonb_build_object('tickets', tot.n_fra, 'monto', round(tot.m_fra, 2)),
        'otro',      jsonb_build_object('tickets', tot.n_mot, 'monto', round(tot.m_mot, 2)))),
  'renglones_no_aprobados', jsonb_build_object('renglones', tot.n_na, 'monto', round(tot.m_na, 2)),
  'renglones_por_decidir',  jsonb_build_object('renglones', tot.n_pd, 'monto', round(tot.m_pd, 2)),
  'otros_estados', jsonb_build_object('tickets', tot.n_otro, 'monto', round(tot.m_otro, 2)),
  'por_justificar', round(tot.m - tot.m_of, 2),
  'tickets_sin_monto_leido', tot.n_sin_monto,
  'oficiales_por_categoria', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'categoria', cat.categoria, 'monto', cat.monto, 'renglones', cat.renglones,
        'cuenta_operativo', cat.cuenta_operativo) ORDER BY cat.monto DESC) FROM cat), '[]'::jsonb),
  'oficiales_gasto_operativo',   COALESCE((SELECT sum(cat.monto) FROM cat WHERE cat.cuenta_operativo), 0),
  'oficiales_fuera_de_operacion', COALESCE((SELECT sum(cat.monto) FROM cat WHERE NOT cat.cuenta_operativo), 0),
  'oficiales_sin_desglosar',     round(tot.m_of - COALESCE((SELECT sum(cat.monto) FROM cat), 0), 2)
)
FROM tot;
$function$;

CREATE OR REPLACE FUNCTION public.desglose_categoria(p_desde date, p_hasta date, p_categoria text, p_sucursal uuid DEFAULT NULL::uuid, p_cuenta uuid DEFAULT NULL::uuid, p_detalle boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH b AS (
  SELECT i.id AS item_id, r.id AS ticket_id, r.fecha_ticket, r.comercio,
         COALESCE(c.nombre, 'Sin categoria')         AS categoria,
         COALESCE(c.cuenta_operativo, true)          AS cuenta_operativo,
         COALESCE(NULLIF(trim(p.nombre), ''), NULLIF(trim(i.descripcion), ''), '(sin descripcion)') AS producto,
         i.descripcion, i.cantidad, lower(NULLIF(trim(i.unidad), '')) AS unidad, COALESCE(i.monto, 0) AS monto
  FROM ticket_items i
  JOIN registros_tickets r ON r.id = i.registro_ticket_id AND r.estado = 'confirmado'
  JOIN sucursales s ON s.id = r.sucursal_id
  LEFT JOIN categorias_gasto c ON c.id = i.categoria_id
  LEFT JOIN catalogo_productos p ON p.id = i.producto_catalogo_id
  WHERE lower(COALESCE(c.nombre, 'Sin categoria')) = lower(trim(p_categoria))
    AND i.autorizacion IN ('normal', 'aprobado')
    AND (r.fecha_ticket BETWEEN p_desde AND p_hasta
         OR (r.fecha_ticket IS NULL
             AND (r.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_desde AND p_hasta))
    AND ((p_sucursal IS NULL AND s.activa AND NOT s.es_prueba) OR r.sucursal_id = p_sucursal)
    AND (p_cuenta IS NULL OR s.cuenta_id = p_cuenta)
),
tot AS (
  SELECT COALESCE(sum(monto), 0) AS monto, count(*) AS renglones, count(DISTINCT ticket_id) AS tickets,
         min(categoria) AS categoria, bool_and(cuenta_operativo) AS cuenta_operativo
  FROM b
),
prod AS (
  SELECT producto, count(*) AS renglones, round(sum(monto), 2) AS monto,
         (SELECT jsonb_agg(jsonb_build_object('unidad', u.unidad, 'cantidad', u.cant) ORDER BY u.cant DESC)
            FROM (SELECT unidad, sum(cantidad) AS cant FROM b b2 WHERE b2.producto = b.producto
                  GROUP BY unidad HAVING sum(cantidad) IS NOT NULL) u) AS cantidades
  FROM b GROUP BY producto
)
SELECT (jsonb_build_object(
  'categoria', COALESCE((SELECT categoria FROM tot WHERE renglones > 0), p_categoria),
  'cuenta_operativo', (SELECT cuenta_operativo FROM tot WHERE renglones > 0),
  'total', (SELECT jsonb_build_object('monto', round(monto, 2), 'renglones', renglones, 'tickets', tickets) FROM tot),
  'por_producto', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'producto', producto, 'monto', monto, 'renglones', renglones,
        'cantidades', COALESCE(cantidades, '[]'::jsonb),
        'pct_de_la_categoria', CASE WHEN (SELECT monto FROM tot) <> 0
                                    THEN round(100 * monto / (SELECT monto FROM tot), 1) END)
        ORDER BY monto DESC) FROM prod), '[]'::jsonb),
  'renglones', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'fecha' DESC, x->>'ticket_id') FROM (
        SELECT jsonb_build_object('fecha', fecha_ticket, 'comercio', comercio, 'ticket_id', ticket_id,
               'producto', producto, 'descripcion', descripcion, 'cantidad', cantidad, 'unidad', unidad,
               'monto', round(monto, 2)) AS x
        FROM b ORDER BY fecha_ticket DESC NULLS LAST, ticket_id, item_id LIMIT 1000) q), '[]'::jsonb),
  'renglones_truncados', (SELECT renglones FROM tot) > 1000
) - CASE WHEN p_detalle THEN ARRAY[]::text[] ELSE ARRAY['renglones', 'renglones_truncados'] END)
$function$;
