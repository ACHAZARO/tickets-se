# RECUPERACION.md — Revisión de Tickets (tickets-se)

> **Foto tomada: 2026-09-19 (mañana; actualizada a las ~13:30 hora CST tras revisar las cuentas y el cierre de otra sesión).** Sirve para que un Claude nuevo, en una computadora nueva y sin contexto, retome el proyecto exactamente donde se quedó.
> Complemento obligatorio: [DIRECTORIO_CUENTAS.md](DIRECTORIO_CUENTAS.md) (qué cuenta usa cada servicio, con qué correo se entra y cómo reconectarlo).
> **Mapa corto de todos los proyectos (qué carpeta de Drive va con cada uno):** `Documents\Claude\MAPA_RECUPERACION.md`.
> **Este archivo es el detalle del proyecto Revisión de Tickets.** El índice maestro de todo el espacio de trabajo (todos los proyectos, el respaldo a Drive, tareas programadas y software instalado) está en `Documents\Claude\RECUPERACION.md`, dos carpetas arriba de esta.
> El estado día a día lo sigue llevando `PROJECT_STATE.md`. **Si PROJECT_STATE.md es más nuevo que esta foto, manda PROJECT_STATE.md.** Todo lo marcado "verificado hoy" se comprobó en vivo contra GitHub, Vercel y Supabase el 2026-09-19.

---

## 0. Instrucciones para el Claude que lea esto (computadora nueva)

1. **No toques nada todavía.** Lee en este orden: el índice maestro `Documents\Claude\RECUPERACION.md` (si existe) → este archivo → `DIRECTORIO_CUENTAS.md` → `CLAUDE.md` → `PROJECT_STATE.md` (las primeras ~140 líneas son las últimas sesiones) → `respaldo-config-claude/memoria-proyecto/MEMORY.md`.
   **Ojo:** `CLAUDE.md` tiene puntos viejos (dice Gemini 2.5-flash, migraciones hasta la 029, y da a entender que Google Sheets funciona). Para esos datos manda este archivo y `PROJECT_STATE.md`: hoy es Gemini 3.8, migraciones aplicadas hasta la 057 y Sheets **no** funciona.
2. **Quién es Alejandro y cómo trabajar con él:** emprendedor con ideas claras, conocimientos limitados de programación/seguridad/diseño. Tú eres su experto técnico: explica en lenguaje simple, recomienda UNA opción con razones, responde siempre en español. El contrato completo (RUTA CRÍTICA) está en `respaldo-config-claude/global/CLAUDE.md` y `METODOLOGIA.md`.
3. **Si la computadora nueva no tiene `~\.claude\CLAUDE.md` y `METODOLOGIA.md`, restáuralos primero** desde `respaldo-config-claude/global/` (sección 6, paso 5).
4. **Nunca pidas ni escribas contraseñas o llaves en el chat, en archivos o en commits.** Alejandro las pega él mismo en el panel de cada servicio. Tú le dices exactamente dónde.
5. **Antes de afirmar que algo funciona, compruébalo** (sección 7). Si este documento y la realidad difieren, manda la realidad (BD/disco/nube) y se corrige el documento.
6. Todo cambio que toque producción real (Supabase, Vercel, datos de tickets) se confirma con Alejandro antes.

---

## 1. Qué es el proyecto

App móvil para que los gerentes de los restaurantes de Alejandro (Santa Elena y Wings Palace) suban fotos de tickets de gasto. La IA (Gemini) lee cada foto **en segundo plano**, saca un renglón por producto, los categoriza, y si no hay dudas confirma sola. Un panel de administración (`/admin`) permite revisar lo dudoso, corregir, ver el gasto por sucursal y detectar fraude.

| Pieza | Dónde vive | Dato clave |
|---|---|---|
| Web (kiosko del gerente + panel admin) | Vercel, proyecto `tickets-se` | https://tickets-se.vercel.app |
| Código | GitHub `ACHAZARO/tickets-se` (privado), rama `main` | monorepo: `/frontend` (Next.js 14) + `/backend` (Edge Functions) + `/supabase/migrations` |
| Base de datos, fotos, funciones, secretos | Supabase, proyecto `tickets-se` | ref `dlmqqmvrgkilptawllep`, región us-east-1 |
| IA de lectura | Google Gemini (AI Studio, proyecto "TICKETS SE") | modelo principal `gemini-3.8-flash` |
| Hoja de cálculo destino | Google Sheets | **nunca ha funcionado** (ver pendientes) |
| Correo de alertas | Resend | función `enviar-alerta-email` |

