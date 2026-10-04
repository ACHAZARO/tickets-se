-- 087: bitacora del SEGUNDO REVISOR IA en modo prueba (ver PLAN_REVISOR_IA.md).
-- Guarda lo que el revisor HABRIA decidido sobre un ticket ya revisado, para compararlo contra la decision humana.
-- No cambia ningun ticket. Solo la escribe la edge function `revisor-ia` (service_role); el admin la puede leer.
CREATE TABLE IF NOT EXISTS public.revisor_ia_pruebas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_ticket_id uuid NOT NULL REFERENCES public.registros_tickets(id) ON DELETE CASCADE,
  modelo             text NOT NULL,
  version_prompt     text NOT NULL,
  veredicto          text,               -- aprobar | humano | NULL si la IA fallo
  juicio             jsonb,              -- respuesta completa del revisor
  contexto           jsonb,              -- alertas y datos que se le dieron (para auditar por que decidio asi)
  uso                jsonb,              -- tokens
  error              text,
  ms                 integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisor_ia_pruebas_ticket_idx ON public.revisor_ia_pruebas (registro_ticket_id, created_at DESC);

ALTER TABLE public.revisor_ia_pruebas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revisor_ia_pruebas_admin_read ON public.revisor_ia_pruebas;
CREATE POLICY revisor_ia_pruebas_admin_read ON public.revisor_ia_pruebas FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.revisor_ia_pruebas FROM anon;
