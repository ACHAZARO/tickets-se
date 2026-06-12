-- 027: cierra grants reabiertos (PUBLIC tenia EXECUTE por default) y endurece admin_guardar_empleado.
-- Hallado por advisors 2026-06-11: verificar_pin y limpiar_imagenes_antiguas ejecutables por anon via PostgREST.

-- 1) verificar_pin: SOLO service_role (la llama la edge function verificar-pin).
--    Cierra fuerza bruta de PIN directa via /rest/v1/rpc saltandose el rate limit de la edge.
REVOKE EXECUTE ON FUNCTION public.verificar_pin(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_pin(text, text) TO service_role;

-- 2) limpiar_imagenes_antiguas: SOLO pg_cron (owner) y service_role.
--    Un anonimo podia disparar borrado de imagenes de +1 anio.
REVOKE EXECUTE ON FUNCTION public.limpiar_imagenes_antiguas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpiar_imagenes_antiguas() TO service_role;

-- 3) ligar_huerfano: sin anon (authenticated se queda; la funcion valida is_admin() internamente).
REVOKE EXECUTE ON FUNCTION public.ligar_huerfano(text, uuid, uuid, text, text[]) FROM PUBLIC, anon;

-- 4) is_admin: sin anon (las policies RLS solo la evaluan como authenticated).
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;

-- 5) set_updated_at: fijar search_path (advisor function_search_path_mutable).
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- 6) admin_guardar_empleado: exigir admin REAL (antes bastaba cualquier authenticated).
CREATE OR REPLACE FUNCTION public.admin_guardar_empleado(p_id uuid, p_nombre text, p_pin text, p_activo boolean, p_sucursal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;

  IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'nombre requerido';
  END IF;

  IF p_id IS NULL THEN
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
      RAISE EXCEPTION 'PIN de al menos 4 digitos requerido para un empleado nuevo';
    END IF;
    INSERT INTO public.empleados (nombre, pin_hash, activo)
    VALUES (trim(p_nombre), crypt(p_pin, gen_salt('bf', 10)), COALESCE(p_activo, true))
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
    UPDATE public.empleados
    SET nombre   = trim(p_nombre),
        activo   = COALESCE(p_activo, true),
        pin_hash = CASE
          WHEN p_pin IS NOT NULL AND length(trim(p_pin)) >= 4
          THEN crypt(p_pin, gen_salt('bf', 10))
          ELSE pin_hash
        END
    WHERE id = p_id;
  END IF;

  IF p_sucursal_id IS NOT NULL THEN
    INSERT INTO public.sucursal_empleados (sucursal_id, empleado_id, activo)
    VALUES (p_sucursal_id, v_id, true)
    ON CONFLICT (sucursal_id, empleado_id) DO UPDATE SET activo = true;
  END IF;

  RETURN v_id;
END;
$function$;

-- Nota: CREATE OR REPLACE conserva ACLs existentes; aseguramos el estado deseado.
REVOKE EXECUTE ON FUNCTION public.admin_guardar_empleado(uuid, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_guardar_empleado(uuid, text, text, boolean, uuid) TO authenticated, service_role;