**Direcciones en producción**
- Kiosko del gerente (PIN): `https://tickets-se.vercel.app/sucursal/santa-elena` · `/sucursal/wings-palace` · `/sucursal/vale` (en la base de datos se llama "PRUEBA").
- Panel admin: `https://tickets-se.vercel.app/admin/login`.
- **No renombrar el proyecto de Vercel ni cambiar ese dominio** sin avisar: los enlaces y QR que entrega `/admin/sucursales` usan `tickets-se.vercel.app`.

---

## 2. Dónde nos quedamos (a 2026-09-19)

**Resultado de la sesión del 18-sep (noche):** se revisaron 884 tickets uno por uno contra su foto (Santa Elena jun–sep completo + Wings Palace mayo–julio) y se cargaron mediante un archivo de carga, sin pegar código a mano. Todos los confirmados cuadran al centavo (renglones = total con IVA). **Al 19-sep hay cero tickets pendientes y cero alertas abiertas.** El último ticket dudoso (`65809be7`, Adan Melchor 17-sep) se resolvió el 19-sep (migración 055): el $1,920 anotado a mano por la gerente juntaba la compra de Adan ($1,490.09) + cinta de El Fenix ($339.60, ticket aparte con "Bodega" a mano) + moto $90; el ticket quedó confirmado en $1,580.09.

| Sucursal | May | Jun | Jul | Ago | Sep (al 18) |
|---|---|---|---|---|---|
| Wings Palace | $62,836.30 (99) | $155,927.41 (239) | $155,808.62 (230) | $109,777.11 (192) | sin subir |
| Santa Elena | – | $73,313.48 (131) | $81,378.50 (148) | $75,836.63 (136) | $47,244.19 (90) |

**Decisiones de negocio ya tomadas por Alejandro (no re-preguntar; detalle en `respaldo-config-claude/memoria-proyecto/`):**
- Gastos **con IVA**: los renglones suman el total pagado; el impuesto va solo a los renglones que lo pagan (`gastos_con_iva.md`).
- Envío anotado a mano ("c/envío") **sí se pagó** → renglón "Moto envío" en *Otros gastos operativos*; motos del dueño/familia → *Extras* (`envios_y_motos.md`).
- **Papel repetido** (factura + ticket de la misma compra, reimpresión) → el duplicado se **rechaza y va a Fraude** junto al original.
- **No existen proveedores "de confianza"**; Adan Melchor pasa por las reglas normales. Envío muy alto (más de 1.5× la mediana de sus últimos envíos con ese proveedor **y** más de $40 sobre ella; sin historial, más de $150) → alerta `envio_alto` para revisar.
- Categoría **Bodega** (solo Santa Elena, no cuenta como gasto de operación): lo del tostador, hoy las bolsas metalizadas de café.
- Mayo–julio los decide Claude con criterio; de agosto en adelante se pregunta solo lo raro.
- Método de revisión en lote contra foto: `respaldo-config-claude/memoria-proyecto/revision_lote_contra_foto.md`.

**Código y despliegue al 19-sep (mediodía):** migraciones aplicadas hasta la **057** (`057_resumen_motivo_fraude`); funciones `procesar-ticket` v44, `reprocesar-ticket` v16, `confirmar-admin` v10; último commit `a15eb6c`. **Trabajo de otra sesión en curso (no tocar sin coordinar):** en la tarde del 19-sep otra sesión agregó, **sin commit todavía**, la función `api-cuentas` (ya desplegada en Supabase como versión 1, la 7.ª función), las migraciones `056_resumen_tickets_y_api.sql` y `057_resumen_motivo_fraude.sql` (ya aplicadas en la BD) y cambios en `frontend/app/admin/tickets/page.tsx` y `.gitignore`. Objetivo: un resumen "subidos vs oficiales" y llaves de API de solo lectura. Su estado exacto lo llevará `PROJECT_STATE.md`; ese código desplegado **aún no está en GitHub**. La IA de septiembre ya entra con Gemini 3.8, catálogo limpio, envíos y pan repartido.

