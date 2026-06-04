-- ============================================================
-- MIGRACION: 009 - Admin de sucursales y empleados
-- RLS para que el admin autenticado gestione sucursales y la
-- relacion sucursal_empleados; RPC SECURITY DEFINER para crear/
-- editar empleados hasheando el PIN server-side (pgcrypto).
-- ============================================================

-- Admin: acceso total a sucursales (la policy publica de lectura sigue
-- existiendo para la web anonima; las policies son permisivas = OR).
CREATE POLICY "Admin full access sucursales"
  ON public.sucursales FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Admin: acceso total a la relacion sucursal-empleado
CREATE POLICY "Admin full access sucursal_empleados"
  ON public.sucursal_empleados FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Admin: acceso total a empleados (complementa el read de la migracion 007)
CREATE POLICY "Admin full access empleados"
  ON public.empleados FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- RPC: crear/editar empleado con PIN hasheado y vincularlo a una sucursal.
-- SECURITY DEFINER para usar pgcrypto sin exponer el hashing al cliente.
-- Guarda contra llamadas anonimas con el check de auth.role().
CREATE OR REPLACE FUNCTION public.admin_guardar_empleado(
  p_id          UUID,
  p_nombre      TEXT,
  p_pin         TEXT,
  p_activo      BOOLEAN,
  p_sucursal_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.role() <> 'authenticated' THEN
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
$$;

REVOKE ALL ON FUNCTION public.admin_guardar_empleado(UUID, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_guardar_empleado(UUID, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;
