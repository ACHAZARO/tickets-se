-- ============================================================
-- MIGRACION: 088 - Stock por conteo fisico + opciones por negocio
-- Paso 1 del Stock (04-oct-2026):
--  * cuenta_opciones: ajustes de CADA negocio (regla multi-negocio: nada de un negocio en codigo).
--      usa_stock       -> si esta apagado, la pestana Stock solo explica y ofrece activarlo.
--      gerente_conteo  -> el gerente puede capturar el conteo desde su celular (con su PIN).
--  * conteos_inventario: lo que se conto en fisico, por sucursal, fecha y articulo.
--      consumo real = conteo anterior + compras entre conteos - conteo nuevo.
--      Un renglon por (sucursal, fecha, articulo): contar dos veces el mismo dia actualiza.
-- Solo AGREGA tablas/politicas; no toca datos existentes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cuenta_opciones (
  cuenta_id      uuid PRIMARY KEY REFERENCES public.cuentas(id) ON DELETE CASCADE,
  usa_stock      boolean NOT NULL DEFAULT false,
  gerente_conteo boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cuenta_opciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_cuenta_opciones ON public.cuenta_opciones;
CREATE POLICY admin_all_cuenta_opciones ON public.cuenta_opciones
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- El admin necesita leer el NOMBRE de la cuenta para la pantalla de Opciones (solo lectura).
DROP POLICY IF EXISTS admin_read_cuentas ON public.cuentas;
CREATE POLICY admin_read_cuentas ON public.cuentas FOR SELECT USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.conteos_inventario (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id          uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
  fecha                date NOT NULL,
  clave                text NOT NULL,          -- 'i:<insumo_id>' (insumo) o 'p:<producto_id>' (articulo suelto)
  producto_catalogo_id uuid REFERENCES public.catalogo_productos(id) ON DELETE SET NULL,
  insumo_id            uuid REFERENCES public.insumos(id) ON DELETE SET NULL,
  nombre               text NOT NULL,          -- como se llamaba al contarlo (por si luego se renombra)
  cantidad             numeric NOT NULL CHECK (cantidad >= 0),
  unidad               text,                   -- en la que se conto (g, ml, pz, kg, lt...)
  contado_por          text,                   -- correo del admin o nombre del gerente
  empleado_id          uuid REFERENCES public.empleados(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, fecha, clave)
);
CREATE INDEX IF NOT EXISTS conteos_inventario_suc_fecha_idx ON public.conteos_inventario (sucursal_id, fecha DESC);
ALTER TABLE public.conteos_inventario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_conteos_inventario ON public.conteos_inventario;
CREATE POLICY admin_all_conteos_inventario ON public.conteos_inventario
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- El gerente NO escribe directo: lo hace la edge function `conteo-gerente` (service role) tras validar su PIN/sesion
-- y que su negocio tenga gerente_conteo = true.
