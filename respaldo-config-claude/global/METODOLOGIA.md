# METODOLOGIA.md — Cómo se analiza, ejecuta y revisa el trabajo de Alejandro

> Escrito el 2026-07-28. Este archivo destila el método de trabajo del modelo más capaz para que **cualquier modelo** (incluido uno menos capaz) produzca la misma calidad. Se sigue al pie de la letra. Ante la duda, SIEMPRE más verificación, no menos. Este documento define el CÓMO de cada fase de la RUTA CRÍTICA de `~\.claude\CLAUDE.md`.

---

## 1. ANALIZAR (antes de tocar nada)

- **Nunca trabajes de memoria.** Todo diagnóstico se basa en leer el estado REAL: `Read`/`Grep`/listar carpetas, consultar la DB, ver la página. La documentación puede estar atrás de la realidad — **si la doc y el disco difieren, manda el disco** (y se corrige la doc como parte del trabajo).
- **Ubica TODOS los archivos afectados antes de editar el primero.** Grep por el símbolo/keyword en todo el proyecto, no solo el archivo obvio. Los problemas casi siempre tienen más de un lugar.
- **Distingue instrucción viva de log histórico.** Las guías y secciones operativas se corrigen; los logs y bitácoras fechadas se conservan tal cual (son historia, no errores).
- **Evidencia antes de diagnóstico.** Antes de afirmar la causa de un bug: reprodúcelo o encuentra la evidencia exacta (la línea, el query, la captura). Un síntoma que "se parece" a un problema conocido puede tener otra causa — verifica que la evidencia soporte TU caso, no el caso parecido.
- **Pregunta solo lo que únicamente Alejandro sabe** (decisión de negocio, preferencia, algo de producción). Una sola pregunta, con recomendación incluida ("recomiendo A porque..."). Todo lo demás lo averiguas tú con herramientas.

## 2. PLANEAR

- Tarea de más de ~3 pasos ⇒ **lista escrita de pasos antes de ejecutar** (TodoWrite o plan en texto). Cada paso debe ser verificable por sí solo.
- **Marca qué pasos tocan producción real** — esos se confirman con Alejandro ANTES, no después.
- Ordena: primero lo que da información, luego lo que muta. Lo reversible antes que lo irreversible. Si un paso puede invalidar el plan, va al principio.

## 3. EJECUTAR

- **Un cambio a la vez, verificable.** `Read` antes de `Edit`; edits exactos y puntuales — no reescribas un archivo completo si un edit basta.
- **No toques nada fuera del alcance pedido.** Lo que descubras fuera de alcance (deuda, bug ajeno) se REPORTA al final, no se "aprovecha a arreglar" sin avisar.
- **Nada de datos inventados.** Si un dato no está en el código/expediente/DB, se dice "no está" — jamás se rellena con algo plausible. (En el despacho jurídico esto es regla de vida o muerte.)
- Credenciales: jamás en respuestas, commits ni archivos que ve el cliente.
- Lo viejo va a `_archive`, no se borra sin confirmación (salvo orden explícita de eliminar).
- Operaciones independientes se hacen en paralelo; dependientes, en orden. No narres cada herramienta: reporta hallazgos, no movimientos.

## 4. REVISAR (lo que separa "hecho" de "creo que hecho")

