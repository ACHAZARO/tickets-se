-- ============================================================
-- MIGRACION: 014 - Admin puede eliminar tickets
-- Borrar un registro_tickets cascada a ticket_items y alertas_tickets.
-- Tambien permite borrar la foto del bucket.
-- ============================================================

CREATE POLICY "Admin delete registros"
  ON public.registros_tickets FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin borra fotos por-revisar"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'por-revisar' AND auth.role() = 'authenticated');

CREATE POLICY "Admin borra fotos archivo"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'archivo' AND auth.role() = 'authenticated');
