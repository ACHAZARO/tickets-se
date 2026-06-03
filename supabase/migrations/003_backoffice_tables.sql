-- ============================================================
-- MIGRACION: 003 - Tablas del Backoffice
-- categorias_gasto, catalogo_productos, alertas_tickets, presupuestos
-- ============================================================

-- Categorias de gasto (editables desde backoffice)
CREATE TABLE public.categorias_gasto (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL UNIQUE,
  orden      INT NOT NULL DEFAULT 0,
  activa     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categorias_gasto ENABLE ROW LEVEL SECURITY;

-- Catalogo de productos conocidos (entrena a Gemini)
CREATE TABLE public.catalogo_productos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  sinonimos         TEXT[] DEFAULT '{}',
  categoria_id      UUID NOT NULL REFERENCES public.categorias_gasto(id),
  unidad_default    TEXT,
  precio_referencia NUMERIC(12,2),
  veces_matched     INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalogo_categoria ON public.catalogo_productos(categoria_id);
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;

-- Alertas generadas por la IA
CREATE TABLE public.alertas_tickets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_ticket_id   UUID NOT NULL REFERENCES public.registros_tickets(id) ON DELETE CASCADE,
  tipo                 TEXT NOT NULL CHECK (tipo IN (
    'duplicado', 'posible_duplicado', 'ilegible',
    'producto_no_reconocido', 'sin_unidad', 'monto_anomalo'
  )),
  duplicado_de_id      UUID REFERENCES public.registros_tickets(id),
  resuelta             BOOLEAN NOT NULL DEFAULT false,
  correccion           JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_tipo ON public.alertas_tickets(tipo);
CREATE INDEX idx_alertas_resuelta ON public.alertas_tickets(resuelta);
CREATE INDEX idx_alertas_ticket ON public.alertas_tickets(registro_ticket_id);
ALTER TABLE public.alertas_tickets ENABLE ROW LEVEL SECURITY;

-- Presupuestos mensuales por sucursal y categoria
CREATE TABLE public.presupuestos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID NOT NULL REFERENCES public.sucursales(id),
  categoria_id  UUID NOT NULL REFERENCES public.categorias_gasto(id),
  mes           DATE NOT NULL,
  monto         NUMERIC(12,2) NOT NULL,
  UNIQUE (sucursal_id, categoria_id, mes)
);
ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;
