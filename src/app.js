import { EditorView, keymap, drawSelection, dropCursor, placeholder } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, indentUnit, codeFolding, foldAll, unfoldAll } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { livePreview, TAG_RE, CODE_LANGS, MAIL_LANGS, parseMail } from './livepreview.js';
import { tablePreview, flushTableEdit, cellFormat, isEditingCell } from './tables.js';
import { COMMANDS, insertTable, insertBlock, mailBlockText } from './format.js';
import { icon } from './icons.js';
import { noteCompletion } from './complete.js';
import { parseQuery, matchNote } from './search.js';
import { askText, confirmBox, pickIcon, quickOpen, lightbox, mailDialog } from './panels.js';
import { noteToHtmlBody, noteToHtmlDocument } from './export.js';

const api = window.apuntes;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const External = Annotation.define();

const THEMES = {
  grafito: 'Grafito',
  'grafito-oscuro': 'Grafito oscuro',
  papel: 'Papel',
  'solarizado-claro': 'Solarizado claro',
  'solarizado-oscuro': 'Solarizado oscuro',
  medianoche: 'Medianoche',
  bosque: 'Bosque',
  carbon: 'Carbón',
  cobalto: 'Cobalto',
  duotono: 'Duotono',
  ayu: 'Ayu claro',
};

// TagCons automáticos (como Bear) para etiquetas comunes
const AUTO_ICONS = {
  ideas: '💡', idea: '💡', recetas: '🍳', receta: '🍳', cocina: '🍳', compras: '🛒', compra: '🛒', supermercado: '🛒',
  trabajo: '💼', diario: '📓', journal: '📓', viajes: '✈️', viaje: '✈️', libros: '📚', lecturas: '📚', musica: '🎵',
  salud: '❤️', proyectos: '🚀', proyecto: '🚀', estudio: '🎓', escuela: '🎓', universidad: '🎓', doctorado: '🎓',
  finanzas: '💰', dinero: '💰', investigacion: '🔬', ciencia: '🔬', docencia: '🍎', clases: '🍎', familia: '👨‍👩‍👧',
  personal: '🙂', tareas: '✅', pendientes: '✅', reuniones: '👥', reunion: '👥', citas: '💬', peliculas: '🎬',
  deporte: '⚽', ejercicio: '🏃', inbox: '📥', archivo: '🗄️', plantillas: '🧩', codigo: '💻', programacion: '💻',
};
const FONTS = { sans: 'Apuntes (Nunito Sans)', inter: 'Inter', serif: 'Serif', mono: 'Monoespaciada' };

const state = {
  vault: null,
  notes: new Map(),
  trash: [],
  view: { kind: 'all' },
  query: '',
  current: null,
  pinned: new Set(), // rutas relativas de notas fijadas (.apuntes.json)
  pinnedTags: new Set(), // etiquetas fijadas (minúsculas)
  tagIcons: {}, // etiqueta (minúsculas) → emoji
  readonly: new Set(), // notas de solo lectura
  selected: new Set(), // selección múltiple en la lista
  hist: { list: [], idx: -1, moving: false },
  panel: null, // 'info' | 'toc' | 'links'
  config: {},
  expanded: new Set(JSON.parse(localStorageGet('apuntes.expanded') || '[]')),
};
const editorStates = new Map();
let view;

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------- rutas ----------
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
function toFileUrl(p) {
  let s2 = p.replace(/\\/g, '/');
  if (!s2.startsWith('/')) s2 = '/' + s2;
  return 'file://' + encodeURI(s2).replace(/#/g, '%23').replace(/\?/g, '%3F');
}
function firstImage(body, notePath) {
  const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(body);
  if (!m) return '';
  if (/^(https?:|data:|file:)/i.test(m[1])) return m[1];
  let p = m[1];
  try { p = decodeURI(p); } catch {}
  return toFileUrl(/^([a-z]:)?[\\/]/i.test(p) ? p : dirOf(notePath) + '/' + p);
}
// Ruta relativa (con /) desde una carpeta hasta un archivo
function relativePath(fromDir, toFile) {
  const norm = (x) => x.replace(/\\/g, '/').split('/').filter(Boolean);
  const a = norm(fromDir), b = norm(toFile);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].map((seg) => encodeURIComponent(seg).replace(/%2F/g, '/')).join('/');
}

