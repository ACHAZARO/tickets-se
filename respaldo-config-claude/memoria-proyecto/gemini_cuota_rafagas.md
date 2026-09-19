---
name: gemini-cuota-rafagas
description: "La IA 'no funcionaba' por cuota del tier gratis de Gemini en rafagas, no por calidad; Sheets nunca funciono; push 403"
metadata: 
  node_type: memory
  type: project
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-18T17:20:56.410Z
---

Diagnosticado 2026-09-18: el gerente de Wings Palace sube cientos de fotos de golpe (14-jul, 6-ago, 11-sep).
Con la API key de Gemini en TIER GRATIS solo se leian ~55-80 por rafaga; 500 tickets quedaron "ilegible" con
fecha de subida inventada. Donde Gemini si leyo, la categoria acerto ~95%. Alejandro percibia "se equivoca mucho".

**Why:** el sintoma ("IA mala") engaña; la evidencia estaba en `gemini_raw._error` (404 del ultimo modelo de la
cadena) y en el patron temporal (todo OK y luego todo falla = cuota diaria).

**How to apply:**
- Antes de culpar al modelo, revisar `gemini_raw ? '_error'` / alerta `ia_sin_leer` y el patron por hora.
- Solucion estructural: facturacion en AI Studio (proyecto tickets-se) + modelo Gemini 3.x (2.5-flash podria
  apagarse 16-oct-2026). Research: Gemini 3.x > Claude en manuscrito y mas barato; Haiku el mas debil.
- Google Sheets: 0 filas desde junio (secret GOOGLE_SERVICE_ACCOUNT_KEY mal formado). Alejandro: arreglar y
  rellenar historial DESPUES de tener tickets bien clasificados.
- Deploy de edge functions solo via Supabase MCP (sin token CLI); el clasificador de permisos pide confirmacion
  explicita para procesar-ticket. git push dio 403 (credencial GCM solo lectura) -> Alejandro renueva.

Relacionado: [[multiproducto-gemini]] [[fase3-arqueo-modelo]]