---

## 3. Estado verificado en vivo hoy (2026-09-19)

| Qué | Resultado | Fuente |
|---|---|---|
| Rama `main` local vs GitHub | Iguales, ambas en `a15eb6c` (nada sin subir en commits) | `git ls-remote origin main` y `git status -sb` |
| Vercel producción | Último deploy `dpl_89JD65MWfv46W2UFJxakzfgMgvkw`, commit `a15eb6c`, estado READY | Vercel MCP |
| Edge Functions (7, todas ACTIVE) | `api-cuentas` v1 (nueva, ver sección 2) · `verificar-pin` v11 · `procesar-ticket` v44 · `confirmar-ticket` v14 · `enviar-alerta-email` v5 · `confirmar-admin` v10 · `reprocesar-ticket` v16 | Supabase MCP |
| Migraciones | Repo (commiteado): archivos numerados hasta la 055; existen además la 056 y la 057 sin commit (sección 2). La última aplicada en la BD es `057_resumen_motivo_fraude`. El historial interno de Supabase no lista los números 002–006, 021, 035 y 041 (no verifiqué por qué; pudieron aplicarse por SQL directo), y muestra la 025 y la 027 con otro nombre. **Ante duda, manda la BD viva.** | `list_migrations` |
| Sucursales | `santa-elena`, `wings-palace`, `vale` (nombre en la BD: PRUEBA), las 3 activas | SQL |
| Empleados / admins | 4 empleados (PIN con hash bcrypt) · 1 admin (`alepolch@gmail.com`) | SQL |
| Tickets | 1,347 en total: 1,268 confirmados · 79 rechazados · **0 pendientes** · 0 alertas abiertas | SQL |
| Storage | Buckets `por-revisar` y `archivo`, ambos privados | SQL |
| Tarea programada | `limpiar-imagenes-tickets`, día 1 de cada mes 03:00 (borra fotos con más de 1 año) | SQL |
| Respaldos dentro de la BD | Esquema `respaldo` con 46 tablas (copias previas a cada migración grande) | SQL |
| Tablas temporales | `_tmp_bake`, `_tmp_carga`, `_tmp_firmas` siguen existiendo (las 2 últimas vacías según PROJECT_STATE) | SQL |
| Cambios locales SIN commit | `AGENTS.md` y `CLAUDE.md` (retiro de Codex, 28-jul, más un paso nuevo de cierre que apunta a este kit); carpetas `.claude/` y `supabase/.temp/`; el trabajo de la otra sesión (`backend/supabase/functions/api-cuentas/`, migraciones 056 y 057, cambios en `frontend/app/admin/tickets/page.tsx` y `.gitignore`); y los archivos de esta recuperación (`RECUPERACION.md`, `DIRECTORIO_CUENTAS.md`, `respaldo-config-claude/`). `PROJECT_STATE.md` ya se subió a GitHub (con su puntero a este kit). **Solo existen en esta PC / el backup, no en GitHub.** | `git status` |

---

## 4. Pendientes (en orden de importancia)

**De Alejandro (solo él puede):**
1. Decir si **toda** la cinta de empaque es de Bodega. La de El Fenix del 17-sep ya se pasó a Bodega; las otras tres (El Fenix 11-ago $339.60, El Iris 21-ago y 7-sep $385.20) siguen en Desechables hasta que responda.
2. **Seguridad de las cuentas** (revisada hoy; el plan completo, paso por paso, está en `DIRECTORIO_CUENTAS.md` §8): **GitHub no tiene verificación en dos pasos y es la llave maestra** (Supabase solo se entra con GitHub; Vercel también lo tiene enlazado). Recomiendo activarla en GitHub, guardar sus códigos de respaldo y agregar `alepolch@gmail.com` como correo de respaldo. En Supabase la verificación (MFA) también está desactivada. Son cambios que hace Alejandro; Claude lo guía paso a paso.
3. Tope de gasto de Gemini: subido a MX$500 (18-sep); gastado ~MX$130 al cierre del 18-sep. Vigilar en AI Studio → Spend. (`PROJECT_STATE.md` aún menciona topes viejos de MX$100 y MX$300; vale el de MX$500.)

