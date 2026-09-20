# Multi-negocio: que esta aislado y que falta antes de vender la app

> Alejandro (2026-09-20): la app se va a vender a otros locales. Lo que la IA aprende de sus negocios (Wings Palace y el cafe
> Santa Elena) debe quedarse en SU negocio y no alterar a los que lleguen despues.

## Regla de oro (para cualquier sesion, de cualquier modelo)

**Nada propio de un negocio se escribe en codigo compartido.** Ni nombres del negocio, ni personas, ni proveedores, ni
productos, ni categorias especiales. Va como DATO de ese negocio:

| Que | Donde vive | Alcance |
|---|---|---|
| Como aparece el negocio como CLIENTE en los tickets | `sucursales.nombres_cliente` | cuenta |
| Reglas de lectura propias ("si dice Bodega...", "motos de Ale/Polo/Toto = Extras") | tabla `reglas_ia` | cuenta (`sucursal_id` NULL) o una sucursal |
| Productos, sinonimos, equivalencias | `catalogo_productos` (`sucursal_id` NOT NULL) | sucursal |
| Proveedores | `comercios` | sucursal |
| Precios | `precio_historial` | sucursal |
| Categoria especial (p. ej. Bodega) | `categorias_gasto` con `sucursal_id` | sucursal |

`_shared/gemini.ts` (el prompt) solo lleva reglas universales: tickets de Mexico, IVA/IEPS, envio anotado a mano, senales
de alteracion. Al final agrega "Reglas propias de este negocio" con lo que haya en `reglas_ia`, y esas mandan.

**Agregar o cambiar una regla de un negocio = una fila en `reglas_ia`** (no hace falta desplegar nada):

```sql
insert into reglas_ia (cuenta_id, sucursal_id, titulo, texto, orden)
values ('<cuenta>', '<sucursal o null>', 'Titulo corto', 'TEXTO DE LA REGLA, en una sola linea, sin acentos', 30);
```

Cada lectura guarda cuantas reglas propias uso en `gemini_raw._reglas_negocio` (hoy: Santa Elena 2, Wings Palace 1). Si las
reglas no se pueden cargar, el ticket NO se lee: queda como "IA no lo leyo" para releer (mejor eso que clasificarlo mal y
auto-confirmarlo).

## Hecho el 2026-09-20 (migraciones 073 y 074 + funciones)

- Prompt compartido sin nombres de negocio, sin la regla de motos de la familia y sin la regla de Bodega: ahora vienen de
  `sucursales.nombres_cliente` y `reglas_ia`. Prueba: el prompt de Santa Elena trae la regla de Bodega identica (mismo md5),
  el de Wings trae motos y no Bodega, y el de un negocio ajeno no trae nada nuestro.
- `_shared/duplicados.ts`: las palabras 'wings', 'palace', 'santa', 'elena' ya no estan fijas; salen de los nombres de las
  sucursales de la cuenta (`palabrasDelNegocio`).
- Foto repetida (mismo archivo): solo se compara contra sucursales de la MISMA cuenta.
- CERO productos globales (eran 21): 12 asignados a su sucursal, 6 divididos con copia (Aguacates, CEBOLLA, Cebollin,
  DESCUENTO, Fibras Metal Cale, Limones), 3 sin uso inactivos. Candado `catalogo_productos.sucursal_id NOT NULL`.
  Respaldo en `respaldo.r074_*`. Unidad y precio de referencia de los divididos quedaron como estaban.
- `ligar_huerfano` trabaja sucursal por sucursal: ya no crea productos globales ni reclasifica renglones de otra sucursal.
- Panel Catalogo: no deja crear categoria ni producto con el selector en "Todas".

## Pendiente ANTES del primer cliente externo (plataforma, no aprendizaje)

1. **Permisos por cuenta.** Hoy `is_admin()` es global: un admin ve y edita TODOS los negocios (todas las politicas RLS,
   storage incluido). Falta `admin_users.cuenta_id` y politicas por cuenta. Es lo mas importante.
2. **Alta de sucursales:** `sucursales.cuenta_id` tiene por DEFAULT la cuenta de Alejandro; una sucursal creada desde el
   panel cae en su cuenta (heredaria sus reglas y nombres). Quitar el default y exigir la cuenta.
3. **Categorias y objetivos de costo globales** (8 categorias, 3 objetivos): renombrar, desactivar o cambiar
   "cuenta en operacion" afecta a todos. Pasarlas a la cuenta y sembrar una plantilla neutra a cada cuenta nueva. El prompt
   general asume que existen "Otros gastos operativos", "Descuentos" y "Extras".
4. **Pantalla para `reglas_ia` y `nombres_cliente`** (hoy solo por SQL).
5. **Correo de alertas** fijo al de Alejandro y remitente "Tickets SE" (`enviar-alerta-email`).
6. **Google Sheets**: una sola hoja para todos (`GOOGLE_SHEETS_ID`).
7. **Fotos**: el bucket `archivo` no separa por negocio (`AAAA-MM/archivo`), y la limpieza de +1 ano es igual para todos.
8. **Umbrales fijos en codigo**: envio alto ($150, x1.5, +$40), precio anomalo (±40%), suma engrapada ($200), ventanas de
   duplicado. Y politicas de negocio fijas: papel repetido -> rechazado + Fraude.
9. **Zona horaria** fija (centro de Mexico) y **marca** "Tickets SE" en el panel.
10. `fraude.mjs` (reglas R3/R4) y "Todas" en el panel mezclan sucursales: correcto dentro de una cuenta, no entre cuentas.
11. `consumo_inventario` no se toco (0 filas); `aplicar_revision` con sucursal NULL ahora falla por el candado (bien).

## Pendiente chico de los productos divididos

Unidad por sucursal: Aguacates en Santa Elena se compra por kg (el producto dice pz) y Limones en Wings por pieza (dice kg).
Hoy esos renglones no guardan precio, igual que antes. Ajustarlo requiere limpiar su historial de precios en la otra unidad
para no disparar alertas falsas. Tambien apareceran en "Unificar productos" pares como "Aguacates"/"AGUACATE" (Santa Elena)
y "CEBOLLA"/"Cebolla B" (Wings): los decide Alejandro ahi.
