-- 079: el nombre propuesto para el insumo salia con restos ("Tapa negra 12-20 oz" -> "Tapa Negra 12").
-- Ahora, despues de quitar la medida, tambien se quitan los numeros sueltos y la basura de separadores.
-- Es solo una PROPUESTA: en la pantalla el nombre se puede editar antes de guardar.
CREATE OR REPLACE FUNCTION public.nombre_insumo_sugerido(a text, b text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  WITH c AS (
    SELECT n AS orig,
           regexp_replace(n,
             '\m[0-9]+(?:[.,][0-9]+)?\s*(kgs?|kilos?|kilogramos?|grs?|gramos?|g|lts?|litros?|l|mls?|mililitros?|ml|oz|onzas?|lbs?|pz|pzas?|piezas?)\M',
             ' ', 'gi') AS n
    FROM unnest(ARRAY[a, b]) AS n
  ), s AS (   -- numeros sueltos (12, 12-20, 3/4) que quedaron sin unidad
    SELECT orig, regexp_replace(n, '\m[0-9]+(?:[.,/-][0-9]+)*\M', ' ', 'g') AS n FROM c
  ), l AS (   -- separadores y parentesis vacios
    SELECT orig, btrim(regexp_replace(regexp_replace(n, '\(\s*\)|\[\s*\]', ' ', 'g'), '[\s(),/#-]{2,}|[\s(),/#-]+$|^[\s(),/#-]+', ' ', 'g')) AS n
    FROM s
  )
  SELECT COALESCE(
    (SELECT initcap(lower(n)) FROM l WHERE n <> '' ORDER BY length(n), n LIMIT 1),
    (SELECT initcap(lower(btrim(orig))) FROM l ORDER BY length(orig), orig LIMIT 1)
  )
$function$;
