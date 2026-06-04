-- ============================================================
-- MIGRACION: 008 - Ventas y Objetivos de costo (Fase 3)
-- Soporta el dashboard de arqueo: gasto real (tickets) vs ventas,
-- gasto como % de venta por categoria contra un objetivo %.
-- ============================================================

-- Ventas mensuales por sucursal (captura manual; POS despues)
CREATE TABLE public.ventas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id UUID NOT NULL REFERENCES public.sucursales(id),
  mes         DATE NOT NULL,  -- primer dia del mes
  monto       NUMERIC(12,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, mes)
);
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER ventas_set_updated_at
  BEFORE UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Objetivo de costo (% de venta) por categoria; sucursal_id NULL = todas
CREATE TABLE public.objetivos_costo (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.categorias_gasto(id),
  sucursal_id  UUID REFERENCES public.sucursales(id),
  pct_objetivo NUMERIC(5,2) NOT NULL,  -- 30.00 = 30%
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.objetivos_costo ENABLE ROW LEVEL SECURITY;
-- un objetivo por categoria+sucursal (sucursal NULL tratada como global)
CREATE UNIQUE INDEX idx_objetivo_cat_suc
  ON public.objetivos_costo (categoria_id, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS: acceso total para el admin autenticado (consistente con migracion 006)
CREATE POLICY "Admin full access ventas"
  ON public.ventas FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin full access objetivos"
  ON public.objetivos_costo FOR ALL USING (auth.role() = 'authenticated');
