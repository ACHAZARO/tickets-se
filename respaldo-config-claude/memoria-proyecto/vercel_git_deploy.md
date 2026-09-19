---
name: vercel-git-deploy
description: "Vercel tickets-se Git auto-deploy setup, monorepo rootDirectory, remote owner casing"
metadata: 
  node_type: memory
  type: project
  originSessionId: 600df12a-0ae6-4167-b0e1-4ad27d427ff8
---

El proyecto Vercel `tickets-se` (prj_JtlVuF0E5DV5W3xM1MvkF6RyU87C, team achazaros-projects) NO estaba conectado a Git hasta el 2026-06-03 — todos los deploys eran manuales por CLI (`vercel --prod` desde `frontend/`). El CLAUDE.md afirmaba "Vercel auto-deploya desde GitHub" pero era falso.

**Configuracion correcta (ya aplicada):**
- Git conectado: `ACHAZARO/tickets-se`, production branch `main`.
- `rootDirectory: frontend` (CLAVE: es monorepo, el Next.js no esta en la raiz del repo). Sin esto los builds por Git push fallan buildeando desde la raiz.
- Remote local debe usar owner en MAYUSCULAS `ACHAZARO/tickets-se.git`; con `achazaro` (minusculas) GitHub responde 301 "repository moved".

**Verificado:** push a `main` dispara auto-deploy con origen git. Token Vercel CLI en `~/AppData/Roaming/com.vercel.cli/Data/auth.json`.

**Why:** evita re-diagnosticar por que un merge no se publica solo. **How to apply:** si un cambio en main no aparece en prod, revisar que rootDirectory siga en `frontend` y que el link de Git no se haya roto.
