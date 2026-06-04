-- ============================================================
-- MIGRACION: 016 - Comercios conocidos (la IA aprende el comercio)
-- La IA aprende que tal comercio suele ser de tal categoria (ej. "Centro
-- Gasolinero" -> gasolina). Se alimenta sola al procesar tickets y se incluye
-- en el contexto de Gemini para clasificar mejor.
-- ============================================================

CREATE TABLE public.comercios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT NOT NULL,
  categoria_id UUID REFERENCES public.categorias_gasto(id) ON DELETE SET NULL,
  sucursal_id  UUID REFERENCES public.sucursales(id) ON DELETE CASCADE,
  veces        INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_comercio_nombre_suc
  ON public.comercios (lower(nombre), COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE public.comercios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access comercios"
  ON public.comercios FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE TRIGGER comercios_set_updated_at
  BEFORE UPDATE ON public.comercios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
