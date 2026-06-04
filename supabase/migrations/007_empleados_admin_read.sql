-- ============================================================
-- MIGRACION: 007 - Lectura de empleados para el admin
-- ============================================================
-- El detalle de alerta (/admin/alertas/[id]) muestra empleados.nombre
-- (quien subio el ticket). empleados tiene RLS activo pero sin policies,
-- por lo que el join embebido devolvia null para el rol authenticated.
-- Esta policy da lectura de empleados al admin autenticado, consistente
-- con "Admin read registros" de la migracion 006.

CREATE POLICY "Admin read empleados"
  ON public.empleados
  FOR SELECT
  USING (auth.role() = 'authenticated');
