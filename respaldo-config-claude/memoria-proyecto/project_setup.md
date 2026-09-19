---
name: project-setup
description: "Initial setup of tickets-se project - all services configured, secrets pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d41b7f3-06db-472f-b1e8-4ddc8d569232
---

Proyecto tickets-se configurado el 2026-06-02 con todos los servicios externos listos.

**Why:** Alejandro necesita una app rapida para que gerentes de Santa Elena suban tickets de gastos y se procesen con IA a Google Sheets.

**How to apply:** No re-hacer setup. Verificar PROJECT_STATE.md para estado actual. Los secrets de Supabase (JWT_SECRET, GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEETS_ID) quedaron pendientes de configurar -- el CLI necesita login interactivo. La key de la service account esta en %TEMP%\tickets-se-sa-key.json.

Related: [[gcloud-config]]
