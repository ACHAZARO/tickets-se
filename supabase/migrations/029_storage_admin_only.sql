-- 029: endurecer el storage de fotos de tickets a is_admin() (quedo fuera del hardening 023).
-- Antes: SELECT/DELETE solo exigian auth.role()='authenticated' -> cualquier usuario logueado
-- (no solo el allowlist admin_users) podia leer/borrar TODAS las fotos cross-sucursal. Ademas
-- habia policies "Authenticated read/upload por-revisar" sin chequeo de admin.
-- El admin lee via signed URL (createSignedUrl) y borra via .remove(): ambos pasan is_admin().
-- El kiosko NO sube a storage directo; las edge functions usan service_role (policies aparte).
-- Verificado en vivo: admin genera signed URL (200), anonimo bloqueado (400 not_found).

drop policy if exists "Admin lee fotos por-revisar" on storage.objects;
drop policy if exists "Admin lee fotos archivo" on storage.objects;
drop policy if exists "Admin borra fotos por-revisar" on storage.objects;
drop policy if exists "Admin borra fotos archivo" on storage.objects;
drop policy if exists "Authenticated read por-revisar" on storage.objects;
drop policy if exists "Authenticated upload to por-revisar" on storage.objects;

create policy "admin_select_fotos" on storage.objects
  for select to authenticated
  using (bucket_id in ('por-revisar','archivo') and public.is_admin());

create policy "admin_delete_fotos" on storage.objects
  for delete to authenticated
  using (bucket_id in ('por-revisar','archivo') and public.is_admin());
