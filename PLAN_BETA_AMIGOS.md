# Plan — Versión beta para negocios de amigos (24-oct-2026)

> Pedido de Alejandro (24-oct, /loop): revisar lo pendiente de Wings y Santa Elena (dejarle solo lo mínimo), corregir la IA,
> hacer todas las mejoras y mandarlas a producción sin preguntar, probar todo como QA desde que se crea una cuenta, revisar
> diseño (instrucciones claras, pocos cambios de pantalla, Cerebro intuitivo), pruebas masivas, y al final "los tickets
> faltantes". Rama de trabajo: `beta-amigos` (= main + modo entrenamiento). Estado vivo: `PROJECT_STATE.md`.

## Fases y estado

| # | Fase | Estado |
|---|---|---|
| 1 | Ronda de revisión de pendientes WP/SE (revisor IA + auditoría contra foto) y aplicar | en curso |
| 2 | Rama `beta-amigos`: main + modo entrenamiento (verificado = producción) | hecho 24-oct |
| 3 | **Aislamiento por negocio** (cuenta activa, RLS por cuenta, funciones y edge functions con permiso por sucursal) | pendiente |
| 4 | Alta de cuentas por invitación + asistente de inicio sin saltar de pantalla | pendiente |
| 5 | Revisión de diseño (design critique) y simplificación; Cerebro entendible sin manual | pendiente |
| 6 | Mejoras de IA que salgan de la ronda (prompt, reglas, alertas) | pendiente |
| 7 | QA de punta a punta (cuenta nueva → gerente sube → revisión → reportes) y pruebas de carga | pendiente |
| 8 | Publicar (migraciones, edge functions, frontend a `main`) y verificar en producción | pendiente |
| 9 | Tickets faltantes (al final, con Alejandro viendo) | pendiente |

## Decisiones de diseño (Claude, 24-oct)

### Aislamiento (lo más importante antes de que entre otro negocio)
- `admin_users` = **super admin** (Alejandro, la plataforma). Ve todo, pero el panel siempre trabaja sobre UNA cuenta a la vez
  (la "cuenta activa"): así "Todas las sucursales" nunca mezcla negocios.
- `cuenta_usuarios(cuenta_id, user_id, rol)`: quién entra al panel de cada negocio (dueño).
- `usuario_cuenta_activa(user_id, cuenta_id)`: la cuenta que está viendo cada usuario (el super admin la cambia con un selector).
- RLS: cada tabla filtra por las sucursales de la cuenta activa (`mis_sucursales()`); las de cuenta (`formas_pago`,
  `cuenta_opciones`, `reglas_ia`) por `mi_cuenta()`. Fotos (storage): solo las de tickets de mis sucursales.
- Funciones SECURITY DEFINER: además de la puerta general, revisan que el objeto (producto, renglón, sucursal) sea de la cuenta.
- Edge functions de admin: el usuario debe poder ver la sucursal del ticket (super admin o miembro de esa cuenta).
- Categorías y objetivos globales pasan a ser de la cuenta principal; cada cuenta nueva recibe las suyas (plantilla por giro).
- La página pública del gerente ya no puede listar todas las sucursales: busca solo la suya por slug (RPC).

### Alta de cuentas
- Beta cerrada: Alejandro genera una **invitación** (enlace con código de un solo uso) y la manda por WhatsApp.
- El amigo abre el enlace, pone nombre del negocio, su nombre, correo y contraseña → entra directo al asistente.
- Sin correo de confirmación (la cuenta la crea una edge function con el código; evita que los correos no lleguen).
- Tope de tickets por mes en beta (protege el gasto de Gemini).

### Asistente de inicio
- Una sola pantalla con pasos que se hacen AHÍ MISMO (no manda a otras pantallas): sucursal → PIN → categorías → formas de
  pago → cómo suben los gerentes (QR) → subir tickets de entrenamiento → revisar lo aprendido → terminar.
