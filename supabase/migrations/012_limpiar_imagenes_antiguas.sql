-- ============================================================
-- MIGRACION: 012 - Limpieza automatica de imagenes con +1 año
-- Borra las fotos (storage) de tickets con mas de 1 año, conservando
-- los datos en las tablas. Programado mensual con pg_cron.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.limpiar_imagenes_antiguas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_borradas integer;
BEGIN
  WITH del AS (
    DELETE FROM storage.objects
    WHERE bucket_id IN ('archivo', 'por-revisar')
      AND created_at < now() - interval '1 year'
    RETURNING 1
  )
  SELECT count(*) INTO v_borradas FROM del;

  UPDATE public.registros_tickets
  SET storage_path_original = NULL, storage_path_archivo = NULL
  WHERE created_at < now() - interval '1 year'
    AND (storage_path_original IS NOT NULL OR storage_path_archivo IS NOT NULL);

  RETURN v_borradas;
END;
$$;

-- Programar mensual: dia 1 a las 3am
SELECT cron.schedule(
  'limpiar-imagenes-tickets',
  '0 3 1 * *',
  $$SELECT public.limpiar_imagenes_antiguas()$$
);
