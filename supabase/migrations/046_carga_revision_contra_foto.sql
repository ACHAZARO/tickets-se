-- 046: carga de revisiones contra foto sin pasar SQL gigante por el chat. El admin sube un JSON (desde el navegador)
-- a _tmp_carga y aplicar_revision() lo aplica: respaldos + sinonimos + productos nuevos + lectura corregida en gemini_raw
-- (los confirmados vuelven a pendiente para rehacer renglones con reprocesar-ticket desde_guardada). Claude 2026-09-18.
-- Lotes aplicados con esto: se_ago (158 tickets), se_resto (350), wp_resto (ver 050). Respaldos: respaldo.r_<lote>_*.
create table if not exists public._tmp_carga (
  lote text not null, tipo text not null check (tipo in ('parche', 'sinonimos', 'nuevo')),
  clave text not null, datos jsonb not null, creado timestamptz not null default now()
);
alter table public._tmp_carga enable row level security;
drop policy if exists tmp_carga_insert_admin on public._tmp_carga;
create policy tmp_carga_insert_admin on public._tmp_carga for insert to authenticated with check (is_admin());

create or replace function public.aplicar_revision(p_lote text, p_suc uuid) returns jsonb
language plpgsql set search_path = public as $$
declare n_sin int; n_nuevos int; n_tickets int; n_carga int;
begin
  select count(*) into n_carga from _tmp_carga where lote = p_lote;
  if n_carga = 0 then raise exception 'lote % sin datos en _tmp_carga', p_lote; end if;
  if exists (select 1 from _tmp_carga where lote = p_lote group by tipo, clave having count(*) > 1) then
    raise exception 'lote % tiene filas repetidas (subido dos veces?)', p_lote;
  end if;
  execute format('create table if not exists respaldo.%I as select * from catalogo_productos where sucursal_id is null or sucursal_id = %L', 'r_' || p_lote || '_catalogo', p_suc);
  execute format('create table if not exists respaldo.%I as select id, estado, fecha_ticket, comercio, monto, folio_ticket, gemini_raw, confirmado_en from registros_tickets where id in (select clave::uuid from _tmp_carga where lote = %L and tipo = ''parche'')', 'r_' || p_lote || '_tickets', p_lote);
  execute format('create table if not exists respaldo.%I as select * from ticket_items where registro_ticket_id in (select clave::uuid from _tmp_carga where lote = %L and tipo = ''parche'')', 'r_' || p_lote || '_items', p_lote);

  update catalogo_productos c set sinonimos = (select array_agg(distinct x) from unnest(c.sinonimos || array(select jsonb_array_elements_text(t.datos->'sinonimos'))) x)
  from _tmp_carga t
  where t.lote = p_lote and t.tipo in ('sinonimos', 'nuevo') and lower(c.nombre) = lower(t.clave) and c.activo and (c.sucursal_id = p_suc or c.sucursal_id is null);
  get diagnostics n_sin = row_count;

  insert into catalogo_productos (nombre, sinonimos, categoria_id, unidad_default, sucursal_id, activo)
  select t.clave, array(select jsonb_array_elements_text(t.datos->'sinonimos')),
    (select g.id from categorias_gasto g where g.nombre = t.datos->>'categoria' and (g.sucursal_id is null or g.sucursal_id = p_suc) limit 1),
    t.datos->>'unidad', p_suc, true
  from _tmp_carga t
  where t.lote = p_lote and t.tipo = 'nuevo'
    and not exists (select 1 from catalogo_productos c where lower(c.nombre) = lower(t.clave) and c.activo and (c.sucursal_id = p_suc or c.sucursal_id is null));
  get diagnostics n_nuevos = row_count;

  update registros_tickets r set
    gemini_raw = coalesce(r.gemini_raw, '{}'::jsonb) - '_ia_fallo' - '_error' - '_intentos' - '_ia_en_proceso' - '_fecha_asumida' - '_impuestos_sumados' - '_montos_repartidos'
      || t.datos || jsonb_build_object('_estaba_confirmado', r.estado = 'confirmado'),
    estado = 'pendiente'
  from _tmp_carga t
  where t.lote = p_lote and t.tipo = 'parche' and r.id = t.clave::uuid and r.estado in ('pendiente', 'confirmado') and r.sucursal_id = p_suc;
  get diagnostics n_tickets = row_count;

  return jsonb_build_object('filas_carga', n_carga, 'productos_con_sinonimos', n_sin, 'productos_nuevos', n_nuevos, 'tickets', n_tickets);
end $$;
revoke all on function public.aplicar_revision(text, uuid) from public, anon, authenticated;
