# Apuntes — guía para continuar el proyecto (para Claude)

> **Para Claude:** este archivo resume el proyecto *Apuntes* para que puedas retomarlo en otra computadora.
> El autor es Julio. Habla con él en **español** y en lenguaje sencillo, sin tecnicismos.
> El código fuente está en `Instaladores Apuntes/Código fuente/` (junto a este archivo, dentro de Dropbox).

## Qué es
Apuntes es una app de notas para escritorio (Electron), con una interfaz inspirada en Bear.
- Cada nota es un archivo `.md` en una carpeta de Dropbox, la "bóveda", normalmente `Dropbox/Notas`. Es compatible con Obsidian.
- Funciona en Mac, Windows y Linux. Julio usa **Mac** y **Fedora**, y también tiene una PC con **Windows**.
- Versión actual: **0.3.0**, del 22 de noviembre de 2026. Replica casi todo Bear; lo que falta está en `BEAR-MAPA.md` (marcado ⏳).
- La 0.3.0 trajo: texto a todo el ancho de la ventana, tablas editables celda por celda, bloques de código con cabecera, plantillas de correo, interfaz renovada (Nunito Sans, barra de acciones en píldora, columnas redimensionables) y el flujo de GitHub que publica instaladores.

## Lo primero que conviene hacer
**No compiles dentro de Dropbox**, porque `node_modules` pesa cientos de MB y Dropbox lo sincronizaría todo.
1. Copia `Instaladores Apuntes/Código fuente/` a una carpeta local:
   - Windows: `C:\Proyectos\apuntes`
   - Fedora y Mac: `~/proyectos/apuntes`
2. Trabaja ahí. Necesitas Node.js 22 o más reciente.
3. Al terminar, vuelve a copiar el código a `Código fuente/`, **sin** `node_modules/`, `dist/` ni `release/`.
4. Copia los instaladores nuevos a la carpeta de su sistema (`Mac/`, `Windows/`, `Fedora/`) y actualiza `LEEME.txt`.

```bash
npm ci          # instala dependencias (usa package-lock.json)
npm start       # compila (esbuild) y abre la app en modo desarrollo
```

## Instaladores: los crea GitHub
`.github/workflows/build.yml` compila en macOS, Windows y Ubuntu y, al subir una etiqueta `v*`, publica en **Releases**: `.dmg` universal, `.exe` (NSIS), `.AppImage`, `.deb` y `.rpm`. Los pasos para Julio están en `README.md` → «Publicar una versión».
- En la Mac de Julio (chip M, sin Rosetta) solo se puede crear el `.dmg` (`npm run dist:mac`); NSIS, AppImage y rpm necesitan Intel, por eso se dejan a GitHub.
- En esta Mac no hay Node instalado en el sistema: hay uno en `~/glosa-tools/node-v22*/bin` (añádelo al `PATH`). Tampoco hay `gh`; `git` sí.
- El repositorio es **público**: no pongas datos personales en el código. El correo de `package.json` es un marcador (`apuntes@correo.invalid`) a propósito; el paquete `.deb` exige que haya uno.
- La app no tiene firma de código: Mac (firma ad-hoc, `identity: "-"`) y Windows (SmartScreen) muestran un aviso la primera vez. Explícaselo a Julio.
- El repositorio de GitHub lo maneja Julio; no hay copia `git` dentro de Dropbox (no conviene). Para publicar se trabaja en la copia local.

## Arquitectura (archivos clave)
| Archivo | Qué hace |
| --- | --- |
| `main.js` | Proceso principal: ventana, configuración (`userData/config.json`), detección de Dropbox (`info.json` de Dropbox en las 3 plataformas), lectura y escritura de notas, vigilancia con **chokidar** (cambios que llegan por Dropbox), papelera `.trash/`, archivo `Archivo/`, fijadas en `.apuntes.json`, menús (barra de menú, «Formato», clic derecho con corrector ortográfico) |
| `preload.js` | Puente seguro `window.apuntes` (contextIsolation + sandbox) |
| `index.html` | Estructura: barra lateral, lista, editor, bienvenida, preferencias |
| `src/app.js` | Interfaz: modelo de notas (títulos, etiquetas, tareas), filtros, búsqueda sin acentos, guardado automático (500 ms), renombrado del archivo según el `# Título`, gestos de deslizar, menú contextual de notas, barra flotante y menú «Aa» |
| `src/livepreview.js` | CodeMirror 6: oculta las marcas de Markdown fuera de la línea activa; casillas, viñetas, imágenes, enlaces, `[[wikilinks]]`, `#etiquetas`, `==resaltado==`, `<u>`, `$fórmulas$`, pies de página, avisos `> [!TIPO]`, cabecera de los bloques de código (lenguaje, «Copiar»), bloques ` ```correo ` (`parseMail`, botón «Enviar»), cierre automático de ``` y flechas para plegar encabezados |
| `src/tables.js` | Tablas GFM siempre mostradas como tabla (widget de bloque). Cada celda se edita con `contenteditable` y, al salir de ella, se reescribe el Markdown de toda la tabla (`parseTable` → `applyOp` → `serializeTable`). Barrita de herramientas, «Ver Markdown» (`rawField`), flechas/Tab/Enter/Esc. También los bloques `$$…$$` |
| `src/format.js` | Comandos de formato: negrita, subrayado (`<u>`), títulos 1–6, listas, tareas, citas, avisos, fórmulas, pies de página, fechas, transformaciones y operaciones de tabla (`COMMANDS`) |
| `src/complete.js` | Autocompletado de `[[notas]]` y `#etiquetas` (@codemirror/autocomplete) |
| `src/search.js` | Operadores de búsqueda estilo Bear (`@todo`, `@hoy`, `"frase"`, `-palabra`, `#tag`, `@date()`) |
| `src/panels.js` | Diálogos propios (Electron no tiene `prompt`), selector de íconos de etiqueta, búsqueda rápida (⌘O), visor de imágenes y diálogo de correo (`mailDialog`) |
| `src/export.js` | Markdown → HTML (markdown-it + footnote + KaTeX) para exportar HTML/PDF, imprimir y «Copiar como» |
| `src/katex.css` | KaTeX empaquetado aparte (`dist/katex.css`), que usan las exportaciones |
| `src/styles.css` | 11 temas por variables CSS; fuentes Inter y JetBrains Mono incluidas en la app |
| `build.mjs` | esbuild → `dist/app.js`, `dist/styles.css` y `dist/katex.css` |
| `scripts/instalar-linux.sh` | Instalador por usuario para Linux |
| `build/icon.svg` / `build/icon.png` | Ícono (1024 px); `assets/icon.png` se usa en la ventana y en la bienvenida |