*Cerrados el 19-sep:* la llave vieja de Gemini (`…rcXw`) ya está borrada (lo dice Alejandro) y el registro público de Supabase ya está apagado (verificado: `disable_signup = true`).

**De Claude:**
4. **Google Sheets:** el secreto `GOOGLE_SERVICE_ACCOUNT_KEY` está mal guardado, por eso jamás se ha escrito una fila (todos los confirmados tienen `sheets_row_id` vacío). Además, la hoja en Drive solo muestra un permiso (dueño `alepolch@gmail.com`): **no aparece la cuenta de servicio `tickets-sheets@…` como editora**, lo que probablemente es otra causa. Al arreglarlo: crear clave nueva, compartir la hoja con esa cuenta como Editor y luego rellenar el historial.
5. Septiembre entra con la IA nueva: medir cuántos tickets nuevos salen sin alertas.
6. Avisar a Alejandro si aparece otro precio fuera de rango (ej. aceite Ave $745 vs $490).
7. Vigilar consumo de playo en Santa Elena (11 rollos jun, 7 jul, 16 ago, 10 al 17-sep) y precio del jugo de limón en Wings.
8. Limpieza menor: borrar `_tmp_bake`; la función `confirmar-ticket` está huérfana (nadie la llama; opcional borrarla desde el Dashboard).
9. Decidir con Alejandro si se hace commit de `AGENTS.md`/`CLAUDE.md` y de los archivos de recuperación (ver sección 9).
10. Cuando la otra sesión cierre su trabajo (`api-cuentas`, migraciones 056–057): que lo commitee y lo suba a GitHub, y agregar a `DIRECTORIO_CUENTAS.md` §3 los nombres de las llaves de API de solo lectura que cree (solo nombres, nunca valores).

> Nota: en `PROJECT_STATE.md` hay una lista "PENDIENTE" de la tarde del 18-sep que quedó parcialmente vieja (habla de tickets de Wings "sin leer" que la sesión de la noche ya cerró). Para pendientes, valen los de arriba.

---

## 5. Qué vive dónde y qué se pierde si muere esta computadora

