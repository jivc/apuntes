// Apuntes — proceso principal: ventana, acceso a la carpeta de notas y vigilancia de cambios (Dropbox).
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard, screen } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const chokidar = require('chokidar');

const isMac = process.platform === 'darwin';
const NOTE_EXT = /\.(md|markdown)$/i;
const TRASH_DIR = '.trash';
const ARCHIVE_DIR = 'Archivo';
const META_FILE = '.apuntes.json'; // notas fijadas; se sincroniza por Dropbox

let win = null;
let watcher = null;
const selfWrites = new Map(); // ruta -> momento en que la escribimos nosotros

// ---------- configuración ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const config = { vault: null, theme: 'system', font: 'sans', fontSize: 17, lineWidth: 720, lineHeight: 1.7, listSort: 'mtime', listDesc: true, listPreview: 'medium', hideSubtags: false, typewriter: false, floatOnTop: false, fullWidth: true, bounds: null, maximized: false };
const CONFIG_KEYS = ['theme', 'font', 'fontSize', 'lineWidth', 'lineHeight', 'listSort', 'listDesc', 'listPreview', 'hideSubtags', 'typewriter', 'floatOnTop', 'fullWidth'];

function loadConfig() {
  try { Object.assign(config, JSON.parse(fs.readFileSync(configFile(), 'utf8'))); } catch {}
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

// ---------- Dropbox ----------
function detectDropbox() {
  const home = os.homedir();
  const infoFiles = [path.join(home, '.dropbox', 'info.json')];
  if (process.env.APPDATA) infoFiles.push(path.join(process.env.APPDATA, 'Dropbox', 'info.json'));
  if (process.env.LOCALAPPDATA) infoFiles.push(path.join(process.env.LOCALAPPDATA, 'Dropbox', 'info.json'));
  const candidates = [];
  for (const f of infoFiles) {
    try {
      const info = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const k of ['personal', 'business']) if (info[k] && info[k].path) candidates.push(info[k].path);
    } catch {}
  }
  candidates.push(path.join(home, 'Library', 'CloudStorage', 'Dropbox'), path.join(home, 'Dropbox'));
  return candidates.find((c) => { try { return fs.statSync(c).isDirectory(); } catch { return false; } }) || null;
}

// ---------- utilidades de archivos ----------
const toRel = (p) => path.relative(config.vault, p).split(path.sep).join('/');

function inVault(p) {
  if (!config.vault || typeof p !== 'string') return false;
  const rel = path.relative(config.vault, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function assertNote(p) {
  if (!inVault(p) || !NOTE_EXT.test(p)) throw new Error('Ruta fuera de la carpeta de notas');
}
function markSelf(...paths) { const t = Date.now(); for (const p of paths) selfWrites.set(p, t); }
function isSelf(p) { const t = selfWrites.get(p); return t && Date.now() - t < 2500; }

function sanitizeTitle(title) {
  let s = String(title || '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  s = s.slice(0, 100).replace(/[. ]+$/, '');
  return s || 'Sin título';
}
function uniquePath(dir, base, ext = '.md', except = null) {
  let candidate = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(candidate) && candidate !== except; i++) candidate = path.join(dir, `${base} ${i}${ext}`);
  return candidate;
}

async function readNote(p) {
  const [content, st] = await Promise.all([fsp.readFile(p, 'utf8'), fsp.stat(p)]);
  return { path: p, rel: toRel(p), content, mtime: st.mtimeMs, birthtime: st.birthtimeMs || st.ctimeMs };
}

async function walk(dir, out = []) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && NOTE_EXT.test(e.name)) out.push(full);
  }
  return out;
}

async function loadAll(dir) {
  const files = await walk(dir);
  const notes = await Promise.all(files.map((f) => readNote(f).catch(() => null)));
  return notes.filter(Boolean);
}

async function listTrash() {
  const dir = path.join(config.vault, TRASH_DIR);
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch { return []; }
  const notes = await Promise.all(entries.filter((n) => NOTE_EXT.test(n))
    .map((n) => readNote(path.join(dir, n)).catch(() => null)));
  return notes.filter(Boolean);
}

