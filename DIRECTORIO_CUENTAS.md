# DIRECTORIO_CUENTAS.md — Cuentas, integraciones y llaves de Revisión de Tickets

> **Foto tomada: 2026-09-19.** Complemento de [RECUPERACION.md](RECUPERACION.md).
> **Este archivo NO contiene contraseñas ni llaves, y no debe contenerlas nunca.** Dice qué cuenta usa cada servicio, con qué correo/usuario se entra, dónde vive cada secreto y cómo se regenera. Los valores los guarda Alejandro en su gestor de contraseñas y los pega él mismo en cada panel.
> Cómo leer el estado: **Verificado hoy** = comprobado en vivo el 2026-09-19 (con la fuente). **Documentado** = viene de la memoria/guías del proyecto, no comprobado hoy. **POR CONFIRMAR** = no está escrito en ningún lado; lo tiene que decir Alejandro (lista en la sección 7). No se rellena nada con suposiciones.

---

## 1. Mapa rápido de cómo se conecta todo

```
Gerente (celular) ──> Vercel (tickets-se.vercel.app) ──> Supabase (BD + fotos + 7 funciones)
                                                            │   ├──> Gemini (AI Studio)   lee las fotos
Alejandro (admin) ──> Vercel /admin ────────────────────────┘   ├──> Google Sheets        (no funciona aún)
                                                                └──> Resend               alertas por correo
GitHub (ACHAZARO/tickets-se) ──push a main──> Vercel (despliegue automático)
Claude (conectores Supabase / Vercel / Drive / Chrome) opera todo lo anterior a nombre de Alejandro
```

---

## 2. Cuentas y usuarios

