-- ============================================================
-- MIGRACION: 092 - Revision de alertas de precio (IA + humano) - 04-oct-2026
-- En Precios, una variacion grande (>=100%) muchas veces es una FALSA ALARMA: el mismo articulo con la medida mal
-- tomada (un renglon en caja y otro en pieza, mismo precio real). La edge function `revisar-precio` le pregunta a la IA
-- (con las dos fotos) y propone la correccion; quien revisa la aplica con un toque o dice "es subida real".
-- Aqui se guarda lo decidido por PAR de renglones (anterior, ultimo) para no volver a alarmar por lo mismo.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.precios_revisados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_anterior   uuid NOT NULL REFERENCES public.ticket_items(id) ON DELETE CASCADE,
  item_ultimo     uuid NOT NULL REFERENCES public.ticket_items(id) ON DELETE CASCADE,
  veredicto       text NOT NULL CHECK (veredicto IN ('subida_real', 'corregido', 'otro_articulo')),
  explicacion     text,
  modelo          text,                 -- modelo de IA que lo reviso (null si fue solo humano)
  revisado_por    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_anterior, item_ultimo)
);
ALTER TABLE public.precios_revisados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_precios_revisados ON public.precios_revisados;
CREATE POLICY admin_all_precios_revisados ON public.precios_revisados
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.precios_revisados FROM anon;
