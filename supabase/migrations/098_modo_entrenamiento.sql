-- ============================================================
-- MIGRACION: 098 - Modo entrenamiento (clientes nuevos)
-- Ver PLAN_MODO_ENTRENAMIENTO.md. Decision Alejandro 05-oct-2026.
--  * cuenta_opciones: el modo se prende POR CUENTA (nunca para todos).
--      entrenamiento        -> la IA acepta los tickets y crea los articulos que no conoce.
--      entrenamiento_desde  -> desde cuando esta prendido (para el rastro).
--      bienvenida_vista     -> ya se le pregunto "¿Deseas iniciar la configuracion?".
--      giro                 -> giro elegido al iniciar (elige la plantilla de categorias).
--      entrenamiento_pasos  -> pasos que se palomean a mano: {"articulos":"A"|"B","tickets":true,"cerebro":true}.
--  * registros_tickets.entrenamiento: el ticket se acepto en entrenamiento (nadie lo reviso). Regla de evidencia.
--  * plantillas_categorias: categorias sugeridas por giro. Viven en la BD, no en el codigo. Al aplicarse se COPIAN
--    como categorias propias de las sucursales del cliente (nunca globales).
-- Solo AGREGA columnas/tablas; no cambia datos existentes salvo marcar la bienvenida como vista en las cuentas que
-- ya existen (ya estan configuradas: no se les pregunta).
-- ============================================================

ALTER TABLE public.cuenta_opciones
  ADD COLUMN IF NOT EXISTS entrenamiento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrenamiento_desde timestamptz,
  ADD COLUMN IF NOT EXISTS bienvenida_vista boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS giro text,
  ADD COLUMN IF NOT EXISTS entrenamiento_pasos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Las cuentas que ya existen no son "nuevas": se crea su fila (si no la tenian) con la bienvenida ya vista.
INSERT INTO public.cuenta_opciones (cuenta_id, bienvenida_vista)
SELECT c.id, true FROM public.cuentas c
ON CONFLICT (cuenta_id) DO UPDATE SET bienvenida_vista = true;

ALTER TABLE public.registros_tickets
  ADD COLUMN IF NOT EXISTS entrenamiento boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.plantillas_categorias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giro        text NOT NULL,              -- 'restaurante' | 'tienda' | 'oficina' | 'otro'
  nombre      text NOT NULL,
  operativo   boolean NOT NULL DEFAULT true,   -- se copia a categorias_gasto.cuenta_operativo
  palomeada   boolean NOT NULL DEFAULT true,   -- sale marcada por defecto
  obligatoria boolean NOT NULL DEFAULT false,  -- la IA la necesita (Descuentos, Otros gastos operativos): no se desmarca
  ayuda       text,                            -- que entra ahi, en una linea
  orden       integer NOT NULL DEFAULT 0,
  UNIQUE (giro, nombre)
);
ALTER TABLE public.plantillas_categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_plantillas_categorias ON public.plantillas_categorias;
CREATE POLICY admin_read_plantillas_categorias ON public.plantillas_categorias
  FOR SELECT USING (public.is_admin());

