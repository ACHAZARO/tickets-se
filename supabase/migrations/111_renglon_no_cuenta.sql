-- 111 (2026-11-03): cualquier renglon se puede marcar "no cuenta, no es del negocio", no solo los articulos no autorizados. Caso: una
-- galleta de $7 en un ticket de farmacia; los aromatizantes si cuentan. El renglon se queda (evidencia) y va a "Por justificar".
create or replace function public.decidir_renglon_no_autorizado(p_item uuid, p_aprobar boolean, p_categoria uuid default null::uuid)
returns jsonb
language plpgsql security definer set search_path = 'public'
as $function$
declare
  v_ticket uuid;
  v_pend   integer;
begin
  if not public.is_admin() then raise exception 'no autorizado'; end if;
  -- 101: el renglon y la categoria deben ser de la cuenta activa.
  if not exists (select 1 from ticket_items i join registros_tickets r on r.id = i.registro_ticket_id
                  where i.id = p_item and r.sucursal_id in (select public.mis_sucursales())) then raise exception 'no autorizado'; end if;
  if p_categoria is not null and not exists (select 1 from categorias_gasto where id = p_categoria and cuenta_id = public.mi_cuenta()) then
    raise exception 'categoria no encontrada';
  end if;
  update ticket_items i set
      autorizacion = case when p_aprobar then 'aprobado' else 'rechazado' end,
      categoria_id = case when p_aprobar
                          then coalesce(p_categoria, (select categoria_id from catalogo_productos where id = i.producto_catalogo_id), i.categoria_id)
                          else i.categoria_id end,
      autorizacion_por = coalesce(auth.jwt() ->> 'email', 'admin'),
      autorizacion_en = now(),
      aviso_gerente_visto = null
   where i.id = p_item and (i.autorizacion in ('pendiente', 'aprobado', 'rechazado') or not p_aprobar)
  returning i.registro_ticket_id into v_ticket;
  if v_ticket is null then raise exception 'renglon no encontrado o sin revision pendiente'; end if;
  select count(*) into v_pend from ticket_items where registro_ticket_id = v_ticket and autorizacion = 'pendiente';
  if v_pend = 0 then
    update alertas_tickets set resuelta = true where registro_ticket_id = v_ticket and tipo = 'articulo_no_autorizado' and not resuelta;
  end if;
  return jsonb_build_object('ticket_id', v_ticket, 'pendientes', v_pend);
end
$function$;
