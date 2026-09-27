---
name: unificar-productos
description: "Regla profunda de Alejandro (20-sep-2026): duplicados del catalogo se detectan, se avisan en Cerebro y se PREGUNTAN; nunca se unen solos"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f679bdfe-7792-4f51-9d7b-071fd3adb4ea
  modified: 2026-09-20T19:23:44.480Z
---

Cuando el catalogo tiene el mismo insumo con dos nombres ("Mantequilla" / "Mantequilla Gloria 1 kg"), el sistema debe detectarlo, mandar una alerta en Cerebro y preguntar a Alejandro si los unifica en un solo insumo. NUNCA se unen solos.

**Why:** los duplicados parten el gasto por producto (la API `/desglose` y Entradas/Stock muestran lo mismo en dos renglones). Pero las reglas automaticas dan falsos positivos (Coca-Cola / Coca-Cola Zero, Tapa 14 oz / 16 oz), asi que la decision es de el, una pregunta por caso, y "No son iguales" se recuerda.

**How to apply:**
- Ya construido (migraciones 070-072, 075; `frontend/app/admin/unificar.tsx`): circulito ambar junto a "Cerebro", panel "Posibles duplicados" arriba de Cerebro (Unificar en A / en B / No son iguales) y boton "unificar" por producto en Catalogo.
- Motor `_unificar_productos`: misma categoria y misma sucursal; mueve renglones, precio_historial y consumo_inventario; el que se queda aprende el nombre como sinonimo; cada renglon conserva lo capturado; respaldo en `respaldo.unificaciones_productos`.
- Presentaciones distintas (medidas distintas en el nombre) NO son duplicados. Codigos de proveedor de 5+ digitos no cuentan como medidas.
- Cualquier consulta que corra en la barra del admin (todas las pantallas) debe ser rapida (<200 ms) y con guarda de "ultima carga": el limite de tiempo de Supabase es ~8 s y las cargas de "todas" y "sucursal" se cruzan al abrir.
- El catalogo es POR SUCURSAL (la otra sesion trabaja en cero productos globales, migracion 074). Ya unificado a peticion: Santa Elena "Mantequilla" -> "Mantequilla Gloria 1 kg".
Relacionado: [[subidos-vs-oficiales-api]].
