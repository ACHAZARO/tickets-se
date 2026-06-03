-- Fix: pgcrypto lives in 'extensions' schema on Supabase, not 'public'
CREATE OR REPLACE FUNCTION public.verificar_pin(
  p_slug       TEXT,
  p_pin        TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sucursal_id  UUID;
  v_empleado_id  UUID;
BEGIN
  SELECT id INTO v_sucursal_id
  FROM public.sucursales
  WHERE slug = p_slug AND activa = true
  LIMIT 1;

  IF v_sucursal_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e.id INTO v_empleado_id
  FROM public.empleados e
  JOIN public.sucursal_empleados se ON se.empleado_id = e.id
  WHERE se.sucursal_id = v_sucursal_id
    AND se.activo = true
    AND e.activo = true
    AND e.pin_hash = crypt(p_pin, e.pin_hash)
  LIMIT 1;

  RETURN v_empleado_id;
END;
$$;
