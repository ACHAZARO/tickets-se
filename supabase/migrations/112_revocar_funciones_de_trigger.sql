-- 112 (2026-11-03): las funciones de trigger no se llaman por la API; sin permiso de ejecucion para nadie de afuera (lo marca el asesor de seguridad).
revoke all on function public.tg_sucursal_prueba() from public, anon, authenticated;
revoke all on function public.tg_autorizacion_renglon() from public, anon, authenticated;
revoke all on function public.tg_autorizacion_alerta() from public, anon, authenticated;
