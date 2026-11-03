-- 114 (2026-11-03): el dueno puede decir que un empate automatico esta mal; ese ticket ya no se vuelve a proponer para esa salida.
alter table public.salidas_caja add column if not exists no_es uuid[] not null default '{}';
