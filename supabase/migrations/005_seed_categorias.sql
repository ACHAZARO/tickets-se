-- ============================================================
-- MIGRACION: 005 - Seed de categorias iniciales
-- ============================================================

INSERT INTO public.categorias_gasto (nombre, orden) VALUES
  ('Insumos Alimentos', 1),
  ('Desechables', 2),
  ('Extras', 3),
  ('Gas', 4),
  ('Luz', 5),
  ('Limpieza', 6)
ON CONFLICT (nombre) DO NOTHING;
