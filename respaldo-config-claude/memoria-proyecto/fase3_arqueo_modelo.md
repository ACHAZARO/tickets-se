---
name: fase3-arqueo-modelo
description: "Fase 3 es auditoria de costos (gasto vs ventas como % ), no presupuesto plano; ventas manuales mensuales + rango libre prorrateado"
metadata: 
  node_type: memory
  type: project
  originSessionId: c8978e0f-c3d2-4712-b7ef-121c5899992d
---

El "dashboard de presupuestos" de Fase 3 en realidad es **auditoria de costos (arqueo)**:
el gasto esperado NO es un monto fijo, es un **% de la venta** (ej. Insumos ~30% de la venta).
La funcion principal es arqueo semanal/mensual por sucursal: gasto real (tickets
confirmados) vs ventas, con objetivo % por categoria y semaforo verde/rojo.

**Decisiones clave (2026-06-03):**
- Vive en web `/admin` (no en Google Sheets). Pantallas: `/admin/dashboard` (arqueo),
  `/admin/ventas` (captura), `/admin/objetivos` (% por categoria).
- **Ventas: captura manual mensual** por ahora. El POS se explorara despues; el usuario
  no estaba seguro de sus capacidades de export/API. El modelo no cambia al integrar POS.
- **Periodo modelo A+C**: ventas se capturan mensual (robusto, siempre cuadra), pero el
  dashboard tiene selector de mes (exacto) Y rango de fechas libre (gastos exactos por
  fecha_ticket, venta prorrateada por dias y marcada "estimada"). Logica en `lib/arqueo.ts`.
- Solo cuentan tickets `estado='confirmado'` como gasto.
- Graficos en SVG/CSS puro (dona con conic-gradient, tendencia en barras) — sin recharts.
- Export a Excel con SheetJS (`xlsx`), import dinamico para no inflar el bundle.
- Tablas migracion 008: `ventas` y `objetivos_costo` (sucursal_id NULL = global).

**Why:** el nombre "presupuesto" engania; el usuario piensa en control de costo sobre venta.
**How to apply:** si pide cambios al dashboard, recordar que el comparativo es gasto/venta vs
objetivo %, y que ventas son manuales mensual. [[vercel-git-deploy]]