| Servicio | Para qué se usa | Cuenta / usuario | Cómo se entra | Estado |
|---|---|---|---|---|
| **Claude (Anthropic)** | Claude Code / app de escritorio, conectores, plugins | `koach700@icloud.com` | Correo de la cuenta en claude.ai / app de escritorio | Documentado (es el correo que reporta la sesión actual; no se probó el login) |
| **GitHub** | Repositorio del código. Además es la **puerta de entrada a Supabase** y está enlazado en Vercel | Usuario **`ACHAZARO`** (nombre "Alejandro Chazaro", cuenta creada el 25-jun-2025). Único correo: **`koach700@me.com`** (principal, verificado; sin correo de respaldo). Repo privado `ACHAZARO/tickets-se`, rama `main` | Correo `koach700@me.com` + contraseña (sin passkey). **Sin verificación en dos pasos.** En la PC, Git usa Git Credential Manager con **código de dispositivo** (github.com/login/device). Git local firma como `Alejandro <koach700@icloud.com>` | **Verificado hoy** en el Chrome de Alejandro (Settings → Emails y Security) |
| **Vercel** | Publica la web | Usuario **`achazaro`** (minúsculas); correo **`koach700@me.com`**. Team "achazaro's projects" (slug `achazaros-projects`, id `team_vuQfWgevRwXGKr6Jq5IAHt41`), plan **Hobby**, 1 solo miembro (Owner). Proyecto `tickets-se` id `prj_JtlVuF0E5DV5W3xM1MvkF6RyU87C`, dominio único `tickets-se.vercel.app` (sin dominio propio) | Métodos enlazados: correo `koach700@me.com`, **GitHub `ACHAZARO`** (último uso 9-abr) y 1 **passkey**; Google **no** está conectado. **Verificación en dos pasos activa**: passkey (último uso 15-jun) + app autenticadora (TOTP) | **Verificado hoy** en Chrome y con `vercel whoami` |
| **Supabase** | Base de datos, fotos, funciones, login del admin | Organización **"ACHAZARO's Org"** (id `juhdyfhzkhygcwjqudkr`), plan **Pro**, **1 solo miembro: `koach700@me.com` (Owner)**; usuario ACHAZARO. Proyecto `tickets-se`, ref **`dlmqqmvrgkilptawllep`**, us-east-1. La misma organización aloja otros 3 proyectos: `checkpro`, `santa-elena-pos`, `wings-palace-stories` | **Solo con GitHub** (`ACHAZARO · koach700@me.com`): es el único método enlazado. **MFA desactivada.** Registro público de usuarios **apagado** (`disable_signup = true`) | **Verificado hoy** en Chrome y por la API pública de Supabase |
| **Admin de la app** (Supabase Auth) | Entrar a `/admin` | **`alepolch@gmail.com`** (único usuario en `auth.users` y en `admin_users`) | Correo + contraseña en `https://tickets-se.vercel.app/admin/login`. La contraseña solo la sabe Alejandro; se restablece desde Supabase → Authentication → Users | Verificado hoy (SQL) |
| **Google Cloud** | Dos proyectos: **`tickets-se`** (id numérico `606044108682`; cuenta de servicio de Sheets; APIs Sheets y Drive) y **"TICKETS SE"** (`gen-lang-client-0656779549`; el de Gemini) | Cuenta **`alepolch@gmail.com`**: **único principal y Owner en los dos proyectos**. Cuenta de servicio: `tickets-sheets@tickets-se.iam.gserviceaccount.com` | Login normal de Google | **Verificado hoy** en Chrome (consola → IAM) |
| **Google AI Studio (Gemini)** | La IA que lee los tickets | Proyecto **"TICKETS SE"** (`gen-lang-client-0656779549`), Tier 1 prepago, recarga automática **apagada**, tope mensual **MX$500** (subido 18-sep; ~MX$130 gastados al cierre del 18-sep). Dueño: **`alepolch@gmail.com`**. La llave vieja (`…rcXw`) ya está **borrada** (lo confirma Alejandro, 19-sep) | Login de Google `alepolch@gmail.com` en aistudio.google.com → Spend | Dueño verificado hoy; tope y nivel documentados (PROJECT_STATE 18-sep) |
| **Google Sheets** | Destino de las filas de cada ticket (hoy no recibe nada) | Hoja **"Tickets SE - Gastos Operacionales"**, id `1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao`. **Dueño: `alepolch@gmail.com`.** En sus permisos **solo aparece el dueño**: la cuenta de servicio `tickets-sheets@…` **no figura como editora**, aunque la documentación decía que se había compartido (probable segunda causa de que Sheets no funcione). Hay un acceso directo en el Drive de escritorio (`G:\Mi unidad`) | Login de Google | Dueño y permisos **verificados hoy** vía Drive |
| **Resend** | Correos de alertas críticas (función `enviar-alerta-email`) | **`koach700@me.com`**; llave llamada "tickets SE" (acceso completo, creada 3-jun); remitente `onboarding@resend.dev`; plan gratis (100/día); **misma cuenta que usa CheckPro** | Login en resend.com | Documentado (memoria `resend_account`) |
| **Kiosko de gerentes** | Subir tickets | Un **PIN por empleado** (4 empleados, guardados con hash bcrypt: no se pueden leer ni recuperar) | Se crean/cambian en `/admin/sucursales`. Sucursales: `santa-elena`, `wings-palace`, `vale` (PRUEBA) | Verificado hoy (SQL) |

---

## 3. Secretos y variables (solo nombres; ningún valor)

### 3a. Secretos de las Edge Functions en Supabase
Se ponen en **Supabase Dashboard → Edge Functions → Secrets** (Claude no puede ponerlos ni leerlos por el conector; Supabase no deja leer un secreto ya guardado). Nombres verificados hoy leyendo el código de las funciones; qué está puesto realmente en la nube **no se puede comprobar desde fuera**.

| Nombre | Qué es | De dónde sale / cómo se regenera | Estado |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Acceso interno de las funciones a su propio proyecto | Los pone Supabase solos. **No se tocan** | Automáticos |
| `JWT_SECRET` | Firma de las sesiones de 1 h del kiosko (PIN → token) | Una cadena aleatoria larga inventada por Alejandro/Claude. Si se cambia, se cierran las sesiones abiertas (solo dura 1 h; inofensivo) | Documentado |
| `GEMINI_API_KEY` | Llave de la IA | AI Studio → proyecto "TICKETS SE" → API keys. La actual termina en `…4GUA` (rotada 18-sep); la vieja (`…rcXw`) **ya está borrada** (lo confirma Alejandro, 19-sep) | Documentado |
| `GEMINI_MODEL` | Opcional: fuerza un modelo sin redesplegar | Si no existe, el código usa la cadena `gemini-3.8-flash` → `gemini-3.1-pro-preview` → `gemini-3.1-flash-lite` | No verificable |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON completo de la cuenta de servicio de Sheets | Google Cloud → IAM → Cuentas de servicio → `tickets-sheets` → Claves → Agregar clave → JSON; se pega el contenido **completo y tal cual**. **Hoy está mal guardado**, por eso Sheets nunca ha funcionado. Además hay que compartir la hoja con `tickets-sheets@…` como Editor (hoy no aparece compartida; ver Google Sheets en la sección 2) | Documentado (roto) |
| `GOOGLE_SHEETS_ID` | Id de la hoja (`1jAV80R_…ES98zao`) | Ver tabla de cuentas. No es secreto | Documentado |
| `RESEND_API_KEY` | Llave de correo | resend.com → API Keys → "tickets SE" (o crear otra) | Documentado |