INSERT INTO public.plantillas_categorias (giro, nombre, operativo, palomeada, obligatoria, ayuda, orden) VALUES
  -- Restaurante / Cafeteria
  ('restaurante', 'Insumos Alimentos',        true,  true,  false, 'Comida y materia prima para cocinar', 1),
  ('restaurante', 'Bebidas',                  true,  true,  false, 'Refrescos, cerveza, agua, leche, cafe', 2),
  ('restaurante', 'Desechables',              true,  true,  false, 'Vasos, platos, bolsas, servilletas, empaques', 3),
  ('restaurante', 'Limpieza',                 true,  true,  false, 'Jabon, cloro, trapos, fibras', 4),
  ('restaurante', 'Gas',                      true,  true,  false, 'Gas LP o natural', 5),
  ('restaurante', 'Luz',                      true,  true,  false, 'Recibo de luz', 6),
  ('restaurante', 'Agua',                     true,  true,  false, 'Recibo de agua y garrafones', 7),
  ('restaurante', 'Mantenimiento',            true,  true,  false, 'Reparaciones, refacciones, plomeria', 8),
  ('restaurante', 'Papeleria',                true,  false, false, 'Hojas, plumas, rollos de impresora', 9),
  ('restaurante', 'Renta',                    true,  false, false, 'Renta del local', 10),
  ('restaurante', 'Equipo y mobiliario',      false, false, false, 'Compras grandes que no son del dia a dia', 11),
  ('restaurante', 'Extras',                   false, true,  false, 'Gastos fuera de la operacion normal', 12),
  ('restaurante', 'Descuentos',               true,  true,  true,  'Descuentos del ticket (la IA los separa sola)', 13),
  ('restaurante', 'Otros gastos operativos',  true,  true,  true,  'Lo que no entra en otra categoria, envios y fletes', 14),
  -- Tienda / Comercio
  ('tienda', 'Mercancia para venta',          true,  true,  false, 'Lo que compras para revender', 1),
  ('tienda', 'Empaques y bolsas',             true,  true,  false, 'Bolsas, cajas, etiquetas', 2),
  ('tienda', 'Limpieza',                      true,  true,  false, 'Articulos de limpieza del local', 3),
  ('tienda', 'Luz',                           true,  true,  false, 'Recibo de luz', 4),
  ('tienda', 'Agua',                          true,  false, false, 'Recibo de agua y garrafones', 5),
  ('tienda', 'Mantenimiento',                 true,  true,  false, 'Reparaciones y refacciones', 6),
  ('tienda', 'Papeleria',                     true,  true,  false, 'Hojas, plumas, rollos de impresora', 7),
  ('tienda', 'Renta',                         true,  false, false, 'Renta del local', 8),
  ('tienda', 'Equipo y mobiliario',           false, false, false, 'Compras grandes que no son del dia a dia', 9),
  ('tienda', 'Extras',                        false, true,  false, 'Gastos fuera de la operacion normal', 10),
  ('tienda', 'Descuentos',                    true,  true,  true,  'Descuentos del ticket (la IA los separa sola)', 11),
  ('tienda', 'Otros gastos operativos',       true,  true,  true,  'Lo que no entra en otra categoria, envios y fletes', 12),
  -- Oficina / Servicios
  ('oficina', 'Papeleria',                    true,  true,  false, 'Hojas, plumas, tinta, carpetas', 1),
  ('oficina', 'Cafeteria y despensa',         true,  true,  false, 'Cafe, agua, galletas para el equipo', 2),
  ('oficina', 'Limpieza',                     true,  true,  false, 'Articulos de limpieza', 3),
  ('oficina', 'Luz',                          true,  true,  false, 'Recibo de luz', 4),
  ('oficina', 'Internet y telefono',          true,  true,  false, 'Internet, telefono, celulares', 5),
  ('oficina', 'Transporte y gasolina',        true,  true,  false, 'Gasolina, casetas, taxis, estacionamiento', 6),
  ('oficina', 'Mantenimiento',                true,  false, false, 'Reparaciones y refacciones', 7),
  ('oficina', 'Renta',                        true,  false, false, 'Renta de la oficina', 8),
  ('oficina', 'Equipo de computo',            false, false, false, 'Computadoras, impresoras, accesorios', 9),
  ('oficina', 'Extras',                       false, true,  false, 'Gastos fuera de la operacion normal', 10),
  ('oficina', 'Descuentos',                   true,  true,  true,  'Descuentos del ticket (la IA los separa sola)', 11),
  ('oficina', 'Otros gastos operativos',      true,  true,  true,  'Lo que no entra en otra categoria, envios y fletes', 12),
  -- Otro giro: categorias contables generales
  ('otro', 'Compras e insumos',               true,  true,  false, 'Lo que usas para dar tu producto o servicio', 1),
  ('otro', 'Servicios (luz, agua, gas, internet)', true, true, false, 'Recibos de servicios', 2),
  ('otro', 'Limpieza',                        true,  true,  false, 'Articulos de limpieza', 3),
  ('otro', 'Papeleria',                       true,  true,  false, 'Hojas, plumas, tinta', 4),
  ('otro', 'Mantenimiento',                   true,  true,  false, 'Reparaciones y refacciones', 5),
  ('otro', 'Transporte y gasolina',           true,  true,  false, 'Gasolina, casetas, fletes', 6),
  ('otro', 'Renta',                           true,  false, false, 'Renta del local', 7),
  ('otro', 'Equipo y mobiliario',             false, false, false, 'Compras grandes que no son del dia a dia', 8),
  ('otro', 'Extras',                          false, true,  false, 'Gastos fuera de la operacion normal', 9),
  ('otro', 'Descuentos',                      true,  true,  true,  'Descuentos del ticket (la IA los separa sola)', 10),
  ('otro', 'Otros gastos operativos',         true,  true,  true,  'Lo que no entra en otra categoria', 11)
ON CONFLICT (giro, nombre) DO NOTHING;