### Decisiones de diseño
- **Notas fijadas:** viven en `<bóveda>/.apuntes.json` (`{"pinned": ["ruta/relativa.md"]}`) y se sincronizan por Dropbox; el watcher también escucha ese archivo.
- **Archivo:** mueve la nota a `<bóveda>/Archivo/`. Es una carpeta normal, así que Obsidian la sigue viendo.
- **Papelera:** `<bóveda>/.trash/`, como Obsidian. «Eliminar definitivamente» usa `shell.trashItem`, que la manda a la papelera del sistema.
- **Gestos en la lista:** con dos dedos hacia la derecha aparecen Eliminar y Archivar; hacia la izquierda, Fijar (un deslizamiento largo fija la nota directamente). Con el trackpad, Eliminar nunca se ejecuta sin un clic, para evitar accidentes por la inercia; en pantalla táctil un deslizamiento largo sí elimina.
- **Clic derecho** sobre una nota abre un menú nativo (`menu:popup` por IPC). Esto es importante en Windows y Linux.
- **`.apuntes.json`** guarda `pinned`, `pinnedTags`, `tagIcons` y `readonly` (rutas relativas o etiquetas en minúsculas).
- **Adjuntos:** se guardan en `<bóveda>/adjuntos/` y se enlazan con una ruta relativa a la nota.
- **Atajos:** los maneja el renderer (keymap de CodeMirror y `keydown` de la ventana). El menú de la app solo los muestra (`registerAccelerator: false`), porque en Windows/Linux la barra de menú está oculta. Con ⌥ usa `e.code`, no `e.key`.
- **Nota nueva vacía:** si se abandona sin escribir, se borra sola (como en Bear).
- **Ancho del texto:** por defecto ocupa toda la ventana (`fullWidth: true`, `data-width="full"`); en Preferencias se puede volver al ancho fijo (`lineWidth`).
- **Tablas:** mientras se edita una celda el foco está en la celda, no en CodeMirror (`view.hasFocus` es falso). Antes de cambiar de nota, guardar o cerrar se llama `flushTableEdit()`. Una tabla dentro de una cita o lista se deja como texto.
- **Correo:** una plantilla es un bloque de código con lenguaje `correo` (también `email` o `mail`). «Enviar» abre `mailto:` con `shell.openExternal`; nunca envía nada por su cuenta. Si el mensaje no cabe en la URL (Windows ≈ 2000 caracteres) se copia al portapapeles.
- **Ventana:** se recuerda tamaño, posición y si estaba maximizada (`bounds`, `maximized` en `config.json`); una sola instancia. El ancho de la barra lateral y de la lista, y la vista (⌘1/2/3), se guardan en `localStorage`.

## Mapa de Bear
`BEAR-MAPA.md` compara función por función Bear contra Apuntes. Lo pendiente (⏳) es lo siguiente a hacer: ventana nueva por nota, cifrado, colores del subrayador, espacios de trabajo, OCR e importar de Evernote.

## Cómo probar sin tocar las notas reales de Julio
Usa otra carpeta como bóveda y otro `userData`: un script de Electron que haga `app.setPath('userData', carpetaTemporal)` antes de `require('./main.js')`, escriba `config.json` con `{"vault": "<carpeta de prueba>"}` y luego use `webContents.executeJavaScript`, `sendInputEvent` y `capturePage`.
- `npm run build:test` compila con `window.__apuntes = { view, state, … }` para poder inspeccionar el editor. La compilación normal (`npm run build`) no lo incluye.
- Pon `APUNTES_TEST=1` en el entorno para saltarte el bloqueo de una sola instancia (si no, la prueba se cierra cuando Julio tiene Apuntes abierto).
- Ojo: los menús nativos (`Menu.popup`) son modales y bloquean ese tipo de prueba en macOS.

## Ideas que podrían seguir
- Todo lo marcado ⏳ en `BEAR-MAPA.md`.
- Firma de código (Apple Developer / certificado de Windows) para quitar los avisos de seguridad.
- Actualizaciones automáticas (electron-updater + GitHub Releases).
