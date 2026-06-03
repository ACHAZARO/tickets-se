-- ============================================================
-- MIGRACION: 004 - Columnas nuevas en registros_tickets
-- folio_ticket, unidad, categoria_id
-- ============================================================

ALTER TABLE public.registros_tickets
  ADD COLUMN IF NOT EXISTS folio_ticket TEXT,
  ADD COLUMN IF NOT EXISTS unidad TEXT,
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES public.categorias_gasto(id);

CREATE INDEX idx_tickets_folio ON public.registros_tickets(folio_ticket);