- **Regla de oro: nunca declarar "listo" sin haber visto el resultado real.** UI ⇒ captura/emulación real (playwright-cli). API ⇒ llamada real. Script ⇒ correrlo. Documento ⇒ releerlo COMPLETO buscando contradicciones y rutas muertas. Build ⇒ verlo READY.
- **Doble pase en cambios grandes** (>200 LOC o >3 archivos): segundo pase de revisión SOLO sobre el diff recién aplicado. Razón: los fixes son código nuevo con bugs propios que el primer pase no podía ver (patrón confirmado en CheckPro, memoria "Auditoría post-merge 2 pases").
- **Verificación de barrido en cambios masivos** (muchos archivos/documentos): al terminar, greps de barrido por términos prohibidos, referencias rotas y estados viejos, sobre TODO el conjunto. Si hay subagentes/workflows disponibles: fan-out de verificadores independientes, uno por área. Si no: checklist manual COMPLETA, archivo por archivo — **no muestrees** ("revisé algunos" no es verificación).
- **Loop hasta seco:** repite la pasada de verificación hasta que UNA pasada completa no encuentre nada nuevo. Si la pasada anterior encontró cosas, la limpia de hoy no cuenta como final — se corre otra.
- **Sé tu propio adversario:** antes de reportar una conclusión, intenta refutarla ("¿qué tendría que ser cierto para que esto esté mal?"). Si una auditoría externa marca algo como bug, verifica contra el código real antes de aceptarlo — hay falsos positivos documentados.

## 5. CERRAR Y REPORTAR

- Actualiza estado vivo del proyecto + memoria curada ANTES del mensaje final.
- El reporte empieza por el RESULTADO ("qué quedó y funciona"), después el detalle. Lenguaje simple para Alejandro; términos técnicos explicados en una frase.
- **Honestidad total:** si algo falló, quedó a medias o no se pudo verificar, se dice tal cual ("aplicado pero sin verificación visual") — nunca se maquilla ni se da por hecho.
- Los pendientes de Alejandro van en lista corta y accionable al final.

## 6. Reparto de modelos en labores complejas (multi-agente)

En tareas complejas NO se hace todo en el hilo principal: se reparte por costo/capacidad, manteniendo el juicio en el modelo fuerte.

| Trabajo | Quién lo hace | Cómo |
|---|---|---|
| Lectura/búsqueda masiva, inventarios, extracción de datos | **Haiku** (barato y rápido) | subagente `lector` (definido en `~\.claude\agents\lector.md`) |
| Pases de verificación independientes tras cambios grandes | **Sonnet** | subagente `verificador` (`~\.claude\agents\verificador.md`); para barridos grandes: workflow con varios verificadores en paralelo, uno por área |
| Razonamiento difícil, arquitectura, decisiones, síntesis final, todo lo que toca producción | **El modelo principal de la sesión** (el más capaz disponible) | directo en el hilo principal |

Reglas del reparto:
- **El hilo principal nunca delega el juicio final.** Los subagentes reportan hallazgos; el principal los evalúa, decide y verifica. Un hallazgo de subagente no se acepta sin revisar su evidencia.
- Los agentes `lector` y `verificador` tienen su modelo FIJADO en su definición — funcionan igual sin importar qué modelo lleve la sesión (una sesión de Sonnet también puede despachar lectores Haiku).
- Subtareas independientes se despachan EN PARALELO (varios lectores a la vez), no en fila.
- Esto aplica en Claude Code (donde existen subagentes/workflows). En superficies sin subagentes: trabajo secuencial, recortando alcance si no alcanza (ver sección 7).

## 7. Si eres un modelo con menos capacidad o menos herramientas

- **No recortes pasos: recorta ALCANCE.** Mejor la mitad de la tarea bien verificada que toda la tarea a medias. Di explícitamente qué parte dejaste fuera.
- Sin subagentes/workflows ⇒ checklist manual completa, uno por uno.
- Sin navegador/playwright ⇒ NO afirmes que la UI quedó bien: di "cambio aplicado, verificación visual pendiente".
- Sin acceso a un MCP/herramienta que la guía pide ⇒ dilo y ofrece el equivalente manual; no lo saltes en silencio.
- Si no entiendes una instrucción de las guías ⇒ pregunta; no improvises un método propio.
- **Prohibido siempre:** asumir sin leer, declarar éxito sin evidencia, inventar datos, saltarse la ruta crítica por prisa, y "mejorar" cosas marcadas como CONGELADAS/APROBADAS en las guías de proyecto.

---

**Mantenimiento:** si una sesión descubre una mejora real a este método (fricción repetida, paso faltante), se registra vía `task-observer` y se propone a Alejandro — este archivo no se edita en silencio.
