---
name: insumos-presentaciones
description: "Regla de Alejandro (20-sep-2026): un insumo puede comprarse en varios tamanos; el inventario suma los tamanos, el gasto conserva cada precio"
metadata: 
  node_type: memory
  type: project
  originSessionId: f679bdfe-7792-4f51-9d7b-071fd3adb4ea
  modified: 2026-09-20T21:39:19.425Z
---

Para el INVENTARIO lo que importa es el insumo (Sal), no el articulo (Sal 1 kg / Sal 1.1 kg). Si se compro una de cada una, Entradas y Stock deben decir "Sal: 2.1 kg". Cada presentacion conserva su propio precio y su historial.

**Why:** unificar (070) borraria una de las dos y se perderia el tamano y el precio de cada presentacion. Agrupar (076) deja las dos y solo suma las cantidades en la unidad base.

**How to apply:**
- Tabla `insumos` (nombre + unidad_base kg/lt/pz, por sucursal) + `catalogo_productos.insumo_id`. El "cuanto trae" vive en `contiene_cantidad/contiene_unidad` (equivalencias de 018), que `computeBaseUnits` ya sabe sumar.
- En Cerebro hay dos preguntas distintas sobre el mismo par: "Unificar" (mismo articulo, queda uno) y "Mismo insumo, distinto tamano" (quedan los dos). El motivo `presentacion` (mismo nombre, medidas distintas) MANDA sobre sinonimo/igual.
- `leer_contenido()` lee el tamano del nombre; los multipack ("12x90 g", "3/800 g") quedan en blanco a proposito para que Alejandro los escriba.
- Presentaciones distintas NO siempre son el mismo insumo para inventario (Tapa 14 oz vs 16 oz): por eso se pregunta, nunca se agrupa solo.
- Pendiente cuando se use inventario de verdad: el consumo se registra en la presentacion mas comprada del insumo y se lee de todas.
Relacionado: [[unificar-productos]], [[subidos-vs-oficiales-api]].