| Cosa | Dónde vive realmente | Si muere la PC |
|---|---|---|
| Código y su historial | GitHub `ACHAZARO/tickets-se` + copia local | **Seguro** hasta `a15eb6c`. Lo no commiteado (sección 3) solo está en la copia local/backup |
| Web en producción | Vercel | Intacta |
| Base de datos, fotos, funciones y **secretos** | Supabase | Intactos. Los secretos no se pueden leer de vuelta, pero siguen ahí funcionando |
| Contraseñas y cuentas | Cada servicio + el gestor de contraseñas de Alejandro | Ver `DIRECTORIO_CUENTAS.md` (aquí NO hay contraseñas) |
| `frontend/.env.local` | Solo la PC/backup | Se recrea en 2 minutos (3 variables públicas; sección 6, paso 7) |
| Memoria de Claude sobre el proyecto | `~\.claude\projects\...\memory\` (fuera del proyecto) | **Se pierde** → copia en `respaldo-config-claude/memoria-proyecto/` (foto de hoy) |
| Config global de Claude (`CLAUDE.md`, `METODOLOGIA.md`, agentes, `settings.json`) | `~\.claude\` (fuera del proyecto) | **Se pierde** → copia en `respaldo-config-claude/global/` |
| Scripts JS de revisión en lote | `~\.claude\projects\<carpeta-del-proyecto>\<id-de-sesión>\workflows\scripts\` | **Se pierde** → copia en `respaldo-config-claude/workflows-revision/` |
| Ayudantes Python de la revisión en lote (`generar_revision.py`, `aplicar_decisiones.py`, `extraer.py`) | Eran temporales | **Ya no existen hoy.** El método está descrito en `revision_lote_contra_foto.md` y la función de BD `aplicar_revision` (migración 046) sí está; los ayudantes hay que reescribirlos si se repite el proceso |
| Base de datos de claude-mem (733 MB) y transcripts de sesiones (~1.3 GB) | `~\.claude-mem\` y `~\.claude\projects\...` | Se pierden. **No hacen falta para continuar**: lo importante está destilado en PROJECT_STATE.md y la memoria |
| Llave de la cuenta de servicio de Google | `%TEMP%\tickets-se-sa-key.json` (generada 2-jun) | Ya no existe (verificado hoy). No importa: se genera una nueva (ver directorio) |

---

## 6. Computadora nueva: pasos en orden

**Paso 1 — Instalar lo básico.** Git para Windows (incluye Git Credential Manager), Node.js 24 (en uso: v24.14.1, npm 11.11.0), la app de escritorio de Claude. Opcional: Vercel CLI (`npm i -g vercel`; en uso v52). No hace falta Supabase CLI (los despliegues van por el conector) ni GitHub CLI.

**Paso 2 — Iniciar sesión en Claude y reconectar conectores.** Cuenta según `DIRECTORIO_CUENTAS.md` §2. Conectores a reconectar (claude.ai → ajustes → conectores): Supabase, Vercel, Google Drive; y la extensión Claude in Chrome. Lista completa en `DIRECTORIO_CUENTAS.md` §4.

**Paso 3 — Poner la carpeta del proyecto.** Copiar la carpeta del backup (está en Google Drive: `G:\Mi unidad\Respaldo Claude\Documents-Claude\Projects\revisión de tickets\`, cuenta `alepolch@gmail.com`, con "Google Drive para escritorio" instalado; la letra `G:` puede cambiar) a la **misma ruta**: `C:\Users\koach\Documents\Claude\Projects\revisión de tickets` (así el nombre de la carpeta de memoria de Claude coincide). Comprobar:
```bash
git status -sb
git remote -v
```
El remote debe ser `https://ACHAZARO@github.com/ACHAZARO/tickets-se.git` (**ACHAZARO en MAYÚSCULAS**; con minúsculas GitHub responde 301). **Si el backup no tiene la carpeta:** haz primero el paso 4 (el repo es privado y pide login) y luego clona directamente en la ruta correcta:
```bash
git clone https://ACHAZARO@github.com/ACHAZARO/tickets-se.git "C:/Users/koach/Documents/Claude/Projects/revisión de tickets"
```
El clon trae el código hasta `a15eb6c`, pero **no** trae `.env.local`, ni este kit de recuperación (`RECUPERACION.md`, `DIRECTORIO_CUENTAS.md`, `respaldo-config-claude/`), ni los cambios sin commit, porque nada de eso está en GitHub. Sin el kit no hay memoria de las decisiones: se reconstruye con `PROJECT_STATE.md` y `CLAUDE.md` (sí están en GitHub) y hay que pedirle a Alejandro las decisiones y cuentas de `DIRECTORIO_CUENTAS.md` §7. Por eso conviene subir el kit a GitHub (ver riesgo 3).

**Paso 4 — Reconectar Git con GitHub** (Alejandro entra él; Claude no teclea contraseñas):
```bash
git config --global credential.https://github.com.username ACHAZARO
git config --global credential.githubAuthModes device
git config user.name "Alejandro"
git config user.email "koach700@icloud.com"
```
En el primer `git fetch`/`git push`, Git Credential Manager muestra un código: Alejandro lo escribe en https://github.com/login/device con la cuenta ACHAZARO. (El 18-sep un push dio 403 por una credencial de solo lectura; este modo lo resolvió.)

