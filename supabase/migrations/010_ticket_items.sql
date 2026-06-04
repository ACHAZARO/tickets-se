-- ============================================================
-- MIGRACION: 010 - Renglones de ticket (multi-producto)
-- Un ticket puede tener varios productos. Gemini extrae una lista
-- y auto-categoriza cada renglon. registros_tickets queda como
-- encabezado; las columnas producto/cantidad/unidad/categoria_id
-- de registros_tickets quedan legacy (compat con tickets viejos).
-- ============================================================

CREATE TABLE public.ticket_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_ticket_id   UUID NOT NULL REFERENCES public.registros_tickets(id) ON DELETE CASCADE,
  descripcion          TEXT NOT NULL,
  cantidad             NUMERIC,
  unidad               TEXT,
  monto                NUMERIC(12,2),
  categoria_id         UUID REFERENCES public.categorias_gasto(id),
  producto_catalogo_id UUID REFERENCES public.catalogo_productos(id),
  necesita_revision    BOOLEAN NOT NULL DEFAULT false,
  motivo_revision      TEXT,  -- 'sin_categoria' | 'sin_unidad' | 'sin_precio'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_items_registro ON public.ticket_items(registro_ticket_id);
CREATE INDEX idx_ticket_items_categoria ON public.ticket_items(categoria_id);
ALTER TABLE public.ticket_items ENABLE ROW LEVEL SECURITY;

-- Admin autenticado: acceso total (revision y arqueo). Las edge functions
-- usan service_role y omiten RLS.
CREATE POLICY "Admin full access ticket_items"
  ON public.ticket_items FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
