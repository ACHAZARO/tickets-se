-- 056: resumen "subidos vs oficiales" (una sola fuente para el admin y la API) + llaves de API de solo lectura.
--
-- Idea de negocio: si un gerente mete tickets de mas (duplicados, facturas dobles, alterados) y su
-- "gasto" cuadra contra TODO lo que subio, la diferencia contra lo oficial es lo que debe justificar.
--   subidos      = todos los tickets del periodo, sin importar su estado (duplicados incluidos)
--   oficiales    = solo los confirmados (con las correcciones de la revision: 49 vs 96, etc.)
--   por_justificar = subidos - oficiales  (= en revision + rechazados)
-- Un duplicado rechazado sin monto propio cuenta con el monto de su ORIGINAL (subio el papel dos veces).

-- 1) Sucursal de prueba: no entra a los totales generales ni a la API salvo que se pida explicitamente.
ALTER TABLE public.sucursales ADD COLUMN IF NOT EXISTS es_prueba boolean NOT NULL DEFAULT false;
UPDATE public.sucursales SET es_prueba = true WHERE slug = 'vale';

-- 2) Llaves de API (solo se guarda el hash SHA-256; la llave real se le entrega una vez a Alejandro).
--    Sin policies: solo la edge function (service_role) puede leerla.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  activa       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM PUBLIC, anon, authenticated;

-- 3) Resumen del periodo. p_sucursal NULL = todas las sucursales reales (sin es_prueba).
--    Periodo por FECHA DEL TICKET (igual que la pantalla de Tickets); sin fecha entra por su
--    fecha de subida en hora de Mexico.
CREATE OR REPLACE FUNCTION public.resumen_tickets(
  p_desde date, p_hasta date, p_sucursal uuid DEFAULT NULL, p_comercio text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $function$
WITH t AS (
  SELECT r.id, r.estado,
         CASE WHEN COALESCE(r.monto, 0) > 0 THEN r.monto ELSE COALESCE(o.monto, 0) END AS monto_cap,
         (COALESCE(r.monto, 0) <= 0 AND COALESCE(o.monto, 0) <= 0) AS sin_monto,
         CASE WHEN r.estado = 'rechazado' THEN
                CASE WHEN r.es_duplicado OR r.duplicado_de IS NOT NULL THEN 'duplicado'
                     WHEN r.sospecha_estado = 'confirmada' THEN 'fraude'
                     ELSE 'otro' END
         END AS motivo
  FROM registros_tickets r
  JOIN sucursales s ON s.id = r.sucursal_id
  LEFT JOIN registros_tickets o ON o.id = r.duplicado_de
  WHERE (r.fecha_ticket BETWEEN p_desde AND p_hasta
         OR (r.fecha_ticket IS NULL
             AND (r.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN p_desde AND p_hasta))
    AND ((p_sucursal IS NULL AND NOT s.es_prueba) OR r.sucursal_id = p_sucursal)
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
    count(*) FILTER (WHERE sin_monto)                               AS n_sin_monto
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

-- SECURITY INVOKER: en el admin aplica el RLS (solo is_admin ve tickets); la edge function usa service_role.
REVOKE EXECUTE ON FUNCTION public.resumen_tickets(date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_tickets(date, date, uuid, text) TO authenticated, service_role;
