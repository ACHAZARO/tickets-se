-- ============================================================
-- MIGRACION: 089 - El admin puede LEER el nombre de las cuentas
-- La 060 dejo `cuentas` sin permisos para `authenticated`; la politica admin_read_cuentas (088) no basta
-- sin el GRANT. Solo SELECT; RLS sigue limitando a is_admin(). Columnas: id, nombre, created_at.
-- ============================================================
GRANT SELECT ON public.cuentas TO authenticated;
