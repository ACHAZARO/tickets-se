-- 060: CUENTAS (duenos) y llaves de API atadas a UNA cuenta.
-- Hoy hay una sola cuenta (Alejandro: Santa Elena, Wings Palace y PRUEBA). Cuando otras personas creen cuentas,
-- cada llave de API solo ve las sucursales de SU cuenta: la API nunca es global.
--  * public.cuentas: solo service_role (sin policies).
--  * sucursales.cuenta_id NOT NULL, con DEFAULT temporal a la cuenta principal (el admin actual crea sucursales
--    desde el navegador sin indicar cuenta). Al abrir el registro publico se cambia por la cuenta de quien crea.
--  * api_keys.cuenta_id NOT NULL SIN default: una llave nueva debe decir de que cuenta es (falla cerrado).
--  * resumen_tickets gana p_cuenta: la edge function SIEMPRE lo manda; el admin (RLS) lo deja en NULL.

CREATE TABLE IF NOT EXISTS public.cuentas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cuentas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuentas FROM PUBLIC, anon, authenticated;

INSERT INTO public.cuentas (id, nombre) VALUES ('c559a659-c170-4b04-8574-b7aac622f68c', 'Alejandro (cuenta principal)') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sucursales ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES public.cuentas(id);
UPDATE public.sucursales SET cuenta_id = 'c559a659-c170-4b04-8574-b7aac622f68c' WHERE cuenta_id IS NULL;
ALTER TABLE public.sucursales ALTER COLUMN cuenta_id SET NOT NULL;
ALTER TABLE public.sucursales ALTER COLUMN cuenta_id SET DEFAULT 'c559a659-c170-4b04-8574-b7aac622f68c';

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES public.cuentas(id);
UPDATE public.api_keys SET cuenta_id = 'c559a659-c170-4b04-8574-b7aac622f68c' WHERE cuenta_id IS NULL;
ALTER TABLE public.api_keys ALTER COLUMN cuenta_id SET NOT NULL;

DROP FUNCTION IF EXISTS public.resumen_tickets(date, date, uuid, text);

CREATE OR REPLACE FUNCTION public.resumen_tickets(
  p_desde date, p_hasta date, p_sucursal uuid DEFAULT NULL, p_comercio text DEFAULT NULL, p_cuenta uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $function$
WITH t AS (
  SELECT r.id, r.estado,
         CASE WHEN COALESCE(r.monto, 0) > 0 THEN r.monto
              WHEN r.estado <> 'confirmado'  THEN COALESCE(o.monto, 0)
              ELSE 0 END AS monto_cap,
         CASE WHEN r.estado = 'rechazado' THEN
                CASE WHEN r.sospechoso AND COALESCE(r.sospecha_estado, 'abierta') <> 'descartada' THEN 'fraude'
                     WHEN r.es_duplicado OR r.duplicado_de IS NOT NULL THEN 'duplicado'
                     ELSE 'otro' END
         END AS motivo
  FROM registros_tickets r
  JOIN sucursales s ON s.id = r.sucursal_id
  LEFT JOIN registros_tickets o ON o.id = r.duplicado_de
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
    count(*) FILTER (WHERE monto_cap <= 0)                          AS n_sin_monto
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

REVOKE EXECUTE ON FUNCTION public.resumen_tickets(date, date, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_tickets(date, date, uuid, text, uuid) TO authenticated, service_role;
