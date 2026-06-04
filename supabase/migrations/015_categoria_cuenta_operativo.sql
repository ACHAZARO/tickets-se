-- ============================================================
-- MIGRACION: 015 - Categoria cuenta o no en gasto operativo
-- Si cuenta_operativo = false (ej. compra de equipo/amplificador), el gasto
-- aparece en los tickets pero NO se incluye en la distribucion del gasto
-- de operacion del dashboard (para no ensuciar los numeros de la operacion).
-- ============================================================

ALTER TABLE public.categorias_gasto
  ADD COLUMN cuenta_operativo BOOLEAN NOT NULL DEFAULT true;
