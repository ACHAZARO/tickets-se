---
name: app-para-vender-aislamiento
description: "La app se vendera a otros locales: regla de oro (nada de un negocio en codigo compartido), donde vive cada cosa y que falta antes de vender (2026-09-20)"
metadata: 
  node_type: memory
  type: project
  originSessionId: e7f6dfb4-e5f5-41ea-a429-fd126748f38b
  modified: 2026-09-20T19:27:58.483Z
---

Alejandro planea vender esta app a otros locales. Lo que la IA aprende de sus negocios (Wings Palace, cafe Santa Elena) debe
quedarse en SU negocio y no alterar a los que lleguen despues.

**Why:** otro negocio que suba tickets no debe heredar nuestras categorias, productos, nombres de familia ni reglas.

**How to apply (REGLA DE ORO):** nada propio de un negocio se escribe en codigo compartido (`_shared/gemini.ts`,
`duplicados.ts`, etc.). Cuando Alejandro dicte una regla nueva de su negocio ("X va a Bodega", "las motos de fulano son
Extras") se agrega como FILA en la tabla `reglas_ia` (cuenta_id + sucursal_id opcional; se inyecta sola al final del prompt,
sin desplegar nada). Como aparece el negocio como cliente en los tickets: `sucursales.nombres_cliente`. Productos siempre con
sucursal (`catalogo_productos.sucursal_id` es NOT NULL desde la migracion 074). Al codigo compartido solo van reglas
universales (tickets de Mexico, IVA, envio a mano, senales de alteracion).

Estado 2026-09-20 (migraciones 073-074, hecho con OK de Alejandro): prompt sin nada nuestro, reglas en `reglas_ia` (SE 2,
WP 1; cada lectura guarda `gemini_raw._reglas_negocio`; si no cargan, el ticket no se lee y queda para releer), cero
productos globales, `ligar_huerfano` por sucursal, foto repetida solo dentro de la cuenta.

Pendiente antes del primer cliente externo (es plataforma, no aprendizaje): permisos por cuenta (`is_admin()` es global),
DEFAULT de `sucursales.cuenta_id`, categorias y objetivos globales, pantalla para `reglas_ia`, correo de alertas y Google
Sheets unicos, fotos sin separar por negocio, umbrales fijos, zona horaria, marca "Tickets SE". Detalle completo en
`MULTI_NEGOCIO.md` del repo. Relacionado: [[subidos-vs-oficiales-api]], [[envios-y-motos]], [[unificar-productos]].
