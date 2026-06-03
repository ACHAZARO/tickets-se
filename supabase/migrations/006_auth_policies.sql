-- ============================================================
-- MIGRACION: 006 - RLS policies para acceso admin autenticado
-- ============================================================

CREATE POLICY "Admin full access categorias" ON public.categorias_gasto
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access catalogo" ON public.catalogo_productos
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access alertas" ON public.alertas_tickets
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access presupuestos" ON public.presupuestos
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin read registros" ON public.registros_tickets
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin update registros" ON public.registros_tickets
  FOR UPDATE USING (auth.role() = 'authenticated');
