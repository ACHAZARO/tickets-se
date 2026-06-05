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

Estado: PLAN aprobado (paneles ligados, hacer todo por fases). Última actualización: 2026-06-05.

---

## FASE 0 — Cimientos de datos (migración 017 + edge function)
Sin esto, los huérfanos no tienen nodo y el ruteo retroactivo no existe.

- [ ] **Migración 017**: `catalogo_productos.categoria_id` pasa a **NULLABLE** (producto huérfano = nodo sin categoría aún).
- [ ] **RPC `ligar_producto_categoria(p_producto_id, p_categoria_id, p_unidad)`** (SECURITY DEFINER):
  1. set `categoria_id` (+ `unidad_default`) en el producto.
  2. **Back-fill**: a TODOS los `ticket_items` con ese `producto_catalogo_id` (y los que hagan match por nombre y estén sin categoría) → set `categoria_id`, `unidad`, `necesita_revision=false`, limpia `motivo_revision`.
  3. Resuelve alertas `producto_no_reconocido`/`sin_categoria` que ya no apliquen.
  → Esto es el "se va solito a su categoría", también hacia atrás.
- [ ] **procesar-ticket v22**: cuando un renglón quede SIN categoría, crear/asegurar un
  **producto huérfano** (`categoria_id` null) y ligar el `ticket_items.producto_catalogo_id`,
  para que aparezca como nodo en el cerebro y en la cola de huérfanos.

## FASE 1 — Editar y BORRAR categorías (fundamental)
- [ ] En `/admin/catalogo`: botón **borrar categoría** con guarda:
  - si tiene productos o renglones → pedir **reasignar a otra categoría** (mueve productos+items) antes de borrar; o cancelar.
  - si está vacía → borrar directo.
- [ ] Editar (renombrar / operativo / activa) ya existe → dejar consistente.

## FASE 2 — Unidades en todo + tabla de compras filtrable
- [ ] Dashboard "Productos más comprados": **filtro por artículo** (buscador + selector) y por categoría.
- [ ] **Unidad siempre visible** por artículo; manejo claro de unidad mixta (ej. mismo producto en pz y en caja).
- [ ] Asegurar que cada `ticket_items` lleve unidad (default desde el producto si la IA no la trae).
- [ ] Totales por artículo en el periodo (cantidad + gasto), exportables.

## FASE 3 — Cola de huérfanos
- [ ] Pantalla que junta productos huérfanos (`categoria_id` null) + renglones sin categoría.
- [ ] Ligar **de corrido**: categoría + unidad + sinónimos en un flujo rápido → llama `ligar_producto_categoria` (back-fill).
- [ ] Reemplaza el ir alerta-por-alerta para el caso "producto no reconocido".

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
