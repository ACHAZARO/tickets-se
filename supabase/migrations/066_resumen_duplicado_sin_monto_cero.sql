-- 066: un duplicado sin monto propio cuenta $0, no el monto de su original (Alejandro, 19-sep). Claude 2026-09-19.
-- Antes (056-060): si un ticket no traia monto y no estaba confirmado, "subidos" le prestaba el monto de su original.
-- Ahora: cada ticket cuenta SOLO lo que dice su propio papel; si no se leyo monto, cuenta $0.
-- Ejemplo del dueno: nota de remision sin monto + factura de la misma compra -> la nota cuenta $0, la factura su monto.
-- Tambien: `tickets_sin_monto_leido` deja de contar las copias de foto (esas cuentan $0 a proposito, no por ilegibles):
-- ese numero vuelve a ser "tickets cuyo monto no se pudo leer".
create or replace function public.resumen_tickets(
  p_desde date, p_hasta date, p_sucursal uuid default null, p_comercio text default null, p_cuenta uuid default null)
returns jsonb language sql stable set search_path to 'public' as $function$
WITH t AS (
  SELECT r.id, r.estado,
         COALESCE(r.monto, 0) AS monto_cap,
         (r.es_duplicado OR r.duplicado_de IS NOT NULL) AS es_dup,
         CASE WHEN r.estado = 'rechazado' THEN
                CASE WHEN r.sospechoso AND COALESCE(r.sospecha_estado, 'abierta') <> 'descartada' THEN 'fraude'
                     WHEN r.es_duplicado OR r.duplicado_de IS NOT NULL THEN 'duplicado'
                     ELSE 'otro' END
         END AS motivo
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
    COALESCE(sum(monto_cap) FILTER (WHERE estado = 'confirmado'), 0) AS m_of,
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