**Paso 5 — Restaurar el entorno de Claude** (detalle en `respaldo-config-claude/README.md`). Primero abre Claude Code una vez en la carpeta del proyecto y ciérralo (así crea sus carpetas internas). Luego, desde la carpeta del proyecto:
```bash
K="respaldo-config-claude"
MEM=~/.claude/projects/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/memory
mkdir -p ~/.claude/agents "$MEM"
cp "$K/global/CLAUDE.md" "$K/global/METODOLOGIA.md" ~/.claude/
cp "$K/global/agents/"*.md ~/.claude/agents/
cp "$K/memoria-proyecto/"*.md "$MEM/"
```
- El nombre de la carpeta de memoria sale de la ruta del proyecto cambiando `\`, `:`, espacios y `ó` por `-`. Si la ruta nueva es distinta, la carpeta se llamará distinto (ajusta `MEM`).
- `global/settings.json` (plugins, marketplaces, permisos): cópialo a `~/.claude/settings.json` **solo si ese archivo aún no existe** en la computadora nueva; si ya existe, combínalos a mano. No trae secretos. El marketplace `local` (Codex) no se restaura y no hace falta.
- Plugins: ver `DIRECTORIO_CUENTAS.md` §4 (qué instalar y de qué repositorio). **No reactivar `codex@local`** (retirado).

**Paso 6 — Vercel CLI (opcional).** Solo si se quiere usar la terminal: `vercel login` (usuario `achazaro`) y, dentro de `frontend/`, `vercel link` → team `achazaros-projects`, proyecto `tickets-se`. Para desplegar no se necesita: **cada push a `main` despliega solo.**

**Paso 7 — Frontend local.**
```bash
cd frontend
npm install
```
Crear `frontend/.env.local` copiando `.env.local.example` con estos tres valores:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://dlmqqmvrgkilptawllep.supabase.co`
- `NEXT_PUBLIC_SUPABASE_EDGE_FUNCTIONS_URL` = `https://dlmqqmvrgkilptawllep.functions.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la llave pública (anon/publishable) del proyecto. Claude la obtiene con la herramienta `get_publishable_keys` del conector de Supabase. No es secreta, pero no se pega en documentos.

Luego `npm run build` debe terminar sin error.

**Paso 8 — Supabase: no hay nada que redesplegar.** Solo confirmar con el conector que las 7 funciones y sus versiones coinciden con la sección 3.

**Paso 9 — Secretos:** no hay que tocar ninguno mientras el proyecto de Supabase siga vivo. Si alguno falla, `DIRECTORIO_CUENTAS.md` §3 dice de dónde sale y cómo se pone.

---

## 7. Cómo comprobar que todo quedó conectado

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | `git fetch` y `git log -1 --oneline` | Sin error de credenciales; `a15eb6c` o más nuevo |
| 2 | Conector Vercel: listar deploys de `tickets-se` (producción) | El último en READY |
| 3 | Conector Supabase: listar funciones | 7 funciones ACTIVE con las versiones de la sección 3 (o mayores) |
| 4 | Conector Supabase: `select count(*) from registros_tickets` | 1,347 o más |
| 5 | Alejandro abre `https://tickets-se.vercel.app/admin/login` y entra con `alepolch@gmail.com` | Ve `/admin/tickets` |
| 6 | Kiosko `/sucursal/vale` con un PIN **incorrecto** (lo teclea Alejandro) | **No** entra |
| 7 | Prueba de humo por API: `verificar-pin` con PIN malo, y `procesar-ticket` sin token | `valid:false` y HTTP 401 |
| 8 | `cd frontend && npm run build` | Termina sin error |

Cuando las 8 pasen, se actualiza `PROJECT_STATE.md` con "recuperado en computadora nueva el <fecha>" y se sigue con los pendientes de la sección 4.

---

## 8. Si se perdió algo más que la computadora

- **Vercel perdido:** reimportar el repo desde GitHub. Framework Next.js, **Root Directory = `frontend`** (sin esto el build falla), Node 24.x, las 3 variables `NEXT_PUBLIC_*` solo en Production, y el proyecto debe llamarse `tickets-se` para conservar `tickets-se.vercel.app`.
- **GitHub perdido o sin acceso:** la carpeta local tiene el historial completo. Crear el repo privado `ACHAZARO/tickets-se`, `git push -u origin main`, y reconectar Vercel a ese repo (rama de producción `main`).
- **Supabase perdido:** es el escenario grave. El esquema se reconstruye con `supabase/migrations/001…057` en orden (con las salvedades de la sección 3) y hay que reponer los secretos y volver a desplegar las 7 funciones desde `backend/supabase/functions/`. **Los datos y las fotos solo existen en Supabase**; ver riesgo 1 abajo.
- **Alejandro sin acceso al panel admin:** restablecer la contraseña desde Supabase Dashboard → Authentication → Users → `alepolch@gmail.com`. Los admin nuevos se crean desde el Dashboard (nunca por SQL directo) y además se agrega su `user_id` a `public.admin_users`.
- **PIN de empleados:** están guardados con hash y **no se pueden recuperar**; se reasignan desde `/admin/sucursales`.

