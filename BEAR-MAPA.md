# Mapa de funciones: Bear → Apuntes

Este mapa se armó el 16 de octubre de 2026 con **REA**, a partir de la app Bear instalada en la Mac de Julio. Se revisaron:
- los menús en español (`es.lproj/Main.strings`, `NoteTable.strings`, `Sidebar.strings`, `NoteEditor.strings`, `QuickOpen.strings`, `Backlinks.strings`);
- las notas de ayuda que trae Bear;
- las cadenas internas de la app.

**Leyenda:** ✅ ya está en Apuntes (v0.3.0) · ⏳ pendiente · ➖ no aplica o lo sustituye otra cosa

## Notas
| Función de Bear | Apuntes | Cómo |
| --- | --- | --- |
| Nota nueva | ✅ | Ctrl/⌘ N |
| Nota de la selección | ✅ | Ctrl/⌘ ⇧ N, o Archivo → Nota de la selección |
| Duplicar | ✅ | Ctrl/⌘ ⌥ D, menú Nota o clic derecho |
| Fusionar notas | ✅ | Ctrl/⌘-clic o ⇧-clic en la lista → Fusionar |
| Anclar arriba (fijar) | ✅ | Deslizar a la izquierda, clic derecho o 📌 en la barra |
| Archivar / Desarchivar | ✅ | Deslizar a la derecha, clic derecho o botón en la barra |
| Eliminar / Restaurar / Vaciar papelera | ✅ | Papelera en `.trash/` |
| Convertir en solo lectura | ✅ | Clic derecho → Convertir en solo lectura (🔒) |
| Copiar el enlace de la nota | ✅ | Copia `[[Nombre]]` |
| Copiar como (Markdown, HTML, texto enriquecido) | ✅ | Menú Nota → Copiar como |
| Exportar nota (Markdown, HTML, PDF) | ✅ | Menú Nota → Exportar |
| Imprimir | ✅ | Ctrl/⌘ P |
| Texto hablado (leer en voz alta) | ✅ | Menú Nota → Leer en voz alta |
| Abrir en nueva ventana | ⏳ | — |
| Bloquear nota con contraseña (cifrado) | ⏳ | — |
| Copiar el identificador de la nota | ➖ | Las notas son archivos; se usa el enlace `[[…]]` |

