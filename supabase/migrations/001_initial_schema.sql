-- ============================================================
-- PROYECTO: Revisión de Tickets
-- MIGRACIÓN: 001 - Schema inicial
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLA: sucursales
-- ============================================================
CREATE TABLE public.sucursales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,           -- e.g. "reforma-norte" (usado en URL y QR)
  nombre       TEXT NOT NULL,
  direccion    TEXT,
  activa       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.sucursales.slug IS 'Identificador URL-safe usado en la ruta /sucursal/[slug] y en los QR';

-- ============================================================
-- TABLA: empleados
-- ============================================================
-- El PIN se almacena hasheado con bcrypt (pgcrypto).
-- NUNCA se guarda en texto plano.
-- Para verificar: (pin_hash = crypt(pin_ingresado, pin_hash))
-- Para insertar:  crypt('1234', gen_salt('bf', 10))
-- ============================================================
CREATE TABLE public.empleados (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,                  -- bcrypt hash del PIN (4 o 6 dígitos)
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.empleados.pin_hash IS 'bcrypt hash generado con crypt(pin, gen_salt(''bf'', 10)). Nunca texto plano.';

-- ============================================================
-- TABLA: sucursal_empleados  (relación N:M)
-- Un empleado puede estar autorizado en varias sucursales.
-- ============================================================
CREATE TABLE public.sucursal_empleados (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   UUID NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, empleado_id)
);

-- ============================================================
-- TABLA: registros_tickets
-- ============================================================
CREATE TABLE public.registros_tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexto operacional
  sucursal_id         UUID NOT NULL REFERENCES public.sucursales(id),
  empleado_id         UUID NOT NULL REFERENCES public.empleados(id),

  -- Datos extraídos por Gemini (JSON bruto + campos normalizados)
  gemini_raw          JSONB,                   -- respuesta completa del modelo
  fecha_ticket        DATE,                     -- fecha del comprobante físico
  comercio            TEXT,
  producto            TEXT,
  cantidad            NUMERIC(10, 3),
  monto               NUMERIC(12, 2),
  categoria_gasto     TEXT,

  -- Control de duplicados
  hash_imagen         TEXT,                    -- SHA-256 de la imagen para detección de dupes
  es_duplicado        BOOLEAN NOT NULL DEFAULT false,
  duplicado_de        UUID REFERENCES public.registros_tickets(id),

  -- Estado del ciclo de vida
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'confirmado', 'rechazado', 'archivado')),

  -- Archivos en Supabase Storage
  storage_path_original  TEXT,               -- /por-revisar/<uuid>.<ext>
  storage_path_archivo   TEXT,               -- /archivo/<YYYY-MM>/<nombre-auditoria>.<ext>

  -- Auditoría
  confirmado_en       TIMESTAMPTZ,
  sheets_row_id       TEXT,                  -- ID o rango de la fila insertada en Google Sheets
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices útiles
CREATE INDEX idx_tickets_sucursal    ON public.registros_tickets(sucursal_id);
CREATE INDEX idx_tickets_empleado    ON public.registros_tickets(empleado_id);
CREATE INDEX idx_tickets_estado      ON public.registros_tickets(estado);
CREATE INDEX idx_tickets_fecha       ON public.registros_tickets(fecha_ticket);
CREATE INDEX idx_tickets_hash        ON public.registros_tickets(hash_imagen);
-- Nota: date_trunc no es IMMUTABLE, no puede usarse en índice funcional.
-- Filtrar por mes en queries usando: WHERE fecha_ticket >= '2024-06-01' AND fecha_ticket < '2024-07-01'

-- ============================================================
-- FUNCIÓN: verificar_pin
-- Llama a esta función desde el backend para validar acceso.
-- Devuelve el empleado_id si el PIN es correcto y está autorizado
-- en la sucursal. NULL en cualquier otro caso.
-- ============================================================
CREATE OR REPLACE FUNCTION public.verificar_pin(
  p_slug       TEXT,
  p_pin        TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sucursal_id  UUID;
  v_empleado_id  UUID;
BEGIN
  -- Obtener ID de sucursal activa
  SELECT id INTO v_sucursal_id
  FROM public.sucursales
  WHERE slug = p_slug AND activa = true
  LIMIT 1;

  IF v_sucursal_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Buscar empleado con PIN correcto que esté autorizado en la sucursal
  SELECT e.id INTO v_empleado_id
  FROM public.empleados e
  JOIN public.sucursal_empleados se ON se.empleado_id = e.id
  WHERE se.sucursal_id = v_sucursal_id
    AND se.activo = true
    AND e.activo = true
    AND e.pin_hash = crypt(p_pin, e.pin_hash)
  LIMIT 1;

  RETURN v_empleado_id;  -- NULL si no encontró match
END;
$$;

COMMENT ON FUNCTION public.verificar_pin IS
  'Valida PIN de empleado para una sucursal. Retorna empleado_id si es válido, NULL si no.';

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sucursales_updated_at
  BEFORE UPDATE ON public.sucursales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_empleados_updated_at
  BEFORE UPDATE ON public.empleados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON public.registros_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS (Row Level Security)
-- Las tablas quedan protegidas. El acceso real se da via
-- Service Role Key en el backend Python, o via la función
-- verificar_pin (SECURITY DEFINER).
-- ============================================================
ALTER TABLE public.sucursales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleados          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucursal_empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_tickets  ENABLE ROW LEVEL SECURITY;

-- Policy pública: solo leer nombre y slug de sucursales activas
-- (necesario para que la web app anónima identifique la sucursal al abrir el QR)
CREATE POLICY "Sucursales activas son públicas para lectura"
  ON public.sucursales FOR SELECT
  USING (activa = true);

-- El resto requiere service_role (backend Python) o función SECURITY DEFINER.
-- No se crean policies anon adicionales intencionalmente.

-- ============================================================
-- DATOS DE PRUEBA (comentar en producción)
-- ============================================================
/*
-- Insertar sucursal de prueba
INSERT INTO public.sucursales (slug, nombre, direccion)
VALUES ('sucursal-centro', 'Sucursal Centro', 'Av. Reforma 100');

-- Insertar empleado con PIN "1234"
INSERT INTO public.empleados (nombre, pin_hash)
VALUES ('Juan Pérez', crypt('1234', gen_salt('bf', 10)));

-- Asociar empleado a sucursal
INSERT INTO public.sucursal_empleados (sucursal_id, empleado_id)
SELECT s.id, e.id
FROM public.sucursales s, public.empleados e
WHERE s.slug = 'sucursal-centro' AND e.nombre = 'Juan Pérez';

-- Test de verificación de PIN:
SELECT public.verificar_pin('sucursal-centro', '1234');  -- Debe devolver UUID
SELECT public.verificar_pin('sucursal-centro', '9999');  -- Debe devolver NULL
*/
