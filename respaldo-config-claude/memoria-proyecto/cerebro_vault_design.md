# Cerebro / Vault de la IA (Revisión de Tickets)

Fecha: 2026-06-05

## Qué es
Rediseño pedido por Alejandro: un "cerebro" tipo vault de Obsidian para entrenar a la IA
de Google (Gemini). El usuario liga visualmente **Comercios ↔ Categorías ↔ Productos (↔ Unidad)**
y desde ahí la IA rutea solo los tickets. Meta final: subir ticket → "500 pz de alitas" →
va directo a su categoría y al total de compras, revisando lo menos posible.

## Decisión de diseño (debatida y aprobada)
- **Paneles ligados**, NO grafo de física (telaraña ilegible en celular y caro). 3 columnas
  Comercios | Categorías | Productos con huérfanos arriba; ligar con clic. Opción futura:
  vista "mapa" de solo-lectura.
- **Ligas tipadas, no libres** (clave para no duplicar gastos):
  - Producto → Categoría: UNA sola.
  - Producto → Unidad: una sola.
  - Comercio → Categorías: varias (Costco vende de todo).
  - Comercio → Productos: varias (observado).

## Plan por fases — ✅ TODAS COMPLETAS (ver PLAN_CEREBRO.md)
- Fase 0 ✅ migración 017: `catalogo_productos.categoria_id` NULLABLE + RPC `ligar_huerfano`
  (crea/actualiza producto y rellena hacia atrás renglones sin categoría, por producto o nombre).
- Fase 1 ✅ borrar categorías con reasignación segura (catalogo).
- Fase 2 ✅ dashboard: filtro por artículo en "Productos más comprados" + unidad.
- Fase 3 ✅ `/admin/huerfanos`: cola de productos sin categoría, ligar de corrido con back-fill.
- Fase 4 ✅ `/admin/cerebro`: tablero de paneles ligados (3 columnas, resaltado cruzado, ligar huérfanos, mover producto).
- Fase 5 ✅ métrica "Auto-clasificado %" en dashboard.
- Fase 6 ✅ migración 018 (precio_historial) + procesar-ticket v22 (registrarPrecios → alerta `precio_anomalo` si salto >40%).
- Fase 7 ✅ equivalencias por producto (contiene_cantidad/contiene_unidad) en catálogo.

## Pulido 2026-06-06 (precisión)
- Matcher `matchProductInCatalog` (procesar-ticket v24): sinónimos/nombres <4 chars SOLO match
  exacto; match por palabra = token completo (no substring). Antes "gas"/"1" como sinónimo
  arrastraba renglones equivocados. Limpieza de datos de esos sinónimos.
- Aprendizaje de sinónimos también al RENOMBRAR en la revisión (lo que leyó la IA → sinónimo).
- Precios y Entradas leen renglones confirmados (fuente real), no tablas derivadas.
- Reporte (Excel) multi-hoja en dashboard. Catálogo renombra (viejo→sinónimo). Cerebro liga
  (forzar categoría de comercio + equivalencia al ligar contenedores). Tickets: confirmar pendiente.
- Página /admin/huerfanos eliminada (viven en Cerebro). Inventario renombrado a "Entradas".
- Orphan conocido: `consumo_inventario` (mig. 019) sin UI tras renombrar a Entradas.

## Decisiones técnicas no obvias
- Huérfanos NO se materializan como productos al ingestar (evita ruido "TOTAL"/"VARIOS");
  viven como `ticket_items` con categoria_id null. Se materializan al ligarlos (RPC).
- Bug arreglado: renglones se insertan en lote (mismo created_at); ordenar solo por created_at
  rebarajeaba la lista al guardar → "el renglón salta/desaparece". Fix: orden (created_at, id)
  + actualizar en memoria sin recargar.
- Edge functions se despliegan por MCP con los 4 archivos inline (no hay token CLI de supabase).