---

## 9. Riesgos abiertos (dicho con honestidad)

1. **No hay una copia de la base de datos ni de las fotos fuera de Supabase.** El plan figura como Pro en `CLAUDE.md` (no verificado hoy) y Supabase guarda respaldos diarios del plan, pero no confirmé que estén activos ni probé restaurarlos, y las fotos de Storage no suelen ir dentro del respaldo de la base. Recomendación: una revisión de esos respaldos en el Dashboard y, más adelante, una exportación periódica.
2. **El respaldo a Google Drive solo se actualiza cuando alguien lo corre.** Desde el 19-sep (~13:30) existe una copia de todo `Documents\Claude` en `G:\Mi unidad\Respaldo Claude\Documents-Claude\` (cuenta `alepolch@gmail.com`, carpeta privada: el dueño es el único con permiso). La hace el script `Documents\Claude\respaldar_claude_a_drive.ps1` (acceso directo del Escritorio: `RESPALDO A DRIVE.cmd`): es incremental, nunca borra nada en Drive y excluye llaves (`.env`, `.env.local`). Verificado el 19-sep para esta carpeta: 0 archivos faltantes o distintos respecto a la copia local, el kit idéntico byte a byte y Drive ya lo subió a la nube con los mismos tamaños. Última corrida verificada: **19-sep 14:40**, 0 fallas, 0 archivos pendientes en las cuatro carpetas. La carpeta `_secretos` (llave de la API de cuentas) quedó **excluida** del respaldo desde esa corrida; una copia anterior de esa llave subió a Drive a las 13:55 (ver `DIRECTORIO_CUENTAS.md` §3a). Lo que se cambie después de la última corrida **no** está en Drive: hay que correrlo al cerrar sesiones sustanciales (o pedirle a Claude que lo programe). Antes de esto, lo único respaldado era GitHub (hasta `a15eb6c`). Detalle menor: la copia en Drive conserva carpetas viejas de Codex dentro de `.git\refs\codex\…` con rutas demasiado largas (Windows avisa "Filename too long" al recorrerlas); son basura heredada que ya no existe en el repositorio local, no afectan al código y, si el Explorador se queja al restaurar, se pueden omitir. El repositorio local pasó `git fsck` sin errores.
3. **Cambios sin commit** (sección 3): si la PC muere hoy, `CLAUDE.md`/`AGENTS.md` actualizados y **todo este kit** solo sobreviven si el backup los incluye. Recomendación: hacer commit y push del kit (no contiene contraseñas ni llaves; el repo es privado) para que GitHub también lo guarde. Queda pendiente de que Alejandro lo autorice.
4. **Cuentas:** ya están confirmados los correos de GitHub, Vercel, Supabase y Google. Quedan por confirmar el Apple ID, dónde está la app autenticadora de Vercel y qué carpeta es el backup (lista en `DIRECTORIO_CUENTAS.md` §7). Las tres excepciones de acceso (GitHub sin 2FA, Supabase que depende solo de GitHub, Vercel con 2FA) están en §8.
5. **Google Sheets no funciona** hoy, así que no puede servir como respaldo de los datos.
6. **Verificación en dos pasos:** si alguna cuenta la tiene, hay que tener a la mano el dispositivo o los códigos de respaldo antes de cambiar de computadora.

---

## 10. Mantener este documento vivo

Al cerrar cada sesión sustancial: actualizar la sección 2 (dónde nos quedamos), 3 (versiones/estado) y 4 (pendientes), y refrescar las copias de `respaldo-config-claude/` (comandos en su README). La fecha de la primera línea se cambia cada vez.