// ---------- modelo de nota ----------
function plain(s) {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*)(\|([^\]]*))?\]\]/g, (_m, a, _b, c) => c || a)
    .replace(/^\s*[-*+] \[[ xX]\]\s*/gm, '')
    .replace(/<\/?u>/g, '')
    .replace(/\[![A-Za-z]+\][+-]?/g, '')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_`~=]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function frontmatterTags(fm) {
  const out = [];
  const inline = /^tags:\s*\[(.*)\]\s*$/m.exec(fm);
  if (inline) inline[1].split(',').forEach((x) => out.push(x.trim().replace(/^["'#]+|["']+$/g, '')));
  const block = /^tags:\s*\n((?:\s*-\s*.+\n?)+)/m.exec(fm);
  if (block) block[1].split('\n').forEach((l) => { const m = /-\s*(.+)/.exec(l); if (m) out.push(m[1].trim().replace(/^["'#]+|["']+$/g, '')); });
  const single = /^tags:\s*([^\[\n].*)$/m.exec(fm);
  if (single) single[1].split(/[,\s]+/).forEach((x) => out.push(x.replace(/^#/, '')));
  return out.filter(Boolean);
}

function extractTags(body) {
  const clean = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out = [];
  for (const m of clean.matchAll(TAG_RE)) {
    const tag = m[2].replace(/\/+$/, '');
    if (tag && !/^\d+$/.test(tag)) out.push(tag);
  }
  return out;
}

function parseNote(raw) {
  const content = raw.content;
  let body = content, fmTags = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (fm) { body = content.slice(fm[0].length); fmTags = frontmatterTags(fm[1]); }
  const lines = body.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  const base = raw.rel.split('/').pop().replace(/\.(md|markdown)$/i, '');
  const h1 = first >= 0 ? /^#\s+(.*)$/.exec(lines[first]) : null;
  let title, rest;
  if (h1 && h1[1].trim()) { title = h1[1].trim(); rest = lines.slice(first + 1); }
  else { title = base; rest = first >= 0 ? lines.slice(first) : []; }
  const seen = new Map();
  for (const tag of [...extractTags(body), ...fmTags]) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  return {
    ...raw,
    title,
    hasH1: !!(h1 && h1[1].trim()),
    folder: raw.rel.includes('/') ? raw.rel.slice(0, raw.rel.lastIndexOf('/')) : '',
    snippet: plain(rest.join('\n')).slice(0, 200),
    tags: [...seen.values()],
    open: (body.match(/^\s*[-*+] \[ \]/gm) || []).length,
    done: (body.match(/^\s*[-*+] \[[xX]\]/gm) || []).length,
    words: (plain(body).match(/[\p{L}\p{N}]+/gu) || []).length,
    thumb: firstImage(body, raw.path),
    search: normalize(title + '\n' + content),
  };
}

const currentNote = () => state.notes.get(state.current) || state.trash.find((n) => n.path === state.current);
const isTrashView = () => state.view.kind === 'trash';
const isArchived = (n) => n.rel.startsWith('Archivo/');
const activeNotes = () => [...state.notes.values()].filter((n) => !isArchived(n));

// ---------- filtros ----------
function matchesTag(note, tag) {
  const tl = tag.toLowerCase();
  return note.tags.some((x) => { const xl = x.toLowerCase(); return xl === tl || xl.startsWith(tl + '/'); });
}

function visibleNotes() {
  const v = state.view;
  let arr = isTrashView() ? state.trash : v.kind === 'archive' ? [...state.notes.values()].filter(isArchived) : activeNotes();
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (v.kind === 'todo') arr = arr.filter((n) => n.open > 0);
  else if (v.kind === 'untagged') arr = arr.filter((n) => n.tags.length === 0);
  else if (v.kind === 'today') arr = arr.filter((n) => n.mtime >= t0 || n.birthtime >= t0);
  else if (v.kind === 'pinned') arr = arr.filter((n) => state.pinned.has(n.rel));
  else if (v.kind === 'tag') {
    const tl = v.tag.toLowerCase();
    arr = arr.filter((n) => (state.config.hideSubtags ? n.tags.some((x) => x.toLowerCase() === tl) : matchesTag(n, v.tag)));
  }
  const q = parseQuery(state.query);
  if (!q.empty) arr = arr.filter((n) => matchNote(n, q, { pinned: state.pinned }));
  const key = state.config.listSort || 'mtime';
  const flip = state.config.listDesc === false ? -1 : 1;
  const base = key === 'title' ? (a, b) => a.title.localeCompare(b.title, 'es') : (a, b) => b[key] - a[key];
  const pinRank = (n) => (!isTrashView() && state.pinned.has(n.rel) ? 1 : 0);
  return arr.sort((a, b) => pinRank(b) - pinRank(a) || flip * base(a, b));
}

const tagIcon = (full) => {
  const k = full.toLowerCase();
  if (state.tagIcons[k] !== undefined) return state.tagIcons[k];
  return AUTO_ICONS[normalize(k.split('/').pop())] || '';
};

function tagTree() {
  const root = { children: new Map() };
  for (const n of activeNotes()) {
    for (const tag of n.tags) {
      let node = root, full = '';
      for (const part of tag.split('/').filter(Boolean)) {
        full = full ? full + '/' + part : part;
        const key = part.toLowerCase();
        if (!node.children.has(key)) node.children.set(key, { name: part, full, children: new Map(), notes: new Set() });
        node = node.children.get(key);
        node.notes.add(n.path);
      }
    }
  }
  return root;
}

// ---------- fechas ----------
const fmtTime = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const fmtFull = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtLong = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' });
function niceDate(ms) {
  const d = new Date(ms), now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startToday) return fmtTime.format(d);
  if (ms >= startToday - 864e5) return 'Ayer';
  if (d.getFullYear() === now.getFullYear()) return fmtDay.format(d);
  return fmtFull.format(d);
}

// ---------- render ----------
function renderNav() {
  const all = activeNotes();
  const archived = state.notes.size - all.length;
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const pinnedCount = all.filter((n) => state.pinned.has(n.rel)).length;
  const items = [
    { kind: 'all', label: 'Notas', ic: 'notes', count: all.length },
    { kind: 'untagged', label: 'Sin etiquetas', ic: 'untagged', count: all.filter((n) => !n.tags.length).length },
    { kind: 'todo', label: 'Tareas', ic: 'todo', count: all.filter((n) => n.open > 0).length },
    { kind: 'today', label: 'Hoy', ic: 'today', count: all.filter((n) => n.mtime >= t0 || n.birthtime >= t0).length },
    ...(pinnedCount ? [{ kind: 'pinned', label: 'Fijadas', ic: 'pin', count: pinnedCount }] : []),
    { kind: 'archive', label: 'Archivo', ic: 'archive', count: archived },
    { kind: 'trash', label: 'Papelera', ic: 'trash', count: state.trash.length },
  ];
  $('#nav').innerHTML = items.map((it) => `
    <button class="nav-item ${state.view.kind === it.kind ? 'is-active' : ''}" data-kind="${it.kind}">
      ${icon(it.ic)}<span class="label">${it.label}</span><span class="count">${it.count || ''}</span>
    </button>`).join('');

  const renderTag = (node, depth) => {
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const open = state.expanded.has(node.full.toLowerCase());
    const active = state.view.kind === 'tag' && state.view.tag.toLowerCase() === node.full.toLowerCase();
    return `
      <div class="tag-row ${active ? 'is-active' : ''}" data-tag="${esc(node.full)}" style="--depth:${depth}">
        ${kids.length ? `<span class="chev ${open ? 'is-open' : ''}" data-toggle="${esc(node.full)}">${icon('chevron')}</span>` : '<span class="chev"></span>'}
        ${tagIcon(node.full) ? `<span class="tag-emoji">${tagIcon(node.full)}</span>` : icon('hash')}<span class="label">${esc(node.name)}</span>${depth === 0 && state.pinnedTags.has(node.full.toLowerCase()) ? `<span class="tag-pin">${icon('pin')}</span>` : ''}<span class="count">${node.notes.size}</span>
      </div>
      ${open ? kids.map((k) => renderTag(k, depth + 1)).join('') : ''}`;
  };
  const isPinnedTag = (n) => (state.pinnedTags.has(n.full.toLowerCase()) ? 0 : 1);
  const roots = [...tagTree().children.values()].sort((a, b) => isPinnedTag(a) - isPinnedTag(b) || a.name.localeCompare(b.name, 'es'));
  $('#tags').innerHTML = roots.length ? `<div class="section-title">Etiquetas</div>${roots.map((r) => renderTag(r, 0)).join('')}` : '';
  $('#vault-name').textContent = state.vault ? state.vault.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') : '';
  $('#vault-name').title = state.vault || '';
}

function listTitle() {
  const v = state.view;
  if (v.kind === 'tag') return (tagIcon(v.tag) ? tagIcon(v.tag) + ' ' : '#') + v.tag;
  return { all: 'Notas', todo: 'Tareas', untagged: 'Sin etiquetas', today: 'Hoy', pinned: 'Fijadas', archive: 'Archivo', trash: 'Papelera' }[v.kind] || '#' + v.tag;
}

function renderList() {
  const notes = visibleNotes();
  $('#list-title').innerHTML = `<span>${esc(listTitle())}</span><span class="lt-actions">${isTrashView() && notes.length ? '<button class="link-btn" id="empty-trash">Vaciar</button>' : ''}<button class="icon-btn small" id="list-options" title="Orden y vista previa">${icon('sort')}</button></span>`;
  $('#notes').dataset.preview = state.config.listPreview || 'medium';
  if (!notes.length) {
    const msg = state.query ? 'Sin resultados' : isTrashView() ? 'La papelera está vacía' : state.view.kind === 'archive' ? 'No hay notas archivadas' : 'No hay notas aquí';
    $('#notes').innerHTML = `<div class="list-empty">${msg}</div>`;
    return;
  }
  const actionBtns = (list) => list.map((a) => `<button class="swipe-btn ${a.cls}" data-action="${a.id}">${icon(a.ic)}<span>${a.label}</span></button>`).join('');
  $('#notes').innerHTML = notes.map((n) => {
    const acts = swipeActions(n);
    const pinned = !isTrashView() && state.pinned.has(n.rel);
    const folder = n.folder && n.folder !== 'Archivo' && !n.folder.startsWith('.') ? n.folder : '';
    return `
    <article class="note-item ${n.path === state.current ? 'is-selected' : ''} ${state.selected.size > 1 && state.selected.has(n.path) ? 'is-multi' : ''} ${isTrashView() ? 'is-trash-view' : ''}" data-path="${esc(n.path)}">
      <div class="swipe-actions start">${actionBtns(acts.start)}</div>
      <div class="swipe-actions end">${actionBtns(acts.end)}</div>
      <div class="ni-body">
        <h3>${pinned ? `<span class="pin-mark">${icon('pin')}</span>` : ''}${esc(n.title || 'Sin título')}</h3>
        ${state.config.listPreview === 'large' && n.thumb ? `<img class="ni-thumb" src="${esc(n.thumb)}" alt="" loading="lazy">` : ''}
        <p>${esc(n.snippet) || '<span class="muted">Sin texto adicional</span>'}</p>
        <footer>
          <time>${niceDate(n.mtime)}</time>
          ${folder ? `<span class="pill">${icon('folder')}${esc(folder)}</span>` : ''}
          ${n.open + n.done ? `<span class="pill ${n.open ? '' : 'is-done'}">${icon('todo')}${n.done}/${n.open + n.done}</span>` : ''}
        </footer>
      </div>
    </article>`;
  }).join('');
}

function renderEditorChrome() {
  const n = currentNote();
  $('#app').classList.toggle('no-note', !n);
  if (!n) { $('#editor-info').textContent = ''; $('#editor-actions').innerHTML = ''; return; }
  const inTrash = n.rel.startsWith('.trash/');
  const multi = state.selected.size > 1;
  $('#multi').hidden = !multi;
  if (multi) {
    $('#multi').innerHTML = `<div class="multi-card"><div class="multi-count">${state.selected.size}</div><div class="multi-label">notas seleccionadas</div>
      <div class="multi-actions">${batchMenuItems().filter((x) => x.id).map((x) => `<button class="secondary-btn" data-batch="${x.id}">${x.label}</button>`).join('')}</div>
      <button class="link-btn" data-batch="cancel">Cancelar selección (Esc)</button></div>`;
  }
  $('#editor-info').innerHTML = `${state.readonly.has(n.rel) ? '<span class="ro-badge" title="Solo lectura">🔒</span>' : ''}${n.words} ${n.words === 1 ? 'palabra' : 'palabras'}`;
  $('#editor-info').title = `Modificada: ${fmtLong.format(new Date(n.mtime))}\nCreada: ${fmtLong.format(new Date(n.birthtime))}\n${n.rel}`;
  $('#format-btn').hidden = inTrash;
  $('#editor-actions').innerHTML = inTrash
    ? `<button class="text-btn" data-act="restore">${icon('restore')}Restaurar</button>
       <button class="text-btn danger" data-act="delete">${icon('trash')}Eliminar</button>`
    : `${isArchived(n) ? '' : `<button class="icon-btn ${state.pinned.has(n.rel) ? 'is-on' : ''}" data-act="pin" title="${state.pinned.has(n.rel) ? 'Desfijar' : 'Fijar arriba'}">${icon('pin')}</button>`}
       <button class="icon-btn ${state.panel ? 'is-on' : ''}" data-act="panel" title="Información, contenido y enlaces">${icon('info')}</button>
       <button class="icon-btn" data-act="more" title="Más opciones">${icon('more')}</button>`;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNav(); renderList(); renderEditorChrome(); if (state.panel) renderPanel(); });
}
function renderAll() { renderNav(); renderList(); renderEditorChrome(); renderPanel(); }

// ---------- editor ----------
const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--heading)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, class: 'cm-mono' },
  { tag: t.quote, color: 'var(--quote)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--marks)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className], color: 'var(--syn-func)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-prop)' },
]);

function noteDir() {
  const n = currentNote();
  return n ? n.path.replace(/[\\/][^\\/]*$/, '') : '';
}

const previewOpts = {
  baseDir: noteDir,
  openUrl: (url) => api.openExternal(/^[a-z]+:/i.test(url) ? url : 'https://' + url),
  openWikilink: (target) => openWikilink(target),
  openTag: (tag) => setView({ kind: 'tag', tag }),
  pickLanguage: (current) => pickLanguage(current),
  sendMail: (mail) => sendMail(mail),
};

// Menú para elegir el lenguaje de un bloque de código. Devuelve el id, '' (texto simple) o null si se cancela.
async function pickLanguage(current) {
  const cur = current.toLowerCase();
  const id = await api.popupMenu(CODE_LANGS.map(([k, label]) => ({ id: 'lang:' + k, label, checked: k === cur })));
  return id ? id.slice(5) : null;
}

function makeState(doc, readOnly) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      indentUnit.of('    '),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(highlight),
      search({ top: true }),
      highlightSelectionMatches(),
      placeholder('Empieza a escribir…'),
      livePreview(previewOpts),
      tablePreview(previewOpts),
      codeFolding({ placeholderText: '…' }),
      noteCompletion({
        notes: () => activeNotes().map((n) => ({ name: n.rel.split('/').pop().replace(/\.(md|markdown)$/i, ''), title: n.title, folder: n.folder })),
        tags: () => [...new Set([...state.notes.values()].flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b, 'es')),
      }),
      EditorView.domEventHandlers({
        paste(e, v) {
          const files = [...((e.clipboardData && e.clipboardData.files) || [])];
          if (files.length) { e.preventDefault(); insertFiles(v, files); return true; }
          const text = (e.clipboardData && e.clipboardData.getData('text/plain') || '').trim();
          const sel = v.state.selection.main;
          if (!sel.empty && /^https?:\/\/\S+$/.test(text)) {
            e.preventDefault();
            v.dispatch(v.state.replaceSelection(`[${v.state.sliceDoc(sel.from, sel.to)}](${text})`));
            return true;
          }
          return false;
        },
        drop(e, v) {
          const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
          if (!files.length) return false;
          e.preventDefault();
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos != null) v.dispatch({ selection: { anchor: pos } });
          insertFiles(v, files);
          return true;
        },
      }),
      keymap.of([
        { key: 'Mod-b', run: COMMANDS.bold },
        { key: 'Mod-i', run: COMMANDS.italic },
        { key: 'Mod-Shift-x', run: COMMANDS.strike },
        { key: 'Mod-Shift-h', run: COMMANDS.highlight },
        { key: 'Mod-e', run: COMMANDS.code },
        { key: 'Mod-Shift-e', run: COMMANDS.codeblock },
        { key: 'Mod-Shift-m', run: () => { insertMailTemplate(); return true; } },
        { key: 'Mod-k', run: COMMANDS.link },
        { key: 'Mod-Enter', run: COMMANDS.task },
        { key: 'Mod-Alt-1', run: COMMANDS.h1 },
        { key: 'Mod-Alt-2', run: COMMANDS.h2 },
        { key: 'Mod-Alt-3', run: COMMANDS.h3 },
        { key: 'Mod-Alt-0', run: COMMANDS.paragraph },
        { key: 'Mod-Shift-8', run: COMMANDS.bullet },
        { key: 'Mod-Shift-7', run: COMMANDS.number },
        { key: 'Mod-Shift-.', run: COMMANDS.quote },
        { key: 'Mod-Alt-t', run: COMMANDS.table },
        { key: 'Mod-u', run: COMMANDS.underline },
        { key: 'Mod-Alt-4', run: COMMANDS.h4 },
        { key: 'Mod-Alt-5', run: COMMANDS.h5 },
        { key: 'Mod-Alt-6', run: COMMANDS.h6 },
        indentWithTab,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) onUserEdit(u.state.doc.toString());
        if (u.selectionSet || u.focusChanged || u.docChanged) scheduleFloating();
        if (state.config.typewriter && u.view.hasFocus && (u.docChanged || u.selectionSet) && u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'))) {
          requestAnimationFrame(() => view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) }));
        }
      }),
    ],
  });
}

// ---------- adjuntos (pegar o arrastrar imágenes y archivos) ----------
async function insertFiles(v, files) {
  const n = state.notes.get(state.current);
  if (!n || state.readonly.has(n.rel)) return;
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
  const parts = [];
  for (const f of files) {
    try {
      const isImage = /^image\//.test(f.type);
      let name = f.name || '';
      if (!name || /^image\.(png|jpe?g|gif|webp)$/i.test(name)) name = `Pegado ${stamp}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      const abs = await api.saveAttachment(name, new Uint8Array(await f.arrayBuffer()));
      const rel = relativePath(dirOf(n.path), abs);
      parts.push(isImage ? `![](${rel})` : `[${name}](${rel})`);
    } catch (err) { toast('No se pudo adjuntar: ' + err.message); }
  }
  if (!parts.length) return;
  const sel = v.state.selection.main;
  const line = v.state.doc.lineAt(sel.from);
  const before = line.text.trim() && sel.from !== line.from ? '\n' : '';
  v.dispatch(v.state.replaceSelection(before + parts.join('\n') + '\n'));
  toast(parts.length === 1 ? 'Adjunto guardado en «adjuntos»' : `${parts.length} adjuntos guardados`);
}

