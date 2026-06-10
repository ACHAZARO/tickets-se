-- 025: Segundo nivel de equivalencia.
-- Cada [contiene_unidad] trae [sub_cantidad] [sub_unidad].
-- Ej: 1 caja = 24 pz (nivel 1) Y cada pz = 355 ml (nivel 2) -> total 8520 ml.
-- Permite ver el mismo producto en caja (inventario), pz (conteo) o ml (recetas).
-- APLICADA en produccion por Claude via MCP (2026-06-09).
alter table public.catalogo_productos
  add column if not exists contiene_sub_cantidad numeric,
  add column if not exists contiene_sub_unidad text;

comment on column public.catalogo_productos.contiene_sub_cantidad is 'Nivel 2: cuanto trae cada contiene_unidad (ej. 355). Opcional.';
comment on column public.catalogo_productos.contiene_sub_unidad is 'Nivel 2: unidad del sub-contenido (ej. ml). Opcional.';