## Editor y formato
| Función de Bear | Apuntes | Cómo |
| --- | --- | --- |
| Marcas de Markdown ocultas al escribir | ✅ | Vista previa en vivo |
| Negrita, cursiva, tachado, código, enlace | ✅ | ⌘B ⌘I ⌘⇧X ⌘E ⌘K |
| Subrayado | ✅ | ⌘U (se guarda como `<u>…</u>`, compatible con Obsidian) |
| Subrayador (resaltado) | ✅ | ⌘⇧H (`==texto==`) |
| Colores del subrayador (rojo, verde, azul…) | ⏳ | — |
| Encabezados 1–6 y texto normal | ✅ | ⌘⌥1…6, ⌘⌥0 |
| Lista, lista ordenada, tarea, cita | ✅ | ⌘⇧8, ⌘⇧7, ⌘Enter, ⌘⇧. |
| Marcar como completado | ✅ | ⌘Enter o clic en la casilla |
| Llevar completadas al final | ✅ | Formato → Llevar completadas al final |
| Bloque de código + Copiar código | ✅ | ⌘⇧E; cabecera con el lenguaje (clic para cambiarlo) y botón «Copiar»; escribir ``` + Enter lo cierra solo |
| Bloque matemático / fórmula | ✅ | `$…$` y `$$…$$` con KaTeX |
| Pies de página | ✅ | Formato → Pie de página |
| Avisos (Nota, Consejo, Importante, Advertencia, Precaución) | ✅ | `> [!TIP]` y similares |
| Separador | ✅ | `---` |
| Tablas | ✅ | Siempre se ven como tabla; clic en una celda para escribir; Tab, Enter, flechas y Esc |
| Añadir, quitar y mover filas y columnas; alinear columna | ✅ | Barrita bajo la tabla al editar, o Formato → Tabla |
| Insertar fecha (varios formatos, ISO 8601) | ✅ | Formato → Insertar fecha |
| Transformaciones (MAYÚSCULAS, minúsculas, Iniciales) | ✅ | Formato → Transformaciones |
| Enlace wiki con autocompletado | ✅ | Escribe `[[` |
| Autocompletado de etiquetas | ✅ | Escribe `#` |
| Enlaces inteligentes (pegar URL sobre texto) | ✅ | Selecciona texto y pega una URL |
| Pegar o arrastrar imágenes y archivos | ✅ | Se guardan en `adjuntos/` |
| Acercar imagen | ✅ | Clic en la imagen |
| Plegar encabezados / Plegar y desplegar todo | ✅ | Flecha junto al título; menú Ver |
| Modo máquina de escribir | ✅ | Ver → Modo máquina de escribir |
| Buscar y reemplazar en la nota | ✅ | ⌘F |
| Ortografía mientras se escribe | ✅ | Clic derecho → sugerencias |
| Comillas, guiones y sustituciones inteligentes | ⏳ | — |
| Etiquetas de varias palabras `#así se escribe#` | ⏳ | No es compatible con Obsidian |

## Organización y búsqueda
| Función de Bear | Apuntes | Cómo |
| --- | --- | --- |
| Etiquetas y etiquetas anidadas | ✅ | `#a/b` |
| TagCons (íconos de etiqueta) | ✅ | Automáticos para etiquetas comunes; clic derecho → Cambiar ícono |
| Cambiar nombre de etiqueta (en todas las notas) | ✅ | Clic derecho en la etiqueta |
| Eliminar etiqueta | ✅ | Clic derecho en la etiqueta |
| Anclar etiqueta | ✅ | Clic derecho → Fijar etiqueta arriba |
| Contraer o expandir todas las etiquetas | ✅ | Clic derecho en una etiqueta |
| Notas, Sin etiquetas, Tareas, Hoy, Fijadas, Archivo, Papelera | ✅ | Barra lateral |
| Orden de notas (modificación, creación, título; más recientes arriba) | ✅ | Botón ⇅ junto al título de la lista |
| Estilo de vista previa (pequeño, mediano, grande) | ✅ | Botón ⇅; la grande muestra imagen |
| Ocultar notas de subetiquetas | ✅ | Botón ⇅ |
| Operadores de búsqueda | ✅ | `"frase"`, `-palabra`, `#etiqueta`, `@todo`, `@done`, `@today`, `@yesterday`, `@last7days`, `@untagged`, `@pinned`, `@images`, `@files`, `@code`, `@title`, `@date(AAAA-MM-DD)`; también en español (`@hoy`, `@fijadas`, `@imagenes`…) |
| Búsqueda rápida (notas, #etiquetas, @secciones) | ✅ | ⌘O |
| Enlaces entrantes + menciones sin enlace | ✅ | Panel ⓘ → Enlaces (⌘⌥B) |
| Tabla de contenido | ✅ | Panel ⓘ → Contenido (⌘⌥C) |
| Panel de información (palabras, caracteres, lectura…) | ✅ | Panel ⓘ (⌘⌥I) |
| Navegación de historial (atrás y adelante) | ✅ | ⌘⌥← / ⌘⌥→ |
| Usar etiqueta como espacio de trabajo | ⏳ | — |
| Gráfico de actividad | ⏳ | — |
| Buscar texto dentro de imágenes y PDF (OCR) | ⏳ | — |

## Ventana y apariencia
| Función de Bear | Apuntes | Cómo |
| --- | --- | --- |
| Mostrar etiquetas, notas y editor / notas y editor / solo editor | ✅ | ⌘1 / ⌘2 / ⌘3 |
| Temas | ✅ | 11 temas propios, más el automático |
| Tipografía: fuente, tamaño, interlineado, ancho de línea | ✅ | Preferencias; ⌘+ / ⌘− / ⌘0. Por defecto el texto ocupa todo el ancho de la ventana |
| Cambiar el ancho de la barra lateral y de la lista | ✅ | Arrastrar el borde (doble clic: tamaño original) |
| Flotar por encima de todo | ✅ | Menú Ver |
| Pantalla completa | ✅ | Menú Ver |
| Editor de temas personalizado | ⏳ | — |

## Sincronización e integración
| Función de Bear | Apuntes |
| --- | --- |
| Sincronización iCloud / CloudKit | ➖ Se sustituye por una carpeta de Dropbox; funciona en Mac, Windows y Linux |
| Importar desde Evernote, Day One, etc. | ⏳ (sí abre carpetas de Markdown y bóvedas de Obsidian) |
| Copias de seguridad | ➖ Dropbox guarda el historial de versiones de cada archivo |
| Atajos de Apple, x-callback-url, widgets, Spotlight | ⏳ |
| Extensión del navegador para guardar páginas | ⏳ |

## Propio de Apuntes (no está en Bear)
| Función | Cómo |
| --- | --- |
| Plantillas de correo | ⌘⇧M o Aa → Plantilla de correo. Es un bloque ` ```correo ` con Para, CC, CCO, Asunto y el mensaje; el botón «Enviar» abre el borrador en la app de correo predeterminada. Los `{{datos}}` se piden al enviar |
| Enviar una nota por correo | Menú Nota o ⋯ → Enviar por correo (el título es el asunto) |