const WELCOME = `# Bienvenido a Apuntes

Apuntes guarda cada nota como un archivo **Markdown** en tu carpeta de Dropbox, así que tus notas están en todas tus computadoras y también puedes abrirlas con Obsidian o cualquier editor.

## Lo básico
- Escribe un título con \`# \` al inicio: el archivo se renombra solo.
- Usa *cursiva*, **negrita**, ~~tachado~~ y \`código\`.
- Organiza con etiquetas como #apuntes/inicio o #ideas — se pueden anidar con \`/\`.
- Enlaza otras notas con [[Atajos de teclado]].

## Tareas
- [x] Instalar Apuntes
- [ ] Escribir mi primera nota
- [ ] Probar el modo concentración con Ctrl/⌘ + \\

> Las marcas de Markdown se ocultan mientras no estés editando esa línea, como en Bear.
`;

const SHORTCUTS = `# Atajos de teclado

Selecciona texto para ver la barra de formato, o usa el botón **Aa** arriba a la izquierda del editor.

| Acción | Atajo |
| --- | --- |
| Nueva nota | Ctrl/⌘ + N |
| Buscar en todas las notas | Ctrl/⌘ + Shift + F |
| Negrita / cursiva / tachado | Ctrl/⌘ + B / I / Shift + X |
| ==Resaltar== | Ctrl/⌘ + Shift + H |
| Enlace | Ctrl/⌘ + K |
| Título 1 / 2 / 3 | Ctrl/⌘ + Alt + 1 / 2 / 3 |
| Lista / numerada | Ctrl/⌘ + Shift + 8 / 7 |
| Marcar tarea | Ctrl/⌘ + Enter |
| Insertar tabla | Ctrl/⌘ + Alt + T |
| Bloque de código | Ctrl/⌘ + Shift + E |
| Plantilla de correo | Ctrl/⌘ + Shift + M |
| Modo concentración | Ctrl/⌘ + \\ |
| Preferencias | Ctrl/⌘ + , |

En una tabla: haz clic en una celda para escribir; **Tab** pasa a la siguiente celda, **Enter** baja (y agrega una fila al final) y **Esc** sale de la tabla.

#apuntes/inicio
`;

async function useVault(dir) {
  await fsp.mkdir(dir, { recursive: true });
  config.vault = dir;
  saveConfig();
  if ((await walk(dir)).length === 0) {
    await fsp.writeFile(path.join(dir, 'Bienvenido a Apuntes.md'), WELCOME);
    await fsp.writeFile(path.join(dir, 'Atajos de teclado.md'), SHORTCUTS);
  }
  startWatcher();
  return dir;
}

// ---------- vigilancia (cambios que llegan por Dropbox) ----------
function startWatcher() {
  if (watcher) watcher.close();
  if (!config.vault) return;
  const root = config.vault;
  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => { const rel = path.relative(root, p); return rel !== META_FILE && rel.split(path.sep).some((s) => s.startsWith('.') || s === 'node_modules'); },
    awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
  });
  const onChange = async (p) => {
    if (path.basename(p) === META_FILE && path.dirname(p) === root) {
      if (!isSelf(p) && win) win.webContents.send('meta:changed', await readMeta());
      return;
    }
    if (!NOTE_EXT.test(p) || isSelf(p) || !win) return;
    try { win.webContents.send('note:changed', await readNote(p)); } catch {}
  };
  watcher.on('add', onChange).on('change', onChange).on('unlink', (p) => {
    if (NOTE_EXT.test(p) && !isSelf(p) && win) win.webContents.send('note:removed', p);
  });
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => ({ ...config, platform: process.platform, katexUrl: pathToFileURL(path.join(__dirname, 'dist', 'katex.css')).href }));
ipcMain.handle('config:set', (_e, patch) => {
  for (const k of CONFIG_KEYS) if (k in patch) config[k] = patch[k];
  if ('floatOnTop' in patch && win) win.setAlwaysOnTop(!!patch.floatOnTop);
  syncMenuChecks();
  saveConfig();
  return config;
});
ipcMain.handle('vault:detect-dropbox', () => {
  const dbx = detectDropbox();
  return dbx ? path.join(dbx, 'Notas') : null;
});
ipcMain.handle('vault:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta de tus notas',
    defaultPath: detectDropbox() || os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : useVault(r.filePaths[0]);
});
ipcMain.handle('vault:use', (_e, dir) => useVault(dir));

ipcMain.handle('notes:load', async () => {
  if (!config.vault) return { vault: null, notes: [] };
  return { vault: config.vault, notes: await loadAll(config.vault) };
});
ipcMain.handle('notes:trash-list', () => (config.vault ? listTrash() : []));

