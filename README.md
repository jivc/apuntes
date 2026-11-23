# Apuntes

Notas en Markdown con una interfaz cuidada, inspirada en Bear, que funciona en **macOS, Windows y Linux**.
Cada nota es un archivo `.md` en una carpeta normal: ponla en **Dropbox** y tus notas se sincronizan entre todas tus computadoras. Es compatible con bóvedas de **Obsidian**.

## Funciones
- Vista previa en vivo: las marcas de Markdown se ocultan fuera de la línea que editas.
- Etiquetas `#así` y anidadas `#doctorado/tesis`, también en el frontmatter (`tags:`).
- Tareas `- [ ]` con casillas clicables y vista "Tareas".
- Enlaces entre notas `[[Otra nota]]` (si no existe, se crea).
- Imágenes `![](ruta/relativa.png)` y adjuntos pegados o arrastrados.
- **Tablas que se editan como tablas:** clic en una celda para escribir; Tab, Enter y flechas para moverte; una barrita para añadir o quitar filas y columnas. El Markdown se ordena solo.
- **Bloques de código cómodos:** escribe ` ``` ` y Enter (o Ctrl/⌘ Shift E); el bloque se cierra solo, muestra el lenguaje (clic para cambiarlo) y un botón «Copiar».
- **Plantillas de correo:** Ctrl/⌘ Shift M crea un bloque con Para, Asunto y mensaje. «Enviar» abre el borrador en tu aplicación de correo; los datos entre `{{llaves}}` se piden en ese momento.
- Búsqueda en todas las notas (ignora acentos) y búsqueda rápida (Ctrl/⌘ O).
- El archivo se renombra solo según el título `# …`.
- Detecta cambios que llegan por Dropbox y actualiza la nota abierta.
- Papelera en `.trash/` dentro de la carpeta (como Obsidian).
- Barra flotante de formato al seleccionar texto, menú **Aa**, menú del botón derecho y menú Formato.
- 11 temas, 4 tipografías; el texto ocupa todo el ancho de la ventana (o un ancho fijo, en Preferencias). Modo concentración.

Para ver la comparación completa con Bear, revisa [BEAR-MAPA.md](BEAR-MAPA.md).

## Atajos
| Acción | Atajo |
| --- | --- |
| Nueva nota | Ctrl/⌘ N |
| Buscar en todas las notas | Ctrl/⌘ Shift F |
| Buscar en la nota | Ctrl/⌘ F |
| Negrita / cursiva / tachado / código | Ctrl/⌘ B / I / Shift X / E |
| Enlace | Ctrl/⌘ K |
| Marcar tarea | Ctrl/⌘ Enter |
| Título 1–3 | Ctrl/⌘ Alt 1–3 |
| Modo concentración | Ctrl/⌘ \ |
| Preferencias | Ctrl/⌘ , |

## Instalar

Descarga el instalador de tu sistema desde la sección **Releases** del repositorio en GitHub:

| Sistema | Archivo | Cómo |
| --- | --- | --- |
| **Mac** (chip M o Intel) | `Apuntes-x.y.z-mac-universal.dmg` | Ábrelo y arrastra Apuntes a Aplicaciones. La primera vez: clic derecho sobre Apuntes → **Abrir** (o Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente»). |
| **Windows** | `Apuntes-Setup-x.y.z.exe` | Ábrelo. Si aparece «Windows protegió tu PC»: **Más información → Ejecutar de todas formas**. |
| **Ubuntu / Debian / Mint** | `Apuntes-x.y.z-linux-amd64.deb` | `sudo apt install ./Apuntes-*.deb` |
| **Fedora / openSUSE** | `Apuntes-x.y.z-linux-x86_64.rpm` | `sudo dnf install ./Apuntes-*.rpm` |
| **Cualquier Linux** | `Apuntes-x.y.z-linux-x86_64.AppImage` | `chmod +x Apuntes-*.AppImage` y doble clic. |

Los avisos de seguridad de Mac y Windows salen porque la app no está firmada con un certificado de pago; es normal.

En cada computadora, al abrir Apuntes elige **Usar Dropbox** (o la misma carpeta de Dropbox) y verás las mismas notas.

## Desarrollo
Se necesita Node.js 22 o más reciente. No trabajes dentro de Dropbox: `node_modules` pesa cientos de MB.
```bash
npm ci
npm start
```

## Publicar una versión (GitHub crea los instaladores)
El flujo `.github/workflows/build.yml` compila en Mac, Windows y Linux y publica los cinco instaladores en **Releases**.

1. Cambia el número de versión en `package.json` (por ejemplo `"version": "0.3.1"`).
2. Sube los cambios y una etiqueta con esa versión:
   ```bash
   git add -A
   git commit -m "Apuntes 0.3.1"
   git tag v0.3.1
   git push origin main --tags
   ```
3. En GitHub abre la pestaña **Actions**: verás «Compilar Apuntes» trabajando (unos 10 minutos).
4. Al terminar, los instaladores aparecen en **Releases**.

Sin terminal: en GitHub ve a **Releases → Draft a new release → Choose a tag**, escribe `v0.3.1`, elige «Create new tag on publish» y pulsa **Publish release**. El flujo arranca igual y añade los instaladores a esa versión.

Para probar sin publicar: Actions → «Compilar Apuntes» → **Run workflow**; los instaladores quedan como *Artifacts* de esa ejecución.

La primera vez, revisa en GitHub **Settings → Actions → General → Workflow permissions** que esté marcado «Read and write permissions».

Para crear un instalador en tu propia computadora: `npm run dist:mac`, `npm run dist:win` o `npm run dist:linux` (quedan en `release/`).
