# respaldo-config-claude — copias de lo que vive FUERA de la carpeta del proyecto

> **Foto tomada: 2026-09-19.** Esta carpeta existe porque la memoria de Claude, la configuración global y los scripts de revisión en lote están en `C:\Users\koach\.claude\`, que **no** forma parte de la carpeta del proyecto y se perdería con la computadora. No contiene contraseñas ni llaves (se escaneó con patrones de llaves de Google, Anthropic, GitHub y Resend, y de tokens JWT: sin coincidencias).
> Instrucciones de uso: [../RECUPERACION.md](../RECUPERACION.md), sección 6, paso 5.

## Contenido y a dónde va cada cosa en una computadora nueva

| Carpeta | Qué es | Se copia a |
|---|---|---|
| `global/CLAUDE.md`, `global/METODOLOGIA.md` | Contrato base de trabajo con Alejandro (RUTA CRÍTICA) y su método | `C:\Users\koach\.claude\` |
| `global/agents/lector.md`, `verificador.md` | Subagentes (lector barato, verificador independiente) | `C:\Users\koach\.claude\agents\` |
| `global/settings.json` | Ajustes de Claude Code: plugins activos, orígenes de los marketplaces, tema. Sin secretos (se revisó) | `C:\Users\koach\.claude\settings.json`, **solo si ese archivo no existe** en la computadora nueva; si existe, combinar a mano |
| `memoria-proyecto/*.md` (12 archivos, incluye `MEMORY.md` que es el índice) | Memoria curada de este proyecto: decisiones de negocio, cuentas, diagnósticos | `C:\Users\koach\.claude\projects\C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets\memory\` |
| `workflows-revision/*.js` (6 scripts) | Scripts de workflow: los del 18-sep (revisar tickets contra foto, reparto de IVA, fechas imposibles, envíos a mano, prueba de modelos) y el del 14-jun (triage de hallazgos de seguridad). Sirven de referencia/plantilla | Cualquier carpeta de trabajo; se pasan a la herramienta de workflows |

**Ojo con el nombre de la carpeta de memoria:** sale de la ruta del proyecto cambiando `\`, `:`, espacios y `ó` por `-`. Si en la computadora nueva el proyecto queda en otra ruta, la carpeta se llamará distinto.

## Respaldo de esta carpeta en Google Drive

Toda la carpeta del proyecto (incluida esta) se copia a `G:\Mi unidad\Respaldo Claude\Documents-Claude\Projects\revisión de tickets\` (cuenta `alepolch@gmail.com`) con `Documents\Claude\respaldar_claude_a_drive.ps1` (acceso directo del Escritorio: `RESPALDO A DRIVE.cmd`). Es manual e incremental: **primero refrescar las copias de esta carpeta (comandos abajo) y después correr ese script.** Detalle y verificación: `../RECUPERACION.md` §9, riesgo 2. Para copiar solo este proyecto: `robocopy "<origen>" "<destino en Drive>" /E /R:1 /W:2 /XD node_modules .next .turbo /XF .env .env.local`.

## Qué NO está copiado (y por qué)

- **Base de datos de claude-mem (733 MB) y transcripts de sesiones (~1.3 GB):** demasiado grandes y no hacen falta para continuar; lo importante está destilado en `PROJECT_STATE.md` y en la memoria.
- **Ayudantes Python de la revisión en lote** (`generar_revision.py`, `aplicar_decisiones.py`, `extraer.py`): eran temporales y ya no existen en el disco. El método está en `memoria-proyecto/revision_lote_contra_foto.md`.
- **Skills (131) y plugins:** se reinstalan; ver `../DIRECTORIO_CUENTAS.md` §4.
- **El router `C:\Users\koach\Documents\Claude\CLAUDE.md`** y las guías de los demás proyectos: están en la carpeta `Documents\Claude`, no en esta.

## Cómo refrescar estas copias (Claude, al cerrar una sesión sustancial)

```bash
P="C:/Users/koach/Documents/Claude/Projects/revisión de tickets/respaldo-config-claude"
M="C:/Users/koach/.claude/projects/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/memory"
cp "$M"/*.md "$P/memoria-proyecto/"
cp C:/Users/koach/.claude/CLAUDE.md C:/Users/koach/.claude/METODOLOGIA.md "$P/global/"
cp C:/Users/koach/.claude/agents/*.md "$P/global/agents/"
cp C:/Users/koach/.claude/settings.json "$P/global/"
cp C:/Users/koach/.claude/projects/C--Users-koach-Documents-Claude-Projects-revisi-n-de-tickets/*/workflows/scripts/*.js "$P/workflows-revision/"
```
Para **restaurar** en una computadora nueva (sentido inverso) los comandos están en `../RECUPERACION.md`, sección 6, paso 5.
Después de copiar, volver a escanear que no haya llaves y cambiar la fecha de la primera línea.
