-- 076: INSUMOS = lo que se controla en inventario; los productos del catalogo son sus PRESENTACIONES.
-- Pedido de Alejandro (20-sep): "Sal 1 kg" y "Sal La Fina 1.1 kg" son dos articulos distintos (cada uno con su
-- precio) pero UN solo insumo: si se compro una de cada una, el inventario debe decir "Sal: 2.1 kg".
-- Esto NO es unificar (070): unificar deja UN producto; agrupar deja los dos, cada uno con su precio y su tamano,
-- y solo suma sus cantidades en la unidad base del insumo. Nada de lo capturado se toca.
--   * insumos: nombre + unidad_base (kg / lt / pz), por sucursal.
--   * catalogo_productos.insumo_id: a que insumo pertenece esta presentacion (NULL = suelta, como hasta hoy).
--   * el "cuanto trae" de cada presentacion sigue en contiene_cantidad/contiene_unidad (equivalencias, migracion 018).
--   * leer_contenido(): lee del nombre el tamano ("Sal La Fina 1.1 kg" -> 1.1 kg, "FRESA 454 G" -> 454 g).

CREATE TABLE IF NOT EXISTS public.insumos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  unidad_base text NOT NULL,
  sucursal_id uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, nombre)
);
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_insumos ON public.insumos;
CREATE POLICY admin_all_insumos ON public.insumos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.insumos FROM anon;

ALTER TABLE public.catalogo_productos ADD COLUMN IF NOT EXISTS insumo_id uuid REFERENCES public.insumos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_insumo ON public.catalogo_productos (insumo_id);
COMMENT ON COLUMN public.catalogo_productos.insumo_id IS
  'Insumo al que pertenece esta presentacion (Sal 1 kg y Sal 1.1 kg -> insumo "Sal"). NULL = producto suelto.';

-- Lee el tamano escrito en un nombre: devuelve {cantidad, unidad} o NULL.
-- "Sal La Fina 1.1 kg" -> 1.1 kg · "FRESA 454 G" -> 454 g · "Vinagre 735 ml" -> 735 ml · "Spaghetti 3 kg" -> 3 kg
-- Ignora numeros pegados a x/pk/c (12x90, 3 pack, c/100: son conteos, no el tamano) y codigos de 5+ digitos.
CREATE OR REPLACE FUNCTION public.leer_contenido(p_nombre text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  WITH t AS (
    SELECT lower(translate(COALESCE(p_nombre, ''), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) AS s
  ), m AS (
    SELECT (regexp_matches(t.s, '(?<![a-z0-9./])([0-9]+(?:[.,][0-9]+)?)\s*(kgs?|kilos?|kilogramos?|grs?|gramos?|g|lts?|litros?|l|mls?|mililitros?|ml|oz|onzas?)\M', 'g')) AS c
    FROM t
  )
  SELECT jsonb_build_object('cantidad', cant, 'unidad', uni) FROM (
    SELECT replace(c[1], ',', '.')::numeric AS cant,
           CASE WHEN c[2] ~ '^(kg|kgs|kilo|kilos|kilogramo|kilogramos)$' THEN 'kg'
                WHEN c[2] ~ '^(g|gr|grs|gramo|gramos)$'                  THEN 'g'
                WHEN c[2] ~ '^(l|lt|lts|litro|litros)$'                  THEN 'lt'
                WHEN c[2] ~ '^(ml|mls|mililitro|mililitros)$'            THEN 'ml'
                ELSE 'oz' END AS uni
    FROM m WHERE replace(c[1], ',', '.')::numeric > 0 AND split_part(c[1], '.', 1) !~ '^[0-9]{5,}$'
    LIMIT 1
  ) q
$function$;

-- Agrupa presentaciones bajo un insumo (lo crea si no existe) y, de paso, guarda cuanto trae cada una.
-- p_contenidos: [{"producto_id": uuid, "cantidad": 1.1, "unidad": "kg"}, ...] (opcional; sin esto solo agrupa).
CREATE OR REPLACE FUNCTION public.admin_agrupar_insumo(
  p_productos uuid[], p_nombre text, p_unidad_base text, p_contenidos jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_suc uuid; v_ids uuid[]; v_sucs uuid[]; v_insumo uuid; c jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN RAISE EXCEPTION 'falta el nombre del insumo'; END IF;
  IF p_unidad_base IS NULL OR btrim(p_unidad_base) = '' THEN RAISE EXCEPTION 'falta la unidad base'; END IF;

  SELECT array_agg(DISTINCT id), array_agg(DISTINCT sucursal_id)
    INTO v_ids, v_sucs FROM public.catalogo_productos WHERE id = ANY(p_productos);
  IF v_ids IS NULL OR cardinality(v_ids) < 1 THEN RAISE EXCEPTION 'no se encontraron los productos'; END IF;
  IF cardinality(v_sucs) <> 1 THEN RAISE EXCEPTION 'las presentaciones son de sucursales distintas'; END IF;
  v_suc := v_sucs[1];

  -- reusa el insumo si ya existe con ese nombre en la sucursal
  SELECT id INTO v_insumo FROM public.insumos WHERE sucursal_id = v_suc AND lower(nombre) = lower(btrim(p_nombre));
  IF v_insumo IS NULL THEN
    INSERT INTO public.insumos (nombre, unidad_base, sucursal_id)
    VALUES (btrim(p_nombre), btrim(p_unidad_base), v_suc) RETURNING id INTO v_insumo;
  ELSE
    UPDATE public.insumos SET unidad_base = btrim(p_unidad_base) WHERE id = v_insumo;
  END IF;

  UPDATE public.catalogo_productos SET insumo_id = v_insumo WHERE id = ANY(v_ids);

  -- cuanto trae cada presentacion (solo las que vengan en p_contenidos)
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_contenidos, '[]'::jsonb)) LOOP
    IF (c->>'cantidad') IS NOT NULL AND (c->>'unidad') IS NOT NULL AND (c->>'cantidad')::numeric > 0 THEN
      UPDATE public.catalogo_productos
         SET contiene_cantidad = (c->>'cantidad')::numeric, contiene_unidad = btrim(c->>'unidad')
       WHERE id = (c->>'producto_id')::uuid AND id = ANY(v_ids);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('insumo_id', v_insumo, 'nombre', btrim(p_nombre),
                            'unidad_base', btrim(p_unidad_base), 'presentaciones', cardinality(v_ids));
END
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_agrupar_insumo(uuid[], text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_agrupar_insumo(uuid[], text, text, jsonb) TO authenticated, service_role;

-- Saca una presentacion de su insumo (y borra el insumo si queda vacio).
CREATE OR REPLACE FUNCTION public.admin_quitar_de_insumo(p_producto uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_insumo uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no autorizado'; END IF;
  SELECT insumo_id INTO v_insumo FROM public.catalogo_productos WHERE id = p_producto;
  UPDATE public.catalogo_productos SET insumo_id = NULL WHERE id = p_producto;
  IF v_insumo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.catalogo_productos WHERE insumo_id = v_insumo) THEN
    DELETE FROM public.insumos WHERE id = v_insumo;
  END IF;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_quitar_de_insumo(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_quitar_de_insumo(uuid) TO authenticated, service_role;