**API de solo lectura para el programa de cuentas (19-sep, terminada):** función `api-cuentas` (v1, `verify_jwt=false`, auth propia). La llave `tk_…` **no es un secreto de Supabase**: se guarda en la tabla `api_keys` solo como hash SHA-256 (no se puede recuperar) y la copia real vive en `_secretos/llave-api-programa-cuentas.txt` en la PC de Alejandro (carpeta fuera de git). Alejandro la pega en su programa de revisión de cuentas y la respalda en su gestor de contraseñas. Regenerar/revocar: ver `API_CUENTAS.md` § Administrar llaves. **Respaldo a Drive:** desde el 19-sep 14:40 la carpeta `_secretos` está excluida de `respaldar_claude_a_drive.ps1`. Antes de eso, el respaldo de las 13:55 subió una copia de la llave a `G:\Mi unidad\Respaldo Claude\Documents-Claude\Projects\revisión de tickets\_secretos\` (Drive privado de `alepolch@gmail.com`); decisión de Alejandro (19-sep, tarde): las llaves que ya están en Drive se quedan por ahora y se sacan en una sesión de seguridad posterior (Drive privado, nadie más tiene acceso).

### 3b. Variables de entorno en Vercel (proyecto `tickets-se`)
Verificado hoy con `vercel env ls`: existen exactamente estas 3, solo en **Production**, creadas hace ~109 días, con valor cifrado. (El conector de Vercel de Claude no puede listarlas: da 403; la terminal sí.)

| Nombre | Valor / dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dlmqqmvrgkilptawllep.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL` | `https://dlmqqmvrgkilptawllep.functions.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Llave pública "anon/publishable" del proyecto de Supabase (Claude la lee con `get_publishable_keys`). Pública por diseño, pero no se pega en documentos |

### 3c. Archivos con datos sensibles en la PC
| Archivo | Contiene | Nota |
|---|---|---|
| `frontend/.env.local` | Las mismas 3 variables públicas de 3b | Está en `.gitignore`; se recrea con `.env.local.example` |
| `%TEMP%\tickets-se-sa-key.json` | Llave privada de la cuenta de servicio (generada 2-jun) | Ya no existe (verificado hoy). **No se necesita**: se genera una nueva |
| `C:\Users\koach\AppData\Roaming\com.vercel.cli\Data\auth.json` | Sesión de la terminal de Vercel | Se regenera con `vercel login` |
| Credential Manager de Windows (GitHub) | Sesión de Git con GitHub | Se regenera con el código de dispositivo |

---

## 4. Herramientas de Claude que hay que reconectar

**Conectores** (se activan en claude.ai → ajustes → conectores, con la cuenta de Claude de la sección 2). En esta sesión funcionan:

| Conector | Para qué se usa aquí | Nota |
|---|---|---|
| **Supabase** (acceso a "ACHAZARO's Org") | Migraciones, SQL, desplegar Edge Functions, logs | Es la única vía de despliegue: no hay token de la CLI de Supabase |
| **Vercel** (acceso al team `achazaros-projects`) | Ver deploys y builds | No lista variables de entorno (403); para eso, la terminal |
| **Google Drive** | Consultar archivos de Drive | Cuenta de Google usada: **POR CONFIRMAR** |
| **Claude in Chrome** (extensión) | Operar el panel admin ya con sesión iniciada por Alejandro; subir archivos de carga en lote | Claude nunca teclea contraseñas: Alejandro entra una vez |
| Navegador integrado de la app de escritorio | Revisar páginas | Sin configuración |

**Plugins de Claude Code activos** (`~\.claude\settings.json`): `superpowers`, `superpowers-chrome`, `double-shot-latte` y `private-journal-mcp` (marketplace `superpowers-marketplace`, repo `github.com/obra/superpowers-marketplace`); `claude-mem` (marketplace `thedotmack`, repo `thedotmack/claude-mem`); `ruflo-core`, `ruflo-swarm`, `ruflo-autopilot`, `ruflo-federation` (marketplace `ruflo`, repo `ruvnet/ruflo`); `vercel`, `playground`, `skill-creator` (marketplace oficial `claude-plugins-official`). **`codex@local` está desactivado a propósito: no reactivar.** Al reinstalar, primero se añaden esos marketplaces. Si la app no los ofrece sola al restaurar `settings.json`, se hace desde una terminal con `claude` interactivo: `/plugin marketplace add obra/superpowers-marketplace`, `/plugin marketplace add thedotmack/claude-mem`, `/plugin marketplace add ruvnet/ruflo`, y después `/plugin install <plugin>@<marketplace>` (los oficiales `vercel`, `playground` y `skill-creator` vienen del marketplace `claude-plugins-official`). Esos comandos no se probaron hoy; si alguno falla, `/plugin` muestra el menú interactivo.

**Skills:** hay 131 en `~\.claude\skills\`; no se copiaron al kit. Las que se usan seguido y de dónde se reinstalan (según la guía global): `caveman`, `caveman-commit` y `caveman-review` (instaladas a mano desde `github.com/JuliusBrussee/caveman`, solo el `SKILL.md`), `claud` (a mano desde `github.com/Hainrixz/claude-skill`), `stop-slop` y `task-observer` (`npx skills add -g`), `playwright-cli` (`npm i -g @playwright/cli@latest`). `code-reviewer`: origen no documentado. Ninguna es imprescindible para operar la app; el método de trabajo vive en `respaldo-config-claude/global/`.

---

## 5. Herramientas locales (versiones en uso el 2026-09-19)

| Herramienta | Versión / estado |
|---|---|
| Windows 11 Home | 10.0.26200 |
| Git para Windows + Git Credential Manager | Instalado (`credential.helper = manager`) |
| Node.js / npm | v24.14.1 / 11.11.0 (Vercel usa Node 24.x) |
| Vercel CLI | 52.0.0, con sesión iniciada como `achazaro` |
| Supabase CLI | **No instalada** (se usa el conector; `npx supabase` disponible pero sin token) |
| GitHub CLI (`gh`) | **No instalada**; no hace falta |
| Frontend | Next.js 14 (App Router), `next.config.mjs` (no `.ts`), Tailwind |

---

## 6. Cuentas compartidas con otros proyectos (cuidado al cambiar algo)

- **Supabase "ACHAZARO's Org"** (verificado hoy) aloja también `checkpro`, `santa-elena-pos` y `wings-palace-stories`. CheckPro tiene clientes reales según las guías: no tocar nada de ahí desde este proyecto.
- **Vercel team `achazaros-projects`** (verificado hoy) aloja además `checkpro`, `ml-ads-oauth-callback`, `santaelena-backoffice`, `santaelena-staff` y `santaelena-cliente`.
- **Resend** (`koach700@me.com`) es la misma cuenta que usa CheckPro (documentado): rotar o borrar su llave puede romper alertas de ahí.
- **Cuenta de Google `alepolch@gmail.com`**: es una cuenta personal; puede tener otros proyectos de Google además de `tickets-se` (no verificado).

---

## 7. Confirmado por Alejandro (2026-09-19) y lo que sigue por confirmar

**Confirmado por Alejandro:**
- **Dos correos son las cuentas maestras:** `koach700@me.com` (GitHub, Vercel, Supabase a través de GitHub, Resend) y `alepolch@gmail.com` (Google Cloud, Gemini, Sheets y usuario admin de la app). Claude usa `koach700@icloud.com`.
- **Contraseñas:** se guardan normalmente en Google (su gestor de contraseñas) o en la memoria de Alejandro (o de su hermano). Aquí no se escribe ninguna. Alejandro cuenta con recuperarlo todo por correo (ver la sección 8: es cierto solo con condiciones).
- **La llave vieja de Gemini ya está borrada.**
- **Registro público de Supabase:** ya estaba apagado (verificado). Alejandro no sabía si lo había hecho él o su hermano; ni Supabase ni Vercel tienen a su hermano como miembro (cada una tiene 1 solo miembro: `koach700@me.com`).
- **Apple ID:** Alejandro cree que `koach700@me.com` y `koach700@icloud.com` son el mismo Apple ID (no está 100 % seguro; en Apple esas direcciones suelen ser alias de una misma cuenta).
- **App autenticadora de Vercel:** está en el celular de Alejandro. Quiere un respaldo en otro correo o dispositivo por si el celular falla (plan en la sección 8).
- **Dónde está el respaldo:** en el Google Drive de escritorio (`G:\Mi unidad\Respaldo Claude\`, cuenta `alepolch@gmail.com`), hecho con el script del índice maestro `Documents\Claude\respaldar_claude_a_drive.ps1` (ver `RECUPERACION.md` §9, riesgo 2).

**Respuestas del 19-sep (tarde):** el respaldo es el Google Drive de `alepolch@gmail.com` (carpetas `Respaldo Claude` y `Respaldo Escritorio`; mapa en `Documents\Claude\MAPA_RECUPERACION.md`) · la app autenticadora de Vercel está en el **celular de Alejandro** · Alejandro **cree** que los dos correos son el mismo Apple ID · **los códigos de respaldo de las cuentas ya están guardados fuera de la PC** · el plan de passkeys será con **dos celulares** (el suyo y el de su hermano) y está **bloqueado hasta que su hermano regrese a la ciudad**. La lista de pendientes de TODOS los proyectos vive ahora en `Documents\Claude\RECUPERACION.md` (bloque "PENDIENTES — lista única consolidada").

**Por confirmar:**

| # | Pregunta | Para qué sirve |
|---|---|---|
| 1 | Confirmar con certeza el Apple ID (iPhone → Ajustes → tu nombre → "Nombre, teléfonos, correo": ahí aparecen el Apple ID y sus alias) | Saber a qué cuenta de Apple pertenecen los dos correos y su recuperación |
| 2 | ¿El passkey de Vercel está guardado en esta PC (Windows Hello), en el gestor de Google o en iCloud? | Si está atado a esta PC, se pierde con ella |
| 3 | ¿Qué cuentas de esta lista puede recuperar o conoce también su hermano? | Contarlo como respaldo humano |
| 4 | ¿Cuál es el teléfono y el correo de recuperación de `alepolch@gmail.com`? | Recuperar la cuenta maestra de Google |
| 5 | ¿Quién sería el "contacto de recuperación" de confianza (por ejemplo, el hermano)? | Plan de la sección 8 |

---

## 8. Cómo recuperar el acceso a cada cuenta (y dónde está el riesgo)

Alejandro cuenta con que "con los mails se recupera todo". **Casi cierto, con tres excepciones que sí importan.**

| Cuenta | Cómo se recupera | Lo que hay que tener a la mano |
|---|---|---|
| Correo `koach700@me.com` (Apple) | Es la base de GitHub, Vercel, Supabase (vía GitHub) y Resend. Se recupera con el Apple ID | Método de recuperación de Apple (por confirmar, pregunta 1) |
| GitHub `ACHAZARO` | "Olvidé mi contraseña" con `koach700@me.com`. No hay 2FA, ni passkey, ni correo de respaldo | El acceso al buzón `koach700@me.com`. **Excepción 1:** sin 2FA, quien tenga esa contraseña o buzón entra. **Excepción 2:** si se pierde el buzón, no hay segundo camino |
| Supabase | Solo se entra con GitHub `ACHAZARO`; no hay otro método enlazado ni otro miembro | Todo depende de GitHub. **Excepción 3:** si GitHub se pierde, Supabase también, salvo pasar por soporte de Supabase |
| Vercel `achazaro` | Enlace por correo `koach700@me.com` o GitHub. Pero tiene **verificación en dos pasos activa** | Passkey o app autenticadora (TOTP). Si se pierden los dos, hay que pasar por soporte de Vercel |
| Google `alepolch@gmail.com` | Recuperación estándar de Google | Teléfono o correo de recuperación de esa cuenta (no está documentado cuál) |
| Resend | Correo `koach700@me.com` | El buzón |
| Claude | Correo `koach700@icloud.com` | El buzón |
| Admin de la app | Restablecer contraseña desde Supabase → Authentication → Users → `alepolch@gmail.com` | Entrar a Supabase (depende de GitHub) |

### Plan para respaldar los accesos por más lados (en orden de importancia)

Lo hace Alejandro en cada panel; Claude lo guía paso a paso. Claude no cambia ajustes de seguridad de las cuentas. Cada paso dice qué cubre. Los puntos marcados *(por comprobar)* dependen de opciones que cada servicio puede cambiar y se confirman al hacerlos.

| # | Cuenta | Qué hacer | Qué riesgo cubre |
|---|---|---|---|
| 1 | **GitHub** | Activar la verificación en dos pasos (app autenticadora **y** un passkey). Guardar los códigos de respaldo fuera de la PC y del celular. Agregar `alepolch@gmail.com` como segundo correo verificado y como correo de respaldo, y permitir restablecer contraseña con cualquier correo verificado | Es la llave de todo (Supabase entra por aquí). Hoy si se pierde el buzón `koach700@me.com` no hay segundo camino |
| 2 | **Apple ID** (`koach700@me.com` / `koach700@icloud.com`) | Apple no ofrece "segundo correo" para recuperar una cuenta: se recupera con teléfonos de confianza, un **contacto de recuperación** (persona de confianza con su propio Apple ID, por ejemplo el hermano) y una **llave de recuperación** (guardarla impresa). Agregar un segundo teléfono de confianza. Además, activar el **reenvío del correo de iCloud** a `alepolch@gmail.com` *(por comprobar en iCloud.com → Correo → Preferencias)*, para que los avisos y enlaces de GitHub, Vercel y Resend también lleguen a Gmail | Perder el acceso al buzón que abre casi todo |
| 3 | **Vercel** | (a) Conectar **Google** (`alepolch@gmail.com`) como método de entrada (hoy aparece "Connect"). (b) Registrar un **segundo passkey** en otro dispositivo o en el gestor de Google: el actual puede estar atado a esta PC. (c) Guardar los **códigos de respaldo** de la verificación en dos pasos *(por comprobar en "More options")* y volver a inscribir la app autenticadora escaneando el QR con **dos** dispositivos a la vez | El celular o esta PC fallan. La cuenta es plan Hobby: no se puede invitar a un segundo miembro sin pasar a Pro, por eso el respaldo son más métodos de entrada en la misma cuenta |
| 4 | **Google `alepolch@gmail.com`** | Revisar en myaccount.google.com/security: teléfono y correo de recuperación vigentes; generar **códigos de respaldo** de la verificación en dos pasos; comprobar que ningún passkey dependa solo de esta PC. Agregar un **segundo Owner** (otra cuenta de Google de confianza) a los dos proyectos de Google Cloud, hoy con un solo dueño | Es la cuenta de Gemini, Sheets y del admin de la app |
| 5 | **Supabase** | Invitar a `alepolch@gmail.com` (u otra cuenta de confianza) como **segundo Owner** de la organización (el plan Pro lo permite; la invitación es por correo *(por comprobar cómo entra esa cuenta)*). Después, activar MFA con códigos de respaldo guardados | Hoy solo se entra con GitHub y hay un solo miembro |
| 6 | **Hoja de emergencia** | Una hoja impresa (sin contraseñas) con: la lista de cuentas de este archivo, dónde están los códigos de respaldo, el contacto de recuperación y a quién avisar. Una copia en casa y otra con el hermano | Que alguien pueda ayudar si Alejandro no puede |
| 7 | **Datos y código** | Ya hay dos copias del código (GitHub y Google Drive). Falta: comprobar en Supabase → Database → Backups que los respaldos diarios del plan Pro estén activos; y que Claude programe una exportación periódica de la base de datos y de las fotos a Drive | La base de datos y las fotos solo existen en Supabase |
| 8 | **Resend y Claude** | Bajo riesgo: ambos usan el correo de Apple. Si Resend lo permite, agregar `alepolch@gmail.com` como segundo acceso | Perder el buzón de Apple |

**Simulacro cada seis meses:** elegir una cuenta y comprobar que se puede recuperar solo con la hoja de emergencia y los correos.

---

## 9. Mantener este archivo

Cuando cambie una cuenta, un correo, una llave rotada (solo el **nombre** y los últimos 4 caracteres, nunca el valor) o una integración, se actualiza aquí en la misma sesión y se cambia la fecha de arriba.