// ---------- guardado ----------
let pending = null, saveTimer = null;

function onUserEdit(content) {
  const n = state.notes.get(state.current);
  if (!n) return;
  state.notes.set(n.path, parseNote({ ...n, content, mtime: Date.now() }));
  pending = { path: n.path, content };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
  scheduleRender();
}

async function flush() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const { path, content } = pending;
  pending = null;
  try { await api.writeNote(path, content); }
  catch (err) { toast('No se pudo guardar: ' + err.message); }
}

// Al salir de una nota: guarda, elimina si quedó vacía, o renombra el archivo según el título.
async function leaveCurrent() {
  flushTableEdit();
  const n = state.notes.get(state.current);
  if (n) editorStates.set(n.path, view.state);
  await flush();
  if (!n) return;
  if (n.untouched !== undefined && n.content === n.untouched) {
    if (await api.removeEmpty(n.path, n.untouched)) { state.notes.delete(n.path); editorStates.delete(n.path); }
    return;
  }
  delete n.untouched;
  if (n.hasH1) {
    const base = n.rel.split('/').pop().replace(/\.(md|markdown)$/i, '');
    const want = n.title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '');
    if (want && want !== base && !new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(base)) {
      try {
        const newPath = await api.renameNote(n.path, n.title);
        if (newPath !== n.path) moveNote(n.path, newPath);
      } catch (err) { toast('No se pudo renombrar: ' + err.message); }
    }
  }
}

function moveNote(oldPath, newPath) {
  const n = state.notes.get(oldPath);
  state.notes.delete(oldPath);
  const rel = n.rel.replace(/[^/]*$/, newPath.split(/[\\/]/).pop());
  state.notes.set(newPath, parseNote({ ...n, path: newPath, rel }));
  if (state.pinned.delete(n.rel)) { state.pinned.add(rel); savePins(); }
  if (state.readonly.delete(n.rel)) { state.readonly.add(rel); savePins(); }
  state.hist.list = state.hist.list.map((x) => (x === oldPath ? newPath : x));
  if (editorStates.has(oldPath)) { editorStates.set(newPath, editorStates.get(oldPath)); editorStates.delete(oldPath); }
  if (state.current === oldPath) state.current = newPath;
}