ipcMain.handle('notes:write', async (_e, p, content) => {
  assertNote(p);
  markSelf(p);
  await fsp.writeFile(p, content);
  markSelf(p);
  return (await fsp.stat(p)).mtimeMs;
});
ipcMain.on('notes:write-sync', (e, p, content) => {
  try { assertNote(p); markSelf(p); fs.writeFileSync(p, content); e.returnValue = true; } catch { e.returnValue = false; }
});

ipcMain.handle('notes:create', async (_e, content) => {
  const p = uniquePath(config.vault, 'Sin título');
  markSelf(p);
  await fsp.writeFile(p, content);
  return readNote(p);
});

ipcMain.handle('notes:rename', async (_e, p, title) => {
  assertNote(p);
  const base = sanitizeTitle(title);
  const target = uniquePath(path.dirname(p), base, path.extname(p) || '.md', p);
  if (target === p) return p;
  markSelf(p, target);
  await fsp.rename(p, target);
  return target;
});

ipcMain.handle('notes:trash', async (_e, p) => {
  assertNote(p);
  const dir = path.join(config.vault, TRASH_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const target = uniquePath(dir, path.basename(p, path.extname(p)), path.extname(p));
  markSelf(p, target);
  await fsp.rename(p, target);
  return target;
});

// .apuntes.json: fijadas, etiquetas fijadas, íconos de etiquetas y notas de solo lectura.
const strList = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string') : []);
function cleanMeta(m) {
  const icons = {};
  if (m && m.tagIcons && typeof m.tagIcons === 'object') for (const [k, v] of Object.entries(m.tagIcons)) if (typeof v === 'string') icons[k] = v.slice(0, 16);
  return { pinned: strList(m && m.pinned), pinnedTags: strList(m && m.pinnedTags), readonly: strList(m && m.readonly), tagIcons: icons };
}
async function readMeta() {
  try { return cleanMeta(JSON.parse(await fsp.readFile(path.join(config.vault, META_FILE), 'utf8'))); }
  catch { return cleanMeta({}); }
}
ipcMain.handle('meta:get', () => (config.vault ? readMeta() : cleanMeta({})));
ipcMain.handle('meta:set', async (_e, meta) => {
  const p = path.join(config.vault, META_FILE);
  markSelf(p);
  await fsp.writeFile(p, JSON.stringify(cleanMeta(meta), null, 2));
  markSelf(p);
});

// Adjuntos (imágenes o archivos pegados/arrastrados) → <bóveda>/adjuntos/
ipcMain.handle('attach:save', async (_e, name, bytes) => {
  const dir = path.join(config.vault, 'adjuntos');
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(name).slice(0, 10) || '.bin';
  const base = sanitizeTitle(path.basename(name, path.extname(name))).slice(0, 80);
  const target = uniquePath(dir, base, ext);
  await fsp.writeFile(target, Buffer.from(bytes));
  return target;
});

// Exportar / imprimir
ipcMain.handle('export:save', async (_e, { defaultName, content, ext }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, content);
  return r.filePath;
});
async function withHtmlWindow(html, fn) {
  const tmp = path.join(os.tmpdir(), `apuntes-${Date.now()}.html`);
  await fsp.writeFile(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try { await w.loadFile(tmp); return await fn(w); }
  finally { w.destroy(); fsp.unlink(tmp).catch(() => {}); }
}
ipcMain.handle('export:pdf', async (_e, { defaultName, html }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const pdf = await withHtmlWindow(html, (w) => w.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' } }));
  await fsp.writeFile(r.filePath, pdf);
  return r.filePath;
});
ipcMain.handle('export:print', (_e, html) => withHtmlWindow(html, (w) => new Promise((resolve) => w.webContents.print({ printBackground: true }, (ok) => resolve(ok)))));
ipcMain.handle('clipboard:write', (_e, data) => { clipboard.write({ text: data.text || '', html: data.html || undefined }); });

ipcMain.handle('notes:archive', async (_e, p) => {
  assertNote(p);
  const dir = path.join(config.vault, ARCHIVE_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const target = uniquePath(dir, path.basename(p, path.extname(p)), path.extname(p));
  markSelf(p, target);
  await fsp.rename(p, target);
  return readNote(target);
});

// Menú nativo para una nota (clic derecho); devuelve el id elegido o null.
ipcMain.handle('menu:popup', (_e, items) => new Promise((resolve) => {
  let done = false;
  const pick = (id) => { if (!done) { done = true; resolve(id); } };
  const build = (list) => list.map((it) => (it.type === 'separator' ? { type: 'separator' }
    : it.submenu ? { label: it.label, submenu: build(it.submenu) }
    : { label: it.label, enabled: it.enabled !== false, type: it.checked !== undefined ? 'checkbox' : 'normal', checked: !!it.checked, click: () => pick(it.id) }));
  const tpl = build(items);
  Menu.buildFromTemplate(tpl).popup({ window: win, callback: () => setTimeout(() => pick(null), 100) });
}));

ipcMain.handle('notes:restore', async (_e, p) => {
  assertNote(p);
  const target = uniquePath(config.vault, path.basename(p, path.extname(p)), path.extname(p));
  markSelf(p, target);
  await fsp.rename(p, target);
  return readNote(target);
});

ipcMain.handle('notes:delete-forever', async (_e, p) => {
  assertNote(p);
  if (toRel(p).split('/')[0] !== TRASH_DIR) throw new Error('Solo se eliminan notas de la papelera');
  await shell.trashItem(p); // va a la papelera del sistema, por si acaso
  return true;
});

// Borra una nota recién creada que se dejó sin escribir (solo si su contenido no cambió).
ipcMain.handle('notes:remove-empty', async (_e, p, untouched) => {
  assertNote(p);
  const c = await fsp.readFile(p, 'utf8').catch(() => null);
  if (c === null || c !== untouched) return false;
  markSelf(p);
  await fsp.unlink(p);
  return true;
});

ipcMain.handle('shell:reveal', (_e, p) => { if (inVault(p)) shell.showItemInFolder(p); });
ipcMain.handle('shell:open-folder', () => config.vault && shell.openPath(config.vault));
ipcMain.handle('shell:open', async (_e, url) => {
  if (typeof url !== 'string' || !/^(https?|mailto):/i.test(url)) return false;
  try { await shell.openExternal(url); return true; } catch { return false; }
});
ipcMain.on('titlebar', (_e, colors) => {
  if (!isMac && win && win.setTitleBarOverlay) {
    try { win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: 48 }); } catch {}
  }
});

// ---------- menús ----------
const send = (action) => () => win && win.webContents.send('menu', action);
// Los atajos ya los maneja el editor; aquí solo se muestran (registerAccelerator: false).
const item = (label, action, accelerator) => ({ label, click: send(action), accelerator, registerAccelerator: false });

function formatItems() {
  return [
    item('Negrita', 'format:bold', 'CmdOrCtrl+B'),
    item('Cursiva', 'format:italic', 'CmdOrCtrl+I'),
    item('Subrayado', 'format:underline', 'CmdOrCtrl+U'),
    item('Tachado', 'format:strike', 'CmdOrCtrl+Shift+X'),
    item('Resaltar', 'format:highlight', 'CmdOrCtrl+Shift+H'),
    item('Código', 'format:code', 'CmdOrCtrl+E'),
    item('Enlace', 'format:link', 'CmdOrCtrl+K'),
    { type: 'separator' },
    { label: 'Encabezados', submenu: [1, 2, 3, 4, 5, 6].map((n) => item(`Encabezado ${n}`, `format:h${n}`, `CmdOrCtrl+Alt+${n}`)).concat([item('Texto normal', 'format:paragraph', 'CmdOrCtrl+Alt+0')]) },
    item('Lista', 'format:bullet', 'CmdOrCtrl+Shift+8'),
    item('Lista numerada', 'format:number', 'CmdOrCtrl+Shift+7'),
    item('Tarea', 'format:task', 'CmdOrCtrl+Enter'),
    item('Llevar completadas al final', 'format:sorttasks'),
    item('Cita', 'format:quote', 'CmdOrCtrl+Shift+.'),
    { label: 'Aviso', submenu: [
      item('ℹ️ Nota', 'format:callout-note'), item('💡 Consejo', 'format:callout-tip'), item('❗ Importante', 'format:callout-important'),
      item('⚠️ Advertencia', 'format:callout-warning'), item('⛔ Precaución', 'format:callout-caution'),
    ] },
    item('Bloque de código', 'format:codeblock', 'CmdOrCtrl+Shift+E'),
    item('Plantilla de correo…', 'format:mail', 'CmdOrCtrl+Shift+M'),
    item('Fórmula matemática', 'format:math'),
    item('Pie de página', 'format:footnote'),
    item('Línea divisoria', 'format:divider'),
    { type: 'separator' },
    { label: 'Tabla', submenu: [
      ...[[2, 2], [3, 2], [3, 3], [4, 3], [5, 4]].map(([r, c]) => item(`Insertar ${c} × ${r}`, `table:${r}x${c}`)),
      { type: 'separator' },
      item('Añadir fila debajo', 'format:table-row-below'), item('Añadir fila arriba', 'format:table-row-above'), item('Eliminar fila', 'format:table-row-delete'),
      item('Subir fila', 'format:table-row-up'), item('Bajar fila', 'format:table-row-down'),
      { type: 'separator' },
      item('Añadir columna después', 'format:table-col-after'), item('Añadir columna antes', 'format:table-col-before'), item('Eliminar columna', 'format:table-col-delete'),
      item('Mover columna a la izquierda', 'format:table-col-left'), item('Mover columna a la derecha', 'format:table-col-right'),
      { type: 'separator' },
      item('Alinear a la izquierda', 'format:table-align-left'), item('Centrar', 'format:table-align-center'), item('Alinear a la derecha', 'format:table-align-right'),
      item('Ordenar el texto de la tabla', 'format:table-format'),
    ] },
    { label: 'Insertar fecha', submenu: [
      item('Fecha', 'format:date-long'), item('Fecha corta', 'format:date-short'), item('Fecha (ISO 8601)', 'format:date-iso'),
      item('Fecha y hora', 'format:datetime'), item('Fecha y hora (ISO 8601)', 'format:datetime-iso'), item('Solo hora', 'format:time'),
    ] },
    { label: 'Transformaciones', submenu: [item('TODO EN MAYÚSCULAS', 'format:upper'), item('todo en minúsculas', 'format:lower'), item('Mayúsculas Iniciales', 'format:titlecase')] },
  ];
}

function noteItems() {
  return [
    item('Fijar / desfijar', 'note:pin'),
    item('Archivar / desarchivar', 'note:archive'),
    item('Solo lectura / editable', 'note:readonly'),
    item('Duplicar', 'note:duplicate', 'CmdOrCtrl+Alt+D'),
    { type: 'separator' },
    item('Copiar el enlace de la nota', 'note:copy-link'),
    { label: 'Copiar como', submenu: [item('Markdown', 'note:copy-md'), item('HTML', 'note:copy-html'), item('Texto enriquecido', 'note:copy-rich')] },
    { label: 'Exportar nota', submenu: [item('Markdown…', 'note:export-md'), item('HTML…', 'note:export-html'), item('PDF…', 'note:export-pdf')] },
    item('Imprimir…', 'note:print', 'CmdOrCtrl+P'),
    item('Enviar por correo…', 'note:mail'),
    { type: 'separator' },
    item('Leer en voz alta', 'note:speak'),
    item('Detener lectura', 'note:stop-speak'),
    { type: 'separator' },
    item('Mostrar en la carpeta', 'note:reveal'),
    item('Mover a la papelera', 'note:trash'),
  ];
}

const check = (id, label, action, accelerator) => ({ id, label, type: 'checkbox', checked: !!config[id], accelerator, registerAccelerator: false, click: send(action) });
function syncMenuChecks() {
  const m = Menu.getApplicationMenu();
  if (!m) return;
  for (const id of ['typewriter', 'floatOnTop']) { const it = m.getMenuItemById(id); if (it) it.checked = !!config[id]; }
}

function buildAppMenu() {
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about', label: 'Acerca de Apuntes' },
      { type: 'separator' },
      item('Preferencias…', 'settings', 'CmdOrCtrl+,'),
      { type: 'separator' },
      { role: 'hide', label: 'Ocultar Apuntes' }, { role: 'hideOthers', label: 'Ocultar otros' }, { role: 'unhide', label: 'Mostrar todo' },
      { type: 'separator' },
      { role: 'quit', label: 'Salir de Apuntes' },
    ] }] : []),
    { label: 'Archivo', submenu: [
      item('Nueva nota', 'new-note', 'CmdOrCtrl+N'),
      item('Nota de la selección', 'note-from-selection', 'CmdOrCtrl+Shift+N'),
      { type: 'separator' },
      item('Búsqueda rápida…', 'quick-open', 'CmdOrCtrl+O'),
      item('Buscar en todas las notas', 'search', 'CmdOrCtrl+Shift+F'),
      ...(isMac ? [] : [{ type: 'separator' }, item('Preferencias…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' }, { role: 'quit', label: 'Salir' }]),
    ] },
    { label: 'Edición', submenu: [
      { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' },
      { role: 'pasteAndMatchStyle', label: 'Pegar como texto' }, { role: 'selectAll', label: 'Seleccionar todo' },
      { type: 'separator' },
      item('Buscar y reemplazar en la nota…', 'find-in-note', 'CmdOrCtrl+F'),
    ] },
    { label: 'Formato', submenu: formatItems() },
    { label: 'Nota', submenu: noteItems() },
    { label: 'Ver', submenu: [
      item('Mostrar etiquetas, notas y editor', 'layout:1', 'CmdOrCtrl+1'),
      item('Mostrar notas y editor', 'layout:2', 'CmdOrCtrl+2'),
      item('Mostrar solo el editor', 'layout:3', 'CmdOrCtrl+3'),
      { type: 'separator' },
      item('Panel de información', 'info-panel', 'CmdOrCtrl+Alt+I'),
      item('Tabla de contenido', 'toc-panel', 'CmdOrCtrl+Alt+C'),
      item('Enlaces entrantes', 'backlinks-panel', 'CmdOrCtrl+Alt+B'),
      { type: 'separator' },
      item('Plegar todos los encabezados', 'fold-all'),
      item('Desplegar todos los encabezados', 'unfold-all'),
      { type: 'separator' },
      item('Atrás', 'history:back', 'CmdOrCtrl+Alt+Left'),
      item('Adelante', 'history:forward', 'CmdOrCtrl+Alt+Right'),
      { type: 'separator' },
      check('typewriter', 'Modo máquina de escribir', 'toggle:typewriter'),
      check('floatOnTop', 'Flotar por encima de todo', 'toggle:floatOnTop'),
      { type: 'separator' },
      item('Aumentar letra', 'font:1', 'CmdOrCtrl+Plus'),
      item('Reducir letra', 'font:-1', 'CmdOrCtrl+-'),
      item('Tamaño normal', 'font:0', 'CmdOrCtrl+0'),
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
    { role: 'windowMenu', label: 'Ventana' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showContextMenu(params) {
  const tpl = [];
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 5)) tpl.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (!params.dictionarySuggestions.length) tpl.push({ label: 'Sin sugerencias', enabled: false });
    tpl.push({ label: 'Agregar al diccionario', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
  }
  if (params.isEditable) {
    tpl.push(
      { role: 'cut', label: 'Cortar', enabled: params.editFlags.canCut },
      { role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy },
      { role: 'paste', label: 'Pegar' },
      { role: 'selectAll', label: 'Seleccionar todo' },
    );
    if (params.formControlType === 'none' || !params.formControlType) tpl.push({ type: 'separator' }, { label: 'Formato', submenu: formatItems() });
  } else if (params.selectionText) {
    tpl.push({ role: 'copy', label: 'Copiar' });
  }
  if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
}

// ---------- ventana ----------
// Recuerda el tamaño y la posición de la ventana (si la pantalla donde estaba sigue conectada).
function savedBounds() {
  const b = config.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return {};
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
  return visible ? { x: b.x, y: b.y, width: Math.max(760, b.width), height: Math.max(480, b.height) } : { width: Math.max(760, b.width), height: Math.max(480, b.height) };
}
let boundsTimer = null;
function rememberBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    config.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isFullScreen() && !win.isMinimized()) config.bounds = win.getBounds();
    try { saveConfig(); } catch {}
  }, 400);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    ...savedBounds(),
    minWidth: 760,
    minHeight: 480,
    title: 'Apuntes',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#26272b' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 17 },
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: '#888888', height: 48 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (config.maximized) win.maximize();
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, rememberBounds);
  try { win.webContents.session.setSpellCheckerLanguages(['es', 'en-US']); } catch {}
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.show(); if (config.floatOnTop) win.setAlwaysOnTop(true); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('context-menu', (_e, params) => showContextMenu(params));
  win.on('closed', () => { win = null; });
}

// Una sola instancia: si se abre Apuntes otra vez, se muestra la ventana que ya existe.
if (!process.env.APUNTES_TEST && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  loadConfig();
  if (config.vault && !fs.existsSync(config.vault)) config.vault = null;
  startWatcher();
  buildAppMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('will-quit', () => { if (watcher) watcher.close(); });
