# PLAN — "Cerebro" de la IA (vault de paneles ligados)

> Meta: subir un ticket → "500 pz de alitas" → se va solo a su categoría y al total de
> compras, revisando lo menos posible. El cerebro es la superficie donde ligo
> **Comercios ↔ Categorías ↔ Productos (↔ Unidad)** y desde ahí la IA aprende a rutear.
>
> Decisión de diseño: **paneles ligados** (3 columnas estilo Obsidian), NO grafo de física.
> Ligas **tipadas** (con reglas), no libres:
> - Producto → Categoría: **una sola** (si no, se duplica el gasto)
> - Producto → Unidad: una sola
> - Comercio → Categorías: **varias** (Costco vende de todo)
> - Comercio → Productos: varias (observado automáticamente)

Estado: EN EJECUCIÓN (paneles ligados). Hechas: Fase 0, Fase 1, Fase 3 + fix renglón. Pendientes: Fase 2, Fase 4, Fase 5. Última actualización: 2026-06-05.

---

## FASE 0 — Cimientos de datos (migración 017) ✅ HECHA
- [x] **Migración 017**: `catalogo_productos.categoria_id` ahora **NULLABLE**.
- [x] **RPC `ligar_huerfano(p_nombre, p_categoria_id, p_sucursal_id, p_unidad, p_sinonimos)`**:
  crea/actualiza el producto y **rellena hacia atrás** los renglones sin categoría que
  coincidan (por producto o por nombre): set `categoria_id`, `producto_catalogo_id`, `unidad`,
  recalcula `necesita_revision`. Es el "se va solito a su categoría", también retroactivo.
- Nota: se descartó materializar nodos huérfanos en `catalogo_productos` al ingestar
  (evita ruido tipo "TOTAL"/"VARIOS"); los huérfanos viven como `ticket_items` sin categoría.

## FASE 1 — Editar y BORRAR categorías ✅ HECHA
- [x] `/admin/catalogo`: botón **borrar** con reasignación segura (mueve productos+renglones a
  otra categoría antes de borrar; limpia override de comercios; si está vacía, borra directo).
- [x] Editar (renombrar / operativo / activa) ya existía + edición por producto.

## FASE 2 — Unidades en todo + tabla de compras filtrable
- [ ] Dashboard "Productos más comprados": **filtro por artículo** (buscador + selector) y por categoría.
- [ ] **Unidad siempre visible** por artículo; manejo claro de unidad mixta (ej. mismo producto en pz y en caja).
- [ ] Asegurar que cada `ticket_items` lleve unidad (default desde el producto si la IA no la trae).
- [ ] Totales por artículo en el periodo (cantidad + gasto), exportables.

## FASE 3 — Cola de huérfanos ✅ HECHA
- [x] `/admin/huerfanos`: agrupa renglones sin categoría por producto (veces/gasto/comercios).
- [x] Ligar de corrido (categoría + unidad + sinónimos) → `ligar_huerfano` con back-fill.
- [x] Entrada en el nav del admin.

## FASE 4 — Tablero "Cerebro" (`/admin/cerebro`, paneles ligados)
3 columnas con resaltado cruzado:
```
COMERCIOS          CATEGORÍAS              PRODUCTOS
- Costco      →    - Insumos          →    🟠 HUÉRFANOS (arriba)
- Gasera Atl. →    - Limpieza              - papa · gramos
- Gas LP           - Desechables           - alitas · pz
                   - Gas (editar/borrar)   - popote · pz
```
- [ ] Clic en comercio → ilumina sus categorías + lista sus productos observados.
- [ ] Clic en categoría → sus productos + comercios que la surten + editar/borrar.
- [ ] Clic en producto huérfano → asignar categoría/unidad (back-fill) o crear sinónimo de otro.
- [ ] Comercio → forzar categoría (override) cuando siempre es lo mismo (gasolinera).
- [ ] Agregar la entrada "Cerebro" al nav del admin.
- [ ] (Opcional posterior) vista "mapa" de solo-lectura tipo grafo.

## FASE 6 — Alertas de precio (la finalidad: saber cuánto y en qué gastamos)
- [ ] Guardar precio unitario por producto al confirmar (usar `precio_referencia` + historial).
- [ ] Al procesar un ticket, comparar el precio nuevo vs el de referencia del producto;
  si sube/baja más de X% → alerta `precio_anomalo` para avisar al admin.
- [ ] En el dashboard, ver evolución de precio por producto.

## FASE 7 — Equivalencias / inventario
- [ ] Equivalencias por producto: "1 cono de huevo = 30 huevos", "1 caja = 24 pz".
  Permite convertir compras a unidades base y, eventualmente, descontar inventario.
- [ ] Rellenar inventario automáticamente desde las compras confirmadas.

## FASE 5 — Afinar el ruteo (cumplir la meta)
- [ ] Revisar `matchProductInCatalog` con datos reales (precisión de typos/sinónimos).
- [ ] (Opcional) tabla explícita `comercio_productos` para confirmar/quitar producto de un comercio.
- [ ] Métrica: % de renglones auto-ruteados sin revisión (que suba con el tiempo).

---

## Orden sugerido de ejecución
1. FASE 1 (borrar categorías) — rápido, ya hace falta.
2. FASE 0 (cimientos: nullable + RPC back-fill + huérfanos en edge fn).
3. FASE 3 (cola de huérfanos) — primer pago grande del back-fill.
4. FASE 2 (compras filtrable + unidades).
5. FASE 4 (tablero cerebro) — junta todo lo anterior visualmente.
6. FASE 5 (afinación continua).

## Notas / riesgos
- Back-fill por nombre debe ser conservador (solo items sin categoría) para no re-mover lo ya corregido a mano.
- Borrar categoría: nunca dejar items/productos colgando; siempre reasignar o bloquear.
- Mantener todo **por sucursal** (global = sucursal_id null), como el resto del admin.
- Edge functions se despliegan por MCP con los 4 archivos inline (no hay token CLI).
