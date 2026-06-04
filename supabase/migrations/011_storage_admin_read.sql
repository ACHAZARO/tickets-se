-- ============================================================
-- MIGRACION: 011 - Lectura de fotos para el admin
-- Los buckets por-revisar y archivo son privados. El admin autenticado
-- necesita leerlos para mostrar la foto del ticket (via signed URLs).
-- ============================================================

CREATE POLICY "Admin lee fotos por-revisar"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'por-revisar' AND auth.role() = 'authenticated');

CREATE POLICY "Admin lee fotos archivo"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'archivo' AND auth.role() = 'authenticated');
