# Plan — Versión beta para negocios de amigos (24-oct-2026, retomado 03-nov)

> Pedido de Alejandro (24-oct, /loop): revisar lo pendiente de Wings y Santa Elena (dejarle solo lo mínimo), corregir la IA,
> hacer todas las mejoras y mandarlas a producción sin preguntar, probar todo como QA desde que se crea una cuenta, revisar
> diseño (instrucciones claras, pocos cambios de pantalla, Cerebro intuitivo), pruebas masivas, y al final "los tickets
> faltantes". Rama de trabajo: `beta-amigos` (= main + modo entrenamiento). Estado vivo: `PROJECT_STATE.md`.

**Operación sin navegador:** la CLI de Supabase tiene sesión. `npx supabase@latest functions deploy <fn> --project-ref dlmqqmvrgkilptawllep --use-api --workdir backend --yes` (`--no-verify-jwt` en procesar-ticket, api-cuentas, revisor-ia, verificar-pin, conteo-gerente, avisos-gerente). Las llaves se piden a la CLI dentro de los scripts (`_trabajo_beta/scripts/lib_ops.py`) y nunca se imprimen. Los resultados de trabajo van en `_trabajo_beta/` (gitignored): Windows borró la carpeta temporal el 1-nov.

## Fases y estado

| # | Fase | Estado |
|---|---|---|
| 1 | Ronda de pendientes WP/SE (revisor IA + auditoría contra foto) | 116 hechos 03-nov: 100 confirmados, 16 con pregunta para el dueño. Faltan 56 nuevos y la cola de Fraude |
| 2 | Rama `beta-amigos`: main + modo entrenamiento (verificado = producción) | hecho |
| 3 | **Aislamiento por negocio**: RLS y funciones (101 aplicada) + edge functions con permiso por sucursal | 101 hecha; confirmar-admin publicada; faltan las demás |
| 4 | Mejoras de IA por errores de la auditoría (abajo) | en curso |
| 5 | Alta por invitación + asistente de inicio sin saltar de pantalla + selector de negocio + panel de negocios | pendiente |
| 6 | Revisión de diseño (design critique), Cerebro entendible sin manual, recomendación del revisor IA con aprobar en lote | pendiente |
| 7 | QA de punta a punta (cuenta nueva → gerente sube → revisión → reportes) y pruebas de carga | pendiente |
| 8 | Publicar frontend a `main`, quitar política anon de sucursales, verificar en producción | pendiente |
| 9 | **Tickets faltantes**: cotejo salidas de caja vs tickets (al final, con Alejandro viendo) | pendiente |

## Errores de la IA encontrados (auditoría de 116 tickets, 150 errores) y qué se hace

| Error | Veces | Arreglo |
|---|---|---|
| Factura con envío a mano: IVA sin repartir (Adán Melchor) | ~12 | `montos.ts`: el envío no entra a la base gravable |
| Factura con importes ya descontados + renglón Descuento (Cervezas) | 3 | `montos.ts`: quitar descuento doble |
| Remisión con IEPS por litro no cuadra (PIAYS) | 1-2 | `montos.ts`: reparto proporcional si todos los renglones son de la misma categoría |
| Artículo existente sin ligar ("LITROS: 46 L", códigos de Costco/Sam's, MOTO X) | ~25 | `catalog.ts` (plantilla de cantidad, código numérico, envío) + sugerencia de Gemini (`producto_catalogo`) |
| Cantidad de presentación ("HARINA 4/1KG" = 4 kg, barril 20 L, 12/160) | ~15 | Prompt |
| Notas a mano: pieza vs kg, 7 cruzado leído como 2, 6 vs 5 | ~20 | Prompt (siguen yendo a revisión) |
| Hoja-resumen de la gerente tomada como compra (doble conteo) | 3 | Prompt + alerta de comprobantes faltantes |
| Fecha: año mal leído o mes-día (dato correcto pero alerta falsa) | ~10 | `resolverFecha` sin alerta cuando la corrección es segura |
| Pagado con tarjeta pero declarado efectivo de caja | 4+ | Lectura de forma de pago + alerta `pago_distinto` (señal real para el dueño) |

## Decisiones (Claude, 24-oct / 03-nov)

### Revisor IA
Ronda del 24-oct: de 99 que aprobó, 11 debían verlos el dueño y aprobó un monto mal ($270 en vez de $210). **No cumple para aprobar solo.** Se usa como recomendación visible con "aprobar en lote"; se sigue midiendo.

### Aislamiento
- `admin_users` = super admin (Alejandro). El panel trabaja sobre UNA cuenta a la vez (`usuario_cuenta_activa`), así "Todas las sucursales" nunca mezcla negocios.
- `cuenta_usuarios(cuenta_id, user_id, rol)`: dueños. RLS por `mis_sucursales()` / `mi_cuenta()`. Fotos: solo las de tickets propios.
- Google Sheets solo con `GOOGLE_SHEETS_CUENTA`; correos de alerta a los dueños de la cuenta.

### Alta de cuentas
- Beta cerrada: Alejandro genera una **invitación** (enlace de un solo uso) y la manda por WhatsApp.
- El amigo abre el enlace, pone negocio, nombre, correo y contraseña → entra directo al asistente. Sin correo de confirmación (cuenta creada por edge function).
- Tope de tickets por mes en beta (`cuentas.limite_tickets_mes`).

### Asistente de inicio
Una sola pantalla con pasos que se hacen AHÍ MISMO: sucursal → PIN → categorías → formas de pago → cómo suben los gerentes (QR) → subir tickets de entrenamiento → revisar lo aprendido → terminar.

### Tickets faltantes
"Tickets faltantes" = dinero que salió sin comprobante: salidas de la caja sin ticket, y hojas-resumen de la gerente cuya "compra total" no alcanza con los tickets subidos (ej. 8-oct SE faltan $151.98; 10-oct SE faltan $517.50). Se construye al final.