// ---------- acciones ----------
async function openNote(path, { focus = false } = {}) {
  if (state.current === path) { if (focus) view.focus(); return; }
  await leaveCurrent();
  const n = state.notes.get(path) || state.trash.find((x) => x.path === path);
  if (!n) { state.current = null; renderAll(); return; }
  state.current = path;
  if (!state.hist.moving) {
    state.hist.list = state.hist.list.slice(0, state.hist.idx + 1).filter((x) => x !== path);
    state.hist.list.push(path);
    state.hist.idx = state.hist.list.length - 1;
  }
  const readOnly = n.rel.startsWith('.trash/') || state.readonly.has(n.rel);
  const cached = editorStates.get(path);
  view.setState(cached && cached.doc.toString() === n.content ? cached : makeState(n.content, readOnly));
  $('#editor-scroll').scrollTop = 0;
  renderAll();
  const el = document.querySelector(`.note-item[data-path="${CSS.escape(path)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
  if (focus) view.focus();
}

async function clearEditor() {
  await leaveCurrent();
  state.current = null;
  view.setState(makeState('', true));
  renderAll();
}

async function newNote() {
  if (!state.vault) return;
  await leaveCurrent();
  if (state.view.kind === 'trash') state.view = { kind: 'all' };
  const content = state.view.kind === 'tag' ? `# \n\n#${state.view.tag}\n` : '# \n';
  const raw = await api.createNote(content);
  state.notes.set(raw.path, { ...parseNote(raw), untouched: content });
  state.current = null;
  state.query = '';
  $('#search').value = '';
  await openNote(raw.path);
  view.dispatch({ selection: { anchor: 2 } });
  view.focus();
}

async function openWikilink(target) {
  const want = normalize(target.replace(/#.*$/, '').trim());
  let found = [...state.notes.values()].find((n) => normalize(n.rel.replace(/\.(md|markdown)$/i, '')) === want)
    || [...state.notes.values()].find((n) => normalize(n.rel.split('/').pop().replace(/\.(md|markdown)$/i, '')) === want)
    || [...state.notes.values()].find((n) => normalize(n.title) === want);
  if (!found) {
    await leaveCurrent();
    const content = `# ${target.replace(/#.*$/, '').trim()}\n\n`;
    const raw = await api.createNote(content);
    found = parseNote(raw);
    state.notes.set(raw.path, found);
    state.current = null;
  }
  if (state.view.kind !== 'all' && !visibleNotes().includes(found)) state.view = { kind: 'all' };
  await openNote(found.path, { focus: true });
}

async function setView(v) {
  state.view = v;
  if (v.kind === 'trash') state.trash = (await api.loadTrash()).map(parseNote);
  const list = visibleNotes();
  renderAll();
  if (!list.some((n) => n.path === state.current)) {
    if (list[0]) await openNote(list[0].path); else await clearEditor();
  }
}

// Quita una nota de la lista actual (papelera, archivo o vuelta a Notas) y abre la siguiente si era la actual.
async function removeFromList(path, op, msg) {
  const list = visibleNotes();
  const idx = list.findIndex((x) => x.path === path);
  const wasCurrent = state.current === path;
  await flush();
  if (wasCurrent) state.current = null;
  editorStates.delete(path);
  const n = state.notes.get(path);
  state.notes.delete(path);
  if (n && state.pinned.delete(n.rel)) savePins();
  try {
    const raw = await op(path);
    if (raw && raw.path) state.notes.set(raw.path, parseNote(raw));
  } catch (err) {
    if (n) state.notes.set(path, n);
    toast('No se pudo: ' + err.message);
  }
  if (wasCurrent) {
    const next = list[idx + 1] || list[idx - 1];
    if (next && next.path !== path) await openNote(next.path); else await clearEditor();
  } else renderAll();
  if (msg) toast(msg);
}

const trashNoteAt = (p) => removeFromList(p, api.trashNote, 'Nota movida a la papelera');
const archiveNoteAt = (p) => removeFromList(p, api.archiveNote, 'Nota archivada');
const unarchiveNoteAt = (p) => removeFromList(p, api.restoreNote, 'Nota devuelta a Notas');
async function trashCurrent() { if (state.notes.has(state.current)) await trashNoteAt(state.current); }

function savePins() {
  api.setMeta({ pinned: [...state.pinned], pinnedTags: [...state.pinnedTags], tagIcons: state.tagIcons, readonly: [...state.readonly] })
    .catch(() => toast('No se pudieron guardar los ajustes de la bóveda'));
}
function applyMeta(meta) {
  state.pinned = new Set(meta.pinned || []);
  state.pinnedTags = new Set(meta.pinnedTags || []);
  state.tagIcons = meta.tagIcons || {};
  state.readonly = new Set(meta.readonly || []);
}
function togglePin(path) {
  const n = state.notes.get(path);
  if (!n) return;
  const was = state.pinned.has(n.rel);
  was ? state.pinned.delete(n.rel) : state.pinned.add(n.rel);
  savePins();
  renderList();
  toast(was ? 'Nota desfijada' : 'Nota fijada arriba');
}

async function restoreTrashed(path) {
  const n = state.trash.find((x) => x.path === path);
  if (!n) return;
  const raw = await api.restoreNote(n.path);
  state.trash = state.trash.filter((x) => x !== n);
  state.notes.set(raw.path, parseNote(raw));
  if (state.current === path) state.current = null;
  return raw;
}

async function restoreCurrent() {
  const raw = await restoreTrashed(state.current);
  if (!raw) return;
  state.view = { kind: 'all' };
  await openNote(raw.path);
  toast('Nota restaurada');
}

async function deleteForever(paths) {
  if (!paths.length) return;
  const ok = await confirmBox({ title: paths.length > 1 ? `¿Eliminar ${paths.length} notas definitivamente?` : '¿Eliminar esta nota definitivamente?', label: 'Saldrán de Apuntes y quedarán en la papelera del sistema.', ok: 'Eliminar', danger: true });
  if (!ok) return;
  for (const p of paths) await api.deleteForever(p);
  state.trash = state.trash.filter((x) => !paths.includes(x.path));
  if (paths.includes(state.current)) state.current = null;
  await setView({ kind: 'trash' });
}

// ---------- más acciones de nota (como en Bear) ----------
const baseName = (n) => n.rel.split('/').pop().replace(/\.(md|markdown)$/i, '');
const noteByPath = (p) => state.notes.get(p) || state.trash.find((x) => x.path === p);

async function createAndOpen(content, msg) {
  await leaveCurrent();
  const raw = await api.createNote(content);
  state.notes.set(raw.path, parseNote(raw));
  if (!['all', 'today'].includes(state.view.kind)) state.view = { kind: 'all' };
  state.current = null;
  await openNote(raw.path, { focus: true });
  if (msg) toast(msg);
}

async function duplicateNote(path) {
  const n = state.notes.get(path);
  if (!n) return;
  await flush();
  await createAndOpen(n.content, 'Nota duplicada');
}

async function noteFromSelection() {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to).trim();
  if (!text) return toast('Selecciona texto para crear una nota con él');
  const content = /^#\s/.test(text) ? text + '\n' : `# ${text.split('\n')[0].slice(0, 80)}\n\n${text.split('\n').slice(1).join('\n')}\n`;
  await createAndOpen(content, 'Nota creada con la selección');
}

function toggleReadonly(path) {
  const n = state.notes.get(path);
  if (!n) return;
  const was = state.readonly.has(n.rel);
  was ? state.readonly.delete(n.rel) : state.readonly.add(n.rel);
  savePins();
  editorStates.delete(path);
  if (path === state.current) {
    const head = view.state.selection.main.head;
    view.setState(makeState(n.content, !was));
    view.dispatch({ selection: { anchor: Math.min(head, n.content.length) } });
  }
  renderAll();
  toast(was ? 'La nota vuelve a ser editable' : 'Nota en solo lectura 🔒');
}

const htmlDoc = (n) => noteToHtmlDocument(n.title, n.content, dirOf(n.path), state.config.katexUrl);
async function copyAs(path, kind) {
  const n = noteByPath(path);
  if (!n) return;
  await flush();
  if (kind === 'md') await api.writeClipboard({ text: n.content });
  else if (kind === 'html') await api.writeClipboard({ text: noteToHtmlBody(n.content, dirOf(n.path)) });
  else await api.writeClipboard({ html: noteToHtmlBody(n.content, dirOf(n.path)), text: n.content });
  toast('Copiado');
}
async function exportNote(path, kind) {
  const n = noteByPath(path);
  if (!n) return;
  await flush();
  const name = baseName(n);
  let out = null;
  try {
    if (kind === 'md') out = await api.exportSave({ defaultName: name + '.md', content: n.content, ext: 'md' });
    else if (kind === 'html') out = await api.exportSave({ defaultName: name + '.html', content: htmlDoc(n), ext: 'html' });
    else if (kind === 'pdf') { toast('Generando PDF…'); out = await api.exportPdf({ defaultName: name + '.pdf', html: htmlDoc(n) }); }
  } catch (err) { return toast('No se pudo exportar: ' + err.message); }
  if (out) toast('Exportada: ' + out.split(/[\\/]/).pop());
}
async function printNote(path) {
  const n = noteByPath(path);
  if (!n) return;
  await flush();
  api.print(htmlDoc(n));
}
function speak(path) {
  const n = noteByPath(path);
  if (!n || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const sel = path === state.current ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '';
  const u = new SpeechSynthesisUtterance(sel || plain(n.content));
  u.lang = 'es-MX';
  const voice = speechSynthesis.getVoices().find((x) => /^es/i.test(x.lang));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
  toast('Leyendo en voz alta… (Nota → Detener lectura)');
}

// ---------- plantillas de correo ----------
// Markdown → texto sencillo para el cuerpo del correo (las apps de correo reciben texto sin formato).
function mailPlain(md) {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1').replace(/==([^=\n]+)==/g, '$1').replace(/<\/?u>/g, '').replace(/`([^`\n]+)`/g, '$1')
    .replace(/^(\s*)[-*+] \[ \] /gm, '$1☐ ').replace(/^(\s*)[-*+] \[[xX]\] /gm, '$1☑ ').replace(/^(\s*)[-*+] /gm, '$1• ')
    .replace(/^#{1,6}\s+/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, a, b) => b || a);
}
const mailList = (x) => x.split(/[;,]/).map((y) => y.trim()).filter(Boolean).join(',');
const mailEnc = (x) => encodeURIComponent(x).replace(/%40/g, '@').replace(/%2C/g, ',');

// Revisa el correo (y pide los datos {{variables}}) y, si aceptas, lo abre como borrador en tu app de correo.
async function sendMail(mail) {
  flushTableEdit();
  const res = await mailDialog({ mode: 'send', mail });
  if (!res) return;
  const body = mailPlain(res.body).replace(/\r?\n/g, '\r\n');
  if (res.action === 'copy') {
    await api.writeClipboard({ text: mailPlain(res.body), html: noteToHtmlBody(res.body, noteDir()) });
    return toast('Mensaje copiado');
  }
  const params = [];
  if (res.cc) params.push('cc=' + mailEnc(mailList(res.cc)));
  if (res.bcc) params.push('bcc=' + mailEnc(mailList(res.bcc)));
  if (res.subject) params.push('subject=' + encodeURIComponent(res.subject));
  let url = `mailto:${mailEnc(mailList(res.to))}`;
  const limit = state.config.platform === 'win32' ? 1900 : 30000;
  const full = url + '?' + [...params, 'body=' + encodeURIComponent(body)].join('&');
  let note = 'Borrador abierto en tu aplicación de correo';
  if (full.length <= limit) url = full;
  else {
    // Mensaje demasiado largo para pasarlo directo: va al portapapeles.
    await api.writeClipboard({ text: mailPlain(res.body) });
    url += params.length ? '?' + params.join('&') : '';
    note = 'El mensaje es largo: se copió. Pégalo en el borrador con ' + (isMac() ? '⌘V' : 'Ctrl+V');
  }
  const ok = await api.openExternal(url);
  toast(ok === false ? 'No se pudo abrir la aplicación de correo' : note);
}

// «Nota → Enviar por correo»: usa el primer bloque de correo de la nota; si no hay, el título es el asunto y el texto el mensaje.
async function mailNote(path) {
  const n = noteByPath(path);
  if (!n) return;
  if (path === state.current) flushTableEdit();
  const content = path === state.current ? view.state.doc.toString() : n.content;
  const block = /^(`{3,}|~{3,})[ \t]*(\w+)[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm;
  for (const m of content.matchAll(block)) if (MAIL_LANGS.has(m[2].toLowerCase())) return sendMail(parseMail(m[3]));
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s*#\s+.*\n?/, '')
    .split('\n').filter((l) => !/^\s*(#[\p{L}\p{N}_][\p{L}\p{N}_\-/]*\s*)+$/u.test(l)).join('\n').trim();
  return sendMail({ to: '', cc: '', bcc: '', subject: n.title, body });
}

// Formato → Plantilla de correo: pide los datos e inserta el bloque en la nota.
async function insertMailTemplate() {
  const n = state.notes.get(state.current);
  if (!n || state.readonly.has(n.rel)) return;
  flushTableEdit();
  const sel = view.state.selection.main;
  const res = await mailDialog({ mode: 'insert', mail: { to: '', cc: '', bcc: '', subject: '', body: view.state.sliceDoc(sel.from, sel.to) } });
  if (!res) { view.focus(); return; }
  view.focus();
  if (!sel.empty) view.dispatch({ changes: { from: sel.from, to: sel.to }, selection: { anchor: sel.from } });
  insertBlock(mailBlockText(res))(view);
  toast('Plantilla lista: pulsa «Enviar» en el bloque cuando la necesites');
}

// ---------- etiquetas: renombrar, eliminar, fijar, ícono ----------
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tagRegex(tag) { return new RegExp(`(^|[\\s(])#${escRe(tag)}(?=/|[\\s.,;:!?)\\]]|$)`, 'giu'); }

async function rewriteNotes(fn) {
  let count = 0;
  await flush();
  for (const n of [...state.notes.values()]) {
    const next = fn(n.content);
    if (next === n.content) continue;
    count++;
    if (n.path === state.current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    } else {
      await api.writeNote(n.path, next);
      state.notes.set(n.path, parseNote({ ...n, content: next, mtime: Date.now() }));
      editorStates.delete(n.path);
    }
  }
  await flush();
  return count;
}

async function renameTag(tag) {
  const nuevo = await askText({ title: 'Cambiar nombre de etiqueta', label: `Se cambiará en todas las notas que usan #${tag}`, value: tag, ok: 'Cambiar' });
  const clean = nuevo && nuevo.replace(/^#/, '').trim().replace(/\s+/g, '-');
  if (!clean || clean === tag) return;
  const count = await rewriteNotes((c) => c.replace(tagRegex(tag), (_m, pre) => `${pre}#${clean}`)
    .replace(/^(---\r?\n[\s\S]*?\r?\n---)/, (fm) => fm.replace(new RegExp(`(?<=[\\[\\s,'"-])${escRe(tag)}(?=[\\],\\s'"/]|$)`, 'gmi'), clean)));
  const old = tag.toLowerCase();
  for (const k of Object.keys(state.tagIcons)) if (k === old || k.startsWith(old + '/')) { state.tagIcons[clean.toLowerCase() + k.slice(old.length)] = state.tagIcons[k]; delete state.tagIcons[k]; }
  if (state.pinnedTags.delete(old)) state.pinnedTags.add(clean.toLowerCase());
  savePins();
  if (state.view.kind === 'tag' && state.view.tag.toLowerCase().startsWith(old)) state.view = { kind: 'tag', tag: clean + state.view.tag.slice(tag.length) };
  renderAll();
  toast(`Etiqueta cambiada en ${count} nota${count === 1 ? '' : 's'}`);
}

async function deleteTag(tag) {
  if (!(await confirmBox({ title: `¿Eliminar la etiqueta #${tag}?`, label: 'Se quitará el texto de la etiqueta en todas las notas. Las notas no se borran.', ok: 'Eliminar etiqueta', danger: true }))) return;
  const count = await rewriteNotes((c) => c.replace(new RegExp(`(^|[\\s(])#${escRe(tag)}(/[\\p{L}\\p{N}_\\-/]*)?(?=[\\s.,;:!?)\\]]|$)`, 'giu'), '$1').replace(/[ \t]+$/gm, ''));
  if (state.view.kind === 'tag') state.view = { kind: 'all' };
  renderAll();
  toast(`Etiqueta quitada de ${count} nota${count === 1 ? '' : 's'}`);
}

async function tagMenu(tag) {
  const k = tag.toLowerCase();
  const id = await api.popupMenu([
    { id: 'pin', label: state.pinnedTags.has(k) ? 'Desfijar etiqueta' : 'Fijar etiqueta arriba' },
    { id: 'icon', label: 'Cambiar ícono…' },
    { id: 'rename', label: 'Cambiar nombre…' },
    { type: 'separator' },
    { id: 'expand', label: 'Expandir todas las etiquetas' },
    { id: 'collapse', label: 'Contraer todas las etiquetas' },
    { type: 'separator' },
    { id: 'delete', label: 'Eliminar etiqueta…' },
  ]);
  if (id === 'pin') { state.pinnedTags.has(k) ? state.pinnedTags.delete(k) : state.pinnedTags.add(k); savePins(); renderNav(); }
  else if (id === 'icon') {
    const ic = await pickIcon(tag, tagIcon(tag));
    if (ic === null) return;
    state.tagIcons[k] = ic;
    savePins(); renderAll();
  } else if (id === 'rename') renameTag(tag);
  else if (id === 'delete') deleteTag(tag);
  else if (id === 'expand' || id === 'collapse') {
    state.expanded = new Set();
    if (id === 'expand') for (const n of state.notes.values()) for (const t2 of n.tags) { const parts = t2.split('/'); for (let i = 1; i < parts.length; i++) state.expanded.add(parts.slice(0, i).join('/').toLowerCase()); }
    localStorageSet('apuntes.expanded', JSON.stringify([...state.expanded]));
    renderNav();
  }
}

// ---------- lista: opciones de orden y vista previa ----------
async function listOptions() {
  const c = state.config;
  const id = await api.popupMenu([
    { label: 'Ordenar por', submenu: [
      { id: 'sort:mtime', label: 'Fecha de modificación', checked: (c.listSort || 'mtime') === 'mtime' },
      { id: 'sort:birthtime', label: 'Fecha de creación', checked: c.listSort === 'birthtime' },
      { id: 'sort:title', label: 'Título', checked: c.listSort === 'title' },
      { type: 'separator' },
      { id: 'desc', label: c.listSort === 'title' ? 'De la A a la Z' : 'Más recientes arriba', checked: c.listDesc !== false },
    ] },
    { label: 'Vista previa', submenu: [
      { id: 'prev:small', label: 'Pequeña', checked: c.listPreview === 'small' },
      { id: 'prev:medium', label: 'Mediana', checked: (c.listPreview || 'medium') === 'medium' },
      { id: 'prev:large', label: 'Grande (con imagen)', checked: c.listPreview === 'large' },
    ] },
    { id: 'subtags', label: 'Ocultar notas de subetiquetas', checked: !!c.hideSubtags },
  ]);
  if (!id) return;
  if (id.startsWith('sort:')) await updateConfig({ listSort: id.slice(5) });
  else if (id === 'desc') await updateConfig({ listDesc: c.listDesc === false });
  else if (id.startsWith('prev:')) await updateConfig({ listPreview: id.slice(5) });
  else if (id === 'subtags') await updateConfig({ hideSubtags: !c.hideSubtags });
  renderList();
}

// ---------- selección múltiple y fusionar ----------
function clearSelection() {
  if (!state.selected.size) return;
  state.selected.clear();
  renderList(); renderEditorChrome();
}
async function batchAction(id, paths) {
  if (id === 'merge') return mergeNotes(paths);
  if (id === 'delete') return deleteForever(paths);
  for (const p of paths) {
    if (id === 'trash') await removeFromList(p, api.trashNote, '');
    else if (id === 'archive') await removeFromList(p, api.archiveNote, '');
    else if (id === 'unarchive') await removeFromList(p, api.restoreNote, '');
    else if (id === 'restore') await restoreTrashed(p);
    else if (id === 'pin') { const n = state.notes.get(p); if (n) state.pinned.add(n.rel); }
    else if (id === 'unpin') { const n = state.notes.get(p); if (n) state.pinned.delete(n.rel); }
  }
  if (id === 'pin' || id === 'unpin') savePins();
  if (id === 'restore') await setView({ kind: 'trash' });
  state.selected.clear();
  renderAll();
  const label = { trash: 'movidas a la papelera', archive: 'archivadas', unarchive: 'devueltas a Notas', restore: 'restauradas', pin: 'fijadas', unpin: 'desfijadas' }[id];
  if (label) toast(`${paths.length} notas ${label}`);
}
async function mergeNotes(paths) {
  const list = visibleNotes().filter((n) => paths.includes(n.path)).reverse(); // de la más antigua a la más reciente
  if (list.length < 2) return;
  if (!(await confirmBox({ title: `¿Fusionar ${list.length} notas?`, label: 'Se creará una nota nueva con todo el contenido y las originales irán a la papelera.', ok: 'Fusionar' }))) return;
  await flush();
  const merged = list.map((n) => n.content.trim()).join('\n\n---\n\n') + '\n';
  for (const n of list) await removeFromList(n.path, api.trashNote, '');
  state.selected.clear();
  await createAndOpen(merged, `${list.length} notas fusionadas`);
}
function batchMenuItems() {
  if (isTrashView()) return [{ id: 'restore', label: 'Restaurar' }, { id: 'delete', label: 'Eliminar definitivamente' }];
  const archived = state.view.kind === 'archive';
  return [
    { id: 'merge', label: 'Fusionar notas' },
    { type: 'separator' },
    { id: 'pin', label: 'Fijar' }, { id: 'unpin', label: 'Desfijar' },
    archived ? { id: 'unarchive', label: 'Sacar del archivo' } : { id: 'archive', label: 'Archivar' },
    { type: 'separator' },
    { id: 'trash', label: 'Mover a la papelera' },
  ];
}

// ---------- historial (atrás / adelante) ----------
async function historyGo(step) {
  const h = state.hist;
  let i = h.idx + step;
  while (i >= 0 && i < h.list.length && !noteByPath(h.list[i])) i += step;
  if (i < 0 || i >= h.list.length) return;
  h.idx = i;
  h.moving = true;
  try {
    const n = noteByPath(h.list[i]);
    if (!visibleNotes().includes(n)) state.view = isArchived(n) ? { kind: 'archive' } : { kind: 'all' };
    await openNote(h.list[i]);
  } finally { h.moving = false; }
}

// ---------- vistas (Ctrl/⌘ 1, 2, 3) ----------
function setLayout(n) {
  const app = $('#app');
  app.classList.toggle('hide-sidebar', n === 2);
  app.classList.toggle('focus-mode', n === 3);
  localStorageSet('apuntes.layout', String(n));
}
const currentLayout = () => ($('#app').classList.contains('focus-mode') ? 3 : $('#app').classList.contains('hide-sidebar') ? 2 : 1);
const toggleFocus = () => setLayout(currentLayout() === 3 ? 1 : 3);

// Arrastrar los bordes de la barra lateral y de la lista para cambiar su ancho (doble clic: tamaño original).
const COL_LIMITS = { sidebar: [170, 380, 232], list: [240, 520, 330] };
function applyColumnWidths() {
  for (const k of Object.keys(COL_LIMITS)) {
    const v = Number(localStorageGet('apuntes.w.' + k));
    document.documentElement.style.setProperty(`--${k}-w`, (v >= COL_LIMITS[k][0] && v <= COL_LIMITS[k][1] ? v : COL_LIMITS[k][2]) + 'px');
  }
}
function bindResizers() {
  applyColumnWidths();
  document.querySelectorAll('.resizer').forEach((h) => {
    const k = h.dataset.col, [min, max, def] = COL_LIMITS[k];
    h.addEventListener('dblclick', () => { localStorageSet('apuntes.w.' + k, String(def)); applyColumnWidths(); });
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const el = h.parentElement, start = e.clientX, w0 = el.getBoundingClientRect().width;
      document.body.classList.add('is-resizing');
      const move = (ev) => {
        const w = Math.round(Math.max(min, Math.min(max, w0 + ev.clientX - start)));
        document.documentElement.style.setProperty(`--${k}-w`, w + 'px');
        localStorageSet('apuntes.w.' + k, String(w));
      };
      const up = () => { document.body.classList.remove('is-resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  });
}

// ---------- panel lateral: información, contenido y enlaces ----------
function headingsOf(content) {
  const out = [];
  let pos = 0, inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], pos });
    pos += line.length + 1;
  }
  return out;
}
function togglePanel(tab) {
  state.panel = state.panel === tab ? null : tab;
  renderPanel();
}
function gotoPos(pos) {
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 80 }) });
  view.focus();
}
function renderPanel() {
  const el = $('#side-panel');
  const n = currentNote();
  $('#editor-pane').classList.toggle('with-panel', !!state.panel && !!n);
  if (!state.panel || !n) { el.hidden = true; return; }
  el.hidden = false;
  const tabs = [['info', 'Información'], ['toc', 'Contenido'], ['links', 'Enlaces']];
  let body = '';
  if (state.panel === 'info') {
    const text = plain(n.content.replace(/^---[\s\S]*?---\n?/, ''));
    const chars = text.length, noSpaces = text.replace(/\s/g, '').length;
    const paragraphs = n.content.split(/\n\s*\n/).filter((x) => x.trim()).length;
    const minutes = Math.max(1, Math.round(n.words / 200));
    body = `<dl class="sp-stats">
      <div><dt>Palabras</dt><dd>${n.words.toLocaleString('es')}</dd></div>
      <div><dt>Caracteres</dt><dd>${chars.toLocaleString('es')}</dd></div>
      <div><dt>Sin espacios</dt><dd>${noSpaces.toLocaleString('es')}</dd></div>
      <div><dt>Párrafos</dt><dd>${paragraphs}</dd></div>
      <div><dt>Lectura</dt><dd>${minutes} min</dd></div>
      <div><dt>Tareas</dt><dd>${n.done}/${n.open + n.done}</dd></div>
    </dl>
    <div class="sp-meta"><span>Creada</span>${fmtLong.format(new Date(n.birthtime))}</div>
    <div class="sp-meta"><span>Modificada</span>${fmtLong.format(new Date(n.mtime))}</div>
    <div class="sp-meta"><span>Archivo</span>${esc(n.rel)}</div>
    ${n.tags.length ? `<div class="sp-meta"><span>Etiquetas</span>${n.tags.map((t2) => `<a class="sp-tag" data-tag="${esc(t2)}">#${esc(t2)}</a>`).join(' ')}</div>` : ''}`;
  } else if (state.panel === 'toc') {
    const hs = headingsOf(view.state.doc.toString());
    const min = Math.min(...hs.map((h) => h.level), 6);
    body = hs.length ? `<nav class="sp-toc">${hs.map((h) => `<a data-pos="${h.pos}" style="--lvl:${h.level - min}">${esc(h.text.replace(/[*_`~=]/g, ''))}</a>`).join('')}</nav>` : '<p class="sp-empty">Esta nota no tiene encabezados.</p>';
  } else {
    const name = normalize(baseName(n)), title = normalize(n.title);
    const linkRe = (x) => new RegExp(`\\[\\[${escRe(x)}(\\|[^\\]]*|#[^\\]]*)?\\]\\]`);
    const others = activeNotes().filter((x) => x.path !== n.path);
    const back = others.filter((x) => linkRe(name).test(normalize(x.content)) || (title !== name && linkRe(title).test(normalize(x.content))));
    const mentions = title.length >= 3 ? others.filter((x) => !back.includes(x) && x.search.includes(title)) : [];
    const item = (x) => `<a class="sp-link" data-path="${esc(x.path)}"><strong>${esc(x.title)}</strong><span>${esc(x.snippet.slice(0, 90))}</span></a>`;
    body = `<h4>Enlaces entrantes · ${back.length}</h4>${back.length ? back.map(item).join('') : '<p class="sp-empty">Ninguna nota enlaza a esta con [[…]].</p>'}
      <h4>Menciones sin enlace · ${mentions.length}</h4>${mentions.length ? mentions.slice(0, 30).map(item).join('') : '<p class="sp-empty">Sin menciones.</p>'}`;
  }
  el.innerHTML = `<div class="sp-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${state.panel === k ? 'on' : ''}">${l}</button>`).join('')}<button class="sp-close" data-close title="Cerrar">×</button></div><div class="sp-body">${body}</div>`;
}

// ---------- búsqueda rápida (Ctrl/⌘ O) ----------
function quickSearch(qRaw) {
  const q = normalize(qRaw.trim());
  const notes = activeNotes();
  if (q.startsWith('#')) {
    const t2 = q.slice(1);
    const tags = [...new Set(notes.flatMap((n) => n.tags))].filter((x) => normalize(x).includes(t2)).sort((a, b) => a.localeCompare(b, 'es'));
    return tags.map((tag) => ({ kind: tagIcon(tag) || '#', label: tag, detail: `${notes.filter((n) => matchesTag(n, tag)).length} notas`, run: () => setView({ kind: 'tag', tag }) }));
  }
  const sections = [];
  const wantSections = q.startsWith('@');
  const sq = wantSections ? q.slice(1) : q;
  const scored = [];
  for (const n of notes) {
    const t2 = normalize(n.title);
    if (!wantSections && (!q || t2.includes(q))) scored.push({ n, score: !q ? 0 : t2.startsWith(q) ? 2 : 1 });
    if (sq && (wantSections || scored.length < 40)) {
      for (const h of headingsOf(n.content)) {
        if (h.level > 1 && normalize(h.text).includes(sq)) sections.push({ kind: '§', label: h.text, detail: n.title, run: () => openNote(n.path).then(() => gotoPos(h.pos)) });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || b.n.mtime - a.n.mtime);
  const noteItems = scored.map(({ n }) => ({ kind: state.pinned.has(n.rel) ? '📌' : '📄', label: n.title, detail: n.folder || niceDate(n.mtime), run: () => { if (!visibleNotes().includes(n)) state.view = { kind: 'all' }; openNote(n.path, { focus: true }); } }));
  return wantSections ? sections : [...noteItems, ...sections.slice(0, 15)];
}

// ---------- apariencia ----------
const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const c = state.config;
  const theme = c.theme === 'system' ? (media.matches ? 'grafito-oscuro' : 'grafito') : c.theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.font = c.font || 'sans';
  root.style.setProperty('--font-size', (c.fontSize || 17) + 'px');
  root.style.setProperty('--line-width', (c.lineWidth || 720) + 'px');
  root.style.setProperty('--line-height', c.lineHeight || 1.7);
  root.dataset.width = c.fullWidth === false ? 'fixed' : 'full';
  const cs = getComputedStyle(root);
  api.setTitlebar({ bg: cs.getPropertyValue('--editor-bg').trim(), fg: cs.getPropertyValue('--muted').trim() });
}
media.addEventListener('change', applyAppearance);

const DEFAULT_SIZE = 17;
function changeFontSize(step) {
  const cur = state.config.fontSize || DEFAULT_SIZE;
  const next = step === 0 ? DEFAULT_SIZE : Math.max(12, Math.min(32, cur + step));
  updateConfig({ fontSize: next });
  toast(`Tamaño de letra: ${next}`);
}

async function updateConfig(patch) {
  Object.assign(state.config, patch);
  applyAppearance();
  const label = document.getElementById('fm-size-val');
  if (label) label.textContent = state.config.fontSize || DEFAULT_SIZE;
  await api.setConfig(patch);
}

function openSettings() {
  const c = state.config;
  $('#set-theme').innerHTML = `<option value="system">Automático (sistema)</option>` +
    Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#set-font').innerHTML = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#set-theme').value = c.theme || 'system';
  $('#set-font').value = c.font || 'sans';
  $('#set-size').value = c.fontSize || 17;
  $('#set-width').value = c.lineWidth || 720;
  $('#set-full').checked = c.fullWidth !== false;
  $('#set-width-row').hidden = c.fullWidth !== false;
  $('#set-lh').value = c.lineHeight || 1.7;
  $('#set-vault').textContent = state.vault || '—';
  $('#settings').showModal();
}

// ---------- avisos ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

// ---------- lista: deslizar (dos dedos o táctil) y clic derecho ----------
function swipeActions(n) {
  if (isTrashView()) {
    return { start: [{ id: 'delete', label: 'Eliminar', ic: 'trash', cls: 'danger' }], end: [{ id: 'restore', label: 'Restaurar', ic: 'restore', cls: 'neutral' }] };
  }
  const archived = isArchived(n);
  return {
    start: [
      { id: 'trash', label: 'Eliminar', ic: 'trash', cls: 'danger' },
      archived ? { id: 'unarchive', label: 'Sacar', ic: 'unarchive', cls: 'neutral' } : { id: 'archive', label: 'Archivar', ic: 'archive', cls: 'neutral' },
    ],
    end: archived ? [] : [{ id: 'pin', label: state.pinned.has(n.rel) ? 'Desfijar' : 'Fijar', ic: 'pin', cls: 'pin' }],
  };
}

function noteMenuItems(path) {
  if (isTrashView()) return [{ id: 'restore', label: 'Restaurar' }, { type: 'separator' }, { id: 'delete', label: 'Eliminar definitivamente' }];
  const n = state.notes.get(path);
  if (!n) return [];
  const archived = isArchived(n);
  return [
    ...(archived ? [] : [{ id: 'pin', label: state.pinned.has(n.rel) ? 'Desfijar' : 'Fijar arriba' }]),
    archived ? { id: 'unarchive', label: 'Sacar del archivo' } : { id: 'archive', label: 'Archivar' },
    { id: 'duplicate', label: 'Duplicar' },
    { id: 'readonly', label: state.readonly.has(n.rel) ? 'Convertir en editable' : 'Convertir en solo lectura' },
    { type: 'separator' },
    { id: 'copy-link', label: 'Copiar enlace a la nota' },
    { label: 'Copiar como', submenu: [{ id: 'copy-md', label: 'Markdown' }, { id: 'copy-html', label: 'HTML' }, { id: 'copy-rich', label: 'Texto enriquecido' }] },
    { label: 'Exportar', submenu: [{ id: 'export-md', label: 'Markdown…' }, { id: 'export-html', label: 'HTML…' }, { id: 'export-pdf', label: 'PDF…' }] },
    { id: 'print', label: 'Imprimir…' },
    { id: 'mail', label: 'Enviar por correo…' },
    { id: 'reveal', label: isMac() ? 'Mostrar en Finder' : 'Mostrar en la carpeta' },
    { type: 'separator' },
    { id: 'trash', label: 'Mover a la papelera' },
  ];
}

async function runNoteAction(id, path) {
  switch (id) {
    case 'trash': return trashNoteAt(path);
    case 'archive': return archiveNoteAt(path);
    case 'unarchive': return unarchiveNoteAt(path);
    case 'pin': return togglePin(path);
    case 'reveal': return api.reveal(path);
    case 'duplicate': return duplicateNote(path);
    case 'readonly': return toggleReadonly(path);
    case 'copy-md': return copyAs(path, 'md');
    case 'copy-html': return copyAs(path, 'html');
    case 'copy-rich': return copyAs(path, 'rich');
    case 'export-md': return exportNote(path, 'md');
    case 'export-html': return exportNote(path, 'html');
    case 'export-pdf': return exportNote(path, 'pdf');
    case 'print': return printNote(path);
    case 'mail': return mailNote(path);
    case 'speak': return speak(path);
    case 'stop-speak': return window.speechSynthesis && speechSynthesis.cancel();
    case 'delete': return deleteForever([path]);
    case 'restore': { await restoreTrashed(path); toast('Nota restaurada'); return setView({ kind: 'trash' }); }
    case 'copy-link': {
      const n = state.notes.get(path);
      if (!n) return;
      try { await navigator.clipboard.writeText(`[[${n.rel.split('/').pop().replace(/\.(md|markdown)$/i, '')}]]`); toast('Enlace copiado'); }
      catch { toast('No se pudo copiar'); }
    }
  }
}

const SWIPE_BTN = 78;
let swipe = null;      // gesto de rueda/trackpad en curso
let touch = null;      // gesto táctil en curso
let openItem = null;   // fila que quedó abierta mostrando botones
let suppressClick = false;
const swipeWidth = (item, side) => item.querySelectorAll(`.swipe-actions.${side} .swipe-btn`).length * SWIPE_BTN;

function setOffset(item, x, animate) {
  const body = item.querySelector('.ni-body');
  if (!body) return;
  body.style.transition = animate ? 'transform .26s cubic-bezier(.3,.7,.2,1)' : 'none';
  body.style.transform = x ? `translateX(${x}px)` : '';
  item.dataset.offset = x;
  if (x) {
    item.classList.add('is-swiping');
    item.classList.toggle('show-start', x > 0);
    item.classList.toggle('show-end', x < 0);
  } else {
    setTimeout(() => { if (Number(item.dataset.offset) === 0) item.classList.remove('is-swiping', 'show-start', 'show-end'); }, animate ? 260 : 0);
  }
}
function closeSwipe(item = openItem) {
  if (item) setOffset(item, 0, true);
  if (item === openItem) openItem = null;
}
function moveSwipe(item, x) {
  const s = swipeWidth(item, 'start'), e = swipeWidth(item, 'end');
  x = Math.max(e ? -(e + 150) : 0, Math.min(s ? s + 150 : 0, x));
  setOffset(item, x, false);
  return x;
}
// allowFull: un deslizamiento largo ejecuta la primera acción (solo táctil o hacia "Fijar").
function endSwipe(item, x, allowFull) {
  const s = swipeWidth(item, 'start'), e = swipeWidth(item, 'end');
  const path = item.dataset.path;
  if (s && allowFull && x > s + 100) {
    const id = item.querySelector('.swipe-actions.start .swipe-btn').dataset.action;
    setOffset(item, item.offsetWidth, true);
    openItem = null;
    setTimeout(() => runNoteAction(id, path), 200);
  } else if (s && x > 40) { setOffset(item, s, true); openItem = item; }
  else if (e && x < -(e + 60)) {
    const id = item.querySelector('.swipe-actions.end .swipe-btn').dataset.action;
    closeSwipe(item);
    if (id === 'pin') runNoteAction(id, path); else { setOffset(item, -e, true); openItem = item; }
  } else if (e && x < -36) { setOffset(item, -e, true); openItem = item; }
  else closeSwipe(item);
}

function bindListGestures() {
  const list = $('#notes');
  list.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const item = swipe ? swipe.item : e.target.closest('.note-item');
    if (!item || !item.isConnected) return;
    e.preventDefault();
    if (!swipe) {
      if (openItem && openItem !== item) closeSwipe();
      swipe = { item, x: Number(item.dataset.offset || 0) };
    }
    swipe.x = moveSwipe(item, swipe.x - e.deltaX);
    clearTimeout(swipe.timer);
    swipe.timer = setTimeout(() => { const g = swipe; swipe = null; if (g.item.isConnected) endSwipe(g.item, g.x, false); }, 140);
  }, { passive: false });

  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const item = e.target.closest('.note-item');
    if (item) touch = { item, id: e.pointerId, x0: e.clientX, y0: e.clientY, base: Number(item.dataset.offset || 0), active: false, x: 0 };
  });
  list.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
    if (!touch.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      touch.active = true;
      if (openItem && openItem !== touch.item) closeSwipe();
      touch.item.setPointerCapture(e.pointerId);
    }
    touch.x = moveSwipe(touch.item, touch.base + dx);
  });
  const endTouch = () => {
    if (touch && touch.active) { endSwipe(touch.item, touch.x, true); suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); }
    touch = null;
  };
  list.addEventListener('pointerup', endTouch);
  list.addEventListener('pointercancel', endTouch);

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.note-item');
    const btn = e.target.closest('.swipe-btn');
    if (btn && item) { closeSwipe(item); runNoteAction(btn.dataset.action, item.dataset.path); return; }
    if (suppressClick) return;
    if (openItem) { closeSwipe(); return; }
    if (!item) return;
    const p = item.dataset.path;
    if (e.metaKey || e.ctrlKey) {
      if (!state.selected.size && state.current) state.selected.add(state.current);
      state.selected.has(p) ? state.selected.delete(p) : state.selected.add(p);
      renderList(); renderEditorChrome();
      return;
    }
    if (e.shiftKey && state.current) {
      const list = visibleNotes().map((n) => n.path);
      const a = list.indexOf(state.current), b = list.indexOf(p);
      state.selected = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
      renderList(); renderEditorChrome();
      return;
    }
    if (state.selected.size) { state.selected.clear(); renderEditorChrome(); }
    openNote(p);
  });

  list.addEventListener('contextmenu', async (e) => {
    const item = e.target.closest('.note-item');
    if (!item) return;
    e.preventDefault();
    closeSwipe();
    const path = item.dataset.path;
    if (state.selected.size > 1 && state.selected.has(path)) {
      const id = await api.popupMenu(batchMenuItems());
      if (id) batchAction(id, [...state.selected]);
      return;
    }
    item.classList.add('is-context');
    const id = await api.popupMenu(noteMenuItems(path));
    item.classList.remove('is-context');
    if (id) runNoteAction(id, path);
  });

  document.addEventListener('mousedown', (e) => { if (openItem && !openItem.contains(e.target)) closeSwipe(); });
}

// ---------- formato: barra flotante, menú "Aa" y selector de tablas ----------
const isMac = () => state.config.platform === 'darwin';
const keyLabel = (k) => (isMac() ? k.replace(/Mod/g, '⌘').replace(/Shift/g, '⇧').replace(/Alt/g, '⌥').replace(/-/g, '') : k.replace(/Mod/g, 'Ctrl').replace(/-/g, '+'));
const FLOAT_ITEMS = [
  ['bold', '<b>B</b>', 'Negrita', 'Mod-B'],
  ['italic', '<i>I</i>', 'Cursiva', 'Mod-I'],
  ['strike', '<s>S</s>', 'Tachado', 'Mod-Shift-X'],
  ['highlight', '<span class="g-mark">A</span>', 'Resaltar', 'Mod-Shift-H'],
  ['code', '<span class="g-code">&lt;/&gt;</span>', 'Código', 'Mod-E'],
  ['link', icon('link'), 'Enlace', 'Mod-K'],
  '|',
  ['h1', '<span class="g-h">H1</span>', 'Título 1', 'Mod-Alt-1'],
  ['h2', '<span class="g-h">H2</span>', 'Título 2', 'Mod-Alt-2'],
  ['quote', icon('quote'), 'Cita', 'Mod-Shift-.'],
];
const MENU_LIST = [
  ['bullet', icon('list'), 'Lista', 'Mod-Shift-8'],
  ['number', icon('numbered'), 'Lista numerada', 'Mod-Shift-7'],
  ['task', icon('todo'), 'Tarea', 'Mod-Enter'],
  ['quote', icon('quote'), 'Cita', 'Mod-Shift-.'],
  ['link', icon('link'), 'Enlace', 'Mod-K'],
  ['codeblock', icon('codeblock'), 'Bloque de código', 'Mod-Shift-E'],
  ['mail', icon('mail'), 'Plantilla de correo…', 'Mod-Shift-M'],
  ['divider', icon('divider'), 'Línea divisoria', ''],
];

function runFormat(id) {
  if (!state.notes.has(state.current)) return;
  if (id === 'mail') { closeFormatMenu(); return insertMailTemplate(); }
  const cmd = COMMANDS[id];
  if (!cmd) return;
  if (isEditingCell() && cellFormat(id)) return closeFormatMenu(); // dentro de una celda de tabla
  view.focus();
  cmd(view);
  closeFormatMenu();
}

let floatQueued = false, pointerDown = false;
function scheduleFloating() {
  if (floatQueued) return;
  floatQueued = true;
  requestAnimationFrame(() => { floatQueued = false; positionFloating(); });
}
function positionFloating() {
  const bar = $('#format-bar');
  const sel = view.state.selection.main;
  if (sel.empty || !view.hasFocus || pointerDown || !state.notes.has(state.current)) { bar.classList.remove('is-visible'); return; }
  const a = view.coordsAtPos(sel.from), b = view.coordsAtPos(sel.to);
  if (!a || !b) { bar.classList.remove('is-visible'); return; }
  const pane = $('#editor-pane').getBoundingClientRect();
  const w = bar.offsetWidth || 360, h = bar.offsetHeight || 38;
  const center = a.top === b.top ? (a.left + b.right) / 2 : a.left + 120;
  let left = Math.max(12, Math.min(pane.width - w - 12, center - pane.left - w / 2));
  let top = a.top - pane.top - h - 10;
  if (top < 56) top = b.bottom - pane.top + 10;
  bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  bar.classList.add('is-visible');
}

function buildFormatUI() {
  const btn = (it, cls) => `<button class="${cls}" data-fmt="${it[0]}" title="${it[2]}${it[3] ? ' (' + keyLabel(it[3]) + ')' : ''}">${it[1]}</button>`;
  $('#format-bar').innerHTML = FLOAT_ITEMS.map((it) => (it === '|' ? '<span class="sep"></span>' : btn(it, 'fb-btn'))).join('');
  const seg = [['h1', 'H1', 'Título 1', 'Mod-Alt-1'], ['h2', 'H2', 'Título 2', 'Mod-Alt-2'], ['h3', 'H3', 'Título 3', 'Mod-Alt-3'], ['paragraph', 'Texto', 'Texto normal', 'Mod-Alt-0']];
  const inline = FLOAT_ITEMS.slice(0, 5);
  let grid = '';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) grid += `<span data-r="${r + 1}" data-c="${c + 1}"></span>`;
  $('#format-menu').innerHTML = `
    <div class="fm-size"><span>Tamaño de letra</span><button data-size="-1" title="Reducir (${isMac() ? '⌘ −' : 'Ctrl −'})">A−</button><em id="fm-size-val">${state.config.fontSize || DEFAULT_SIZE}</em><button data-size="1" title="Aumentar (${isMac() ? '⌘ +' : 'Ctrl +'})">A+</button></div>
    <div class="fm-seg">${seg.map((it) => btn(it, 'fm-seg-btn')).join('')}</div>
    <div class="fm-seg">${inline.map((it) => btn(it, 'fm-seg-btn')).join('')}</div>
    <div class="fm-list">${MENU_LIST.map((it) => `<button class="fm-item" data-fmt="${it[0]}">${it[1]}<span>${it[2]}</span><kbd>${it[3] ? keyLabel(it[3]) : ''}</kbd></button>`).join('')}</div>
    <div class="fm-table"><div class="fm-table-title">${icon('table')}<span>Insertar tabla</span><em id="fm-table-size"></em></div><div class="fm-grid">${grid}</div></div>`;
}

function openFormatMenu() {
  const menu = $('#format-menu');
  if (!menu.hidden) return closeFormatMenu();
  const b = $('#format-btn').getBoundingClientRect(), pane = $('#editor-pane').getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = Math.max(12, Math.min(b.left - pane.left - 10, pane.width - menu.offsetWidth - 12)) + 'px';
  $('#format-btn').classList.add('is-active');
}
function closeFormatMenu() {
  $('#format-menu').hidden = true;
  $('#format-btn').classList.remove('is-active');
}

function bindFormatUI() {
  buildFormatUI();
  const onFmtClick = (e) => {
    const size = e.target.closest('[data-size]');
    if (size) return changeFontSize(Number(size.dataset.size));
    const b = e.target.closest('[data-fmt]');
    if (b) runFormat(b.dataset.fmt);
  };
  for (const el of [$('#format-bar'), $('#format-menu')]) {
    el.addEventListener('mousedown', (e) => e.preventDefault()); // no quitar el foco del editor
    el.addEventListener('click', onFmtClick);
  }
  $('#format-btn').addEventListener('mousedown', (e) => e.preventDefault());
  $('#format-btn').addEventListener('click', openFormatMenu);
  const grid = $('#format-menu');
  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.fm-grid span');
    if (!cell) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    grid.querySelectorAll('.fm-grid span').forEach((s) => s.classList.toggle('on', +s.dataset.r <= r && +s.dataset.c <= c));
    $('#fm-table-size').textContent = `${c} × ${r}`;
  });
  grid.addEventListener('mouseleave', () => { grid.querySelectorAll('.fm-grid span.on').forEach((s) => s.classList.remove('on')); $('#fm-table-size').textContent = ''; });
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.fm-grid span');
    if (!cell || !state.notes.has(state.current)) return;
    view.focus();
    insertTable(+cell.dataset.r, +cell.dataset.c)(view);
    closeFormatMenu();
  });
  document.addEventListener('mousedown', (e) => {
    if (!$('#format-menu').hidden && !e.target.closest('#format-menu, #format-btn')) closeFormatMenu();
  });
  $('#editor').addEventListener('pointerdown', () => { pointerDown = true; $('#format-bar').classList.remove('is-visible'); });
  window.addEventListener('pointerup', () => { if (pointerDown) { pointerDown = false; scheduleFloating(); } });
  $('#editor-scroll').addEventListener('scroll', scheduleFloating, { passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFormatMenu(); $('#format-bar').classList.remove('is-visible'); } });
}

// ---------- carga ----------
async function loadVault() {
  const { vault, notes } = await api.loadNotes();
  state.vault = vault;
  state.notes = new Map(notes.map((n) => [n.path, parseNote(n)]));
  applyMeta(vault ? await api.getMeta() : {});
  editorStates.clear();
  state.current = null;
  $('#welcome').hidden = !!vault;
  $('#app').hidden = !vault;
  if (!vault) return showWelcome();
  state.view = { kind: 'all' };
  renderAll();
  const first = visibleNotes()[0];
  if (first) await openNote(first.path); else await clearEditor();
}

async function showWelcome() {
  const dbx = await api.detectDropbox();
  $('#welcome-dropbox').hidden = !dbx;
  if (dbx) {
    $('#welcome-dropbox-path').textContent = dbx;
    $('#welcome-dropbox').onclick = async () => { await api.useVault(dbx); await loadVault(); };
  }
}

async function chooseVault() {
  const dir = await api.chooseVault();
  if (dir) { await flush(); await loadVault(); }
  return dir;
}

// ---------- eventos ----------
function bindEvents() {
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (b) setView({ kind: b.dataset.kind });
  });
  $('#tags').addEventListener('click', (e) => {
    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      const key = tog.dataset.toggle.toLowerCase();
      state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      localStorageSet('apuntes.expanded', JSON.stringify([...state.expanded]));
      renderNav();
      return;
    }
    const row = e.target.closest('.tag-row');
    if (row) setView({ kind: 'tag', tag: row.dataset.tag });
  });
  $('#tags').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tag-row');
    if (!row) return;
    e.preventDefault();
    tagMenu(row.dataset.tag);
  });
  $('#side-panel').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.panel = tab.dataset.tab; return renderPanel(); }
    if (e.target.closest('[data-close]')) { state.panel = null; renderPanel(); return renderEditorChrome(); }
    const toc = e.target.closest('[data-pos]');
    if (toc) return gotoPos(Number(toc.dataset.pos));
    const link = e.target.closest('.sp-link');
    if (link) { const n = state.notes.get(link.dataset.path); if (n && !visibleNotes().includes(n)) state.view = { kind: 'all' }; return openNote(link.dataset.path); }
    const tg = e.target.closest('.sp-tag');
    if (tg) setView({ kind: 'tag', tag: tg.dataset.tag });
  });
  $('#multi').addEventListener('click', (e) => {
    const b = e.target.closest('[data-batch]');
    if (!b) return;
    if (b.dataset.batch === 'cancel') clearSelection(); else batchAction(b.dataset.batch, [...state.selected]);
  });
  $('#editor').addEventListener('click', (e) => {
    const img = e.target.closest('.cm-image img');
    if (img) lightbox(img.src);
  });
  $('#notes').addEventListener('dblclick', (e) => { if (e.target.closest('.note-item')) view.focus(); });
  $('#list-title').addEventListener('click', (e) => {
    if (e.target.id === 'empty-trash') deleteForever(state.trash.map((n) => n.path));
    if (e.target.closest('#list-options')) listOptions();
  });
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
    const list = visibleNotes();
    if (list.length && !list.some((n) => n.path === state.current)) openNote(list[0].path);
  });
  $('#search').addEventListener('keydown', (e) => {
    const list = visibleNotes();
    const idx = list.findIndex((n) => n.path === state.current);
    if (e.key === 'ArrowDown' && list[idx + 1]) { e.preventDefault(); openNote(list[idx + 1].path); }
    else if (e.key === 'ArrowUp' && list[idx - 1]) { e.preventDefault(); openNote(list[idx - 1].path); }
    else if (e.key === 'Enter' && state.current) { e.preventDefault(); view.focus(); }
    else if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); }
  });
  $('#new-note').addEventListener('click', newNote);
  $('#empty-new').addEventListener('click', newNote);
  $('#show-lists').addEventListener('click', () => setLayout(1));
  $('#toggle-sidebar').addEventListener('click', () => toggleFocus());
  $('#open-settings').addEventListener('click', openSettings);
  $('#editor-actions').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'trash') trashCurrent();
    else if (a === 'pin') { togglePin(state.current); renderEditorChrome(); }
    else if (a === 'archive') archiveNoteAt(state.current);
    else if (a === 'unarchive') unarchiveNoteAt(state.current);
    else if (a === 'reveal') api.reveal(state.current);
    else if (a === 'panel') { state.panel = state.panel ? null : 'info'; renderPanel(); renderEditorChrome(); }
    else if (a === 'more') api.popupMenu(noteMenuItems(state.current)).then((id) => id && runNoteAction(id, state.current));
    else if (a === 'restore') restoreCurrent();
    else if (a === 'delete') deleteForever([state.current]);
  });

  $('#set-theme').addEventListener('change', (e) => updateConfig({ theme: e.target.value }));
  $('#set-font').addEventListener('change', (e) => updateConfig({ font: e.target.value }));
  $('#set-size').addEventListener('input', (e) => updateConfig({ fontSize: Number(e.target.value) }));
  $('#set-width').addEventListener('input', (e) => updateConfig({ lineWidth: Number(e.target.value) }));
  $('#set-full').addEventListener('change', (e) => { updateConfig({ fullWidth: e.target.checked }); $('#set-width-row').hidden = e.target.checked; });
  $('#set-lh').addEventListener('input', (e) => updateConfig({ lineHeight: Number(e.target.value) }));
  $('#set-change-vault').addEventListener('click', async () => { if (await chooseVault()) $('#settings').close(); });
  $('#set-open-vault').addEventListener('click', () => api.openFolder());
  $('#settings-close').addEventListener('click', () => $('#settings').close());
  $('#welcome-choose').addEventListener('click', chooseVault);

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && state.selected.size && !document.querySelector('.ov')) { clearSelection(); return; }
    if (!mod) return;
    if (document.querySelector('.ov') || $('#settings').open) return; // hay un diálogo abierto
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') && !view.dom.contains(e.target) || isEditingCell();
    const code = e.code;
    if (e.altKey && !e.shiftKey) {
      if (code === 'ArrowLeft') { e.preventDefault(); return historyGo(-1); }
      if (code === 'ArrowRight') { e.preventDefault(); return historyGo(1); }
      if (code === 'KeyI') { e.preventDefault(); return togglePanel('info'); }
      if (code === 'KeyC') { e.preventDefault(); return togglePanel('toc'); }
      if (code === 'KeyB') { e.preventDefault(); return togglePanel('links'); }
      if (code === 'KeyD') { e.preventDefault(); return duplicateNote(state.current); }
    }
    if (!e.altKey && !e.shiftKey && /^Digit[123]$/.test(code)) { e.preventDefault(); return setLayout(Number(code.slice(5))); }
    if (!e.altKey && e.shiftKey && code === 'KeyM' && !view.hasFocus) { e.preventDefault(); return insertMailTemplate(); }
    if (!e.altKey && code === 'KeyO') { e.preventDefault(); return quickOpen(quickSearch); }
    if (!e.altKey && !e.shiftKey && code === 'KeyP') { e.preventDefault(); return printNote(state.current); }
    if (!e.altKey && e.shiftKey && code === 'KeyN') { e.preventDefault(); return noteFromSelection(); }
    if (!e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeFontSize(1); }
    else if (!e.altKey && e.key === '-') { e.preventDefault(); changeFontSize(-1); }
    else if (!e.altKey && e.key === '0') { e.preventDefault(); changeFontSize(0); }
    else if (e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); newNote(); }
    else if (e.key.toLowerCase() === 'f' && e.shiftKey) { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (e.key === '\\') { e.preventDefault(); toggleFocus(); }
    else if (e.key === ',') { e.preventDefault(); openSettings(); }
    else if (e.key === 'Backspace' && !view.hasFocus && !typing && state.notes.has(state.current)) { e.preventDefault(); trashCurrent(); }
  });

  window.addEventListener('blur', () => { flushTableEdit(); flush(); });
  window.addEventListener('beforeunload', () => {
    flushTableEdit();
    clearTimeout(saveTimer);
    if (pending) { api.writeNoteSync(pending.path, pending.content); pending = null; }
  });

  api.onMenu((action) => {
    if (action === 'new-note') newNote();
    else if (action === 'settings') openSettings();
    else if (action.startsWith('font:')) changeFontSize(Number(action.slice(5)));
    else if (action === 'quick-open') quickOpen(quickSearch);
    else if (action === 'note-from-selection') noteFromSelection();
    else if (action === 'find-in-note') { view.focus(); import('@codemirror/search').then((m) => m.openSearchPanel(view)); }
    else if (action.startsWith('layout:')) setLayout(Number(action.slice(7)));
    else if (action === 'info-panel') togglePanel('info');
    else if (action === 'toc-panel') togglePanel('toc');
    else if (action === 'backlinks-panel') togglePanel('links');
    else if (action === 'fold-all') { view.focus(); foldAll(view); }
    else if (action === 'unfold-all') { view.focus(); unfoldAll(view); }
    else if (action === 'history:back') historyGo(-1);
    else if (action === 'history:forward') historyGo(1);
    else if (action === 'toggle:typewriter') { updateConfig({ typewriter: !state.config.typewriter }); toast(state.config.typewriter ? 'Modo máquina de escribir activado' : 'Modo máquina de escribir desactivado'); }
    else if (action === 'toggle:floatOnTop') { updateConfig({ floatOnTop: !state.config.floatOnTop }); toast(state.config.floatOnTop ? 'Apuntes flotará por encima de todo' : 'Ventana normal'); }
    else if (action.startsWith('note:')) {
      const id = action.slice(5);
      const n = state.notes.get(state.current);
      if (!n && id !== 'stop-speak') return;
      if (id === 'pin') togglePin(state.current);
      else if (id === 'archive') (isArchived(n) ? unarchiveNoteAt : archiveNoteAt)(state.current);
      else runNoteAction(id, state.current);
    }
    else if (action === 'focus-mode') toggleFocus();
    else if (action === 'search') { $('#search').focus(); $('#search').select(); }
    else if (action.startsWith('format:')) runFormat(action.slice(7));
    else if (action.startsWith('table:')) { const [r, c] = action.slice(6).split('x').map(Number); if (state.notes.has(state.current)) { view.focus(); insertTable(r, c)(view); } }
  });

  api.onMetaChanged((meta) => { applyMeta(meta); scheduleRender(); });

  // Cambios que llegan desde Dropbox u otra app
  api.onNoteChanged((raw) => {
    const existing = state.notes.get(raw.path);
    if (existing && existing.content === raw.content) return;
    if (raw.path === state.current && pending) return; // tus cambios locales tienen prioridad
    state.notes.set(raw.path, parseNote(raw));
    editorStates.delete(raw.path);
    if (raw.path === state.current) {
      const cur = view.state.doc.toString();
      if (cur !== raw.content) {
        const head = Math.min(view.state.selection.main.head, raw.content.length);
        view.dispatch({ changes: { from: 0, to: cur.length, insert: raw.content }, selection: { anchor: head }, annotations: External.of(true) });
      }
    }
    scheduleRender();
  });
  api.onNoteRemoved(async (p) => {
    if (!state.notes.has(p)) return;
    state.notes.delete(p);
    editorStates.delete(p);
    if (state.current === p) { pending = null; state.current = null; view.setState(makeState('', true)); }
    scheduleRender();
  });
}

function decorateIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); });
}

async function init() {
  state.config = await api.getConfig();
  document.body.classList.add('platform-' + state.config.platform);
  applyAppearance();
  decorateIcons();
  view = new EditorView({ parent: $('#editor'), state: makeState('', true) });
  bindEvents();
  bindFormatUI();
  bindListGestures();
  bindResizers();
  setLayout(Number(localStorageGet('apuntes.layout')) || 1);
  if (typeof __APUNTES_TEST__ !== 'undefined' && __APUNTES_TEST__) window.__apuntes = { view, state, sendMail, mailNote, runFormat };
  await loadVault();
}

init();
