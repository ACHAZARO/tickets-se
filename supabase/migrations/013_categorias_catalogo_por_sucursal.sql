-- ============================================================
-- MIGRACION: 013 - Categorias y catalogo por sucursal
-- sucursal_id NULL = global (aplica a todas); con valor = solo esa sucursal.
-- El admin y la IA cargan lo global + lo de la sucursal en contexto.
-- ============================================================

ALTER TABLE public.categorias_gasto ADD COLUMN sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE CASCADE;
ALTER TABLE public.categorias_gasto DROP CONSTRAINT categorias_gasto_nombre_key;
CREATE UNIQUE INDEX idx_categoria_nombre_suc
  ON public.categorias_gasto (lower(nombre), COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.catalogo_productos ADD COLUMN sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE CASCADE;
CREATE INDEX idx_catalogo_sucursal ON public.catalogo_productos (sucursal_id);
