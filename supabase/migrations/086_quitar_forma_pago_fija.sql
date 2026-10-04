-- 086: quita la columna fija de 084 (0 filas con valor). Se aplica DESPUES de publicar el procesar-ticket que ya
-- guarda en ticket_pagos (el de 084 escribia esta columna y fallaria sin ella).
ALTER TABLE public.registros_tickets DROP CONSTRAINT IF EXISTS registros_tickets_forma_pago_valida;
ALTER TABLE public.registros_tickets DROP COLUMN IF EXISTS forma_pago;
