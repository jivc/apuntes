// Tablas: siempre se ven como tabla. Se editan celda por celda (clic, Tab, Enter, flechas) y el
// Markdown se reescribe solo. «Ver Markdown» en la barrita de la tabla muestra el texto original.
import { StateField, StateEffect, Prec } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { undo } from '@codemirror/commands';
import { renderMath } from './livepreview.js';

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function inlineMarkdown(src) {
  let h = esc(src.replace(/\\\|/g, '|'));
  h = h
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?![*\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>')
    .replace(/&lt;br\s*\/?&gt;/g, '<br>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => `<a class="cm-wikilink is-rendered" data-wikilink="${a}">${b || a}</a>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="cm-link is-rendered" data-url="$2">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu, '$1<span class="cm-tag">#$2</span>');
  return h;
}

// Celdas de una línea de tabla: rango interno (entre barras) y rango sin espacios.
export function cellsOfLine(line) {
  const text = line.text;
  const pipes = [];
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') inCode = !inCode;
    else if (text[i] === '\\') i++;
    else if (text[i] === '|' && !inCode) pipes.push(i);
  }
  const bounds = [];
  const leading = /^\s*\|/.test(text), trailing = /\|\s*$/.test(text) && pipes.length > (leading ? 1 : 0);
  const edges = [leading ? pipes[0] : -1, ...pipes.slice(leading ? 1 : 0, trailing ? -1 : undefined), trailing ? pipes[pipes.length - 1] : text.length];
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i] + 1, end = edges[i + 1];
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const content = raw.trim();
    const from = content ? start + lead : Math.min(start + 1, end);
    bounds.push({ start: line.from + start, end: line.from + end, from: line.from + from, to: line.from + from + content.length, text: content });
  }
  return bounds;
}

const isDelimiter = (text) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(text);
const alignOf = (c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : '');

// Rango de líneas completas de una tabla (sin líneas en blanco al final).
function rangeOf(state, node) {
  const from = state.doc.lineAt(node.from).from;
  let last = state.doc.lineAt(node.to);
  while (last.from > from && !last.text.trim()) last = state.doc.line(last.number - 1);
  return { from, to: last.to };
}
function tableAt(state, pos) {
  if (!state.doc.lineAt(pos).text.trim()) return null; // una línea en blanco nunca es parte de una tabla
  for (const side of [-1, 1]) {
    for (let n = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Table') { const r = rangeOf(state, n); return pos >= r.from && pos <= r.to ? n : null; }
    }
  }
  return null;
}
// Solo las tablas al nivel del documento se muestran como tabla (dentro de citas o listas se dejan como texto).
const isTopLevel = (node) => !!node.parent && node.parent.name === 'Document';

// ---------- modelo ----------
// Texto de la tabla → { rows: [[texto]], pos: [[posición en el documento]], align: [] }
function parseTable(text, from) {
  const rows = [], pos = [];
  let align = [], offset = from;
  for (const [i, l] of text.split('\n').entries()) {
    const line = { text: l, from: offset };
    offset += l.length + 1;
    const cells = cellsOfLine(line);
    if (i === 1 && isDelimiter(l)) { align = cells.map((c) => alignOf(c.text)); continue; }
    rows.push(cells.map((c) => c.text));
    pos.push(cells.map((c) => c.from));
  }
  const cols = Math.max(1, align.length, ...rows.map((r) => r.length));
  rows.forEach((r, i) => { while (r.length < cols) { r.push(''); pos[i].push(pos[i][pos[i].length - 1] ?? from); } });
  while (align.length < cols) align.push('');
  return { from, to: from + text.length, rows, pos, align };
}

const width = (s) => [...s].length;
function serializeTable(t) {
  const w = t.align.map((_, c) => Math.max(3, ...t.rows.map((r) => width(r[c] || ''))));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
  const line = (r) => '| ' + r.map((x, c) => pad(x || '', w[c])).join(' | ') + ' |';
  const sep = '| ' + t.align.map((a, c) => {
    const d = '-'.repeat(w[c]);
    return a === 'center' ? ':' + d.slice(2) + ':' : a === 'right' ? d.slice(1) + ':' : a === 'left' ? ':' + d.slice(1) : d;
  }).join(' | ') + ' |';
  const lines = [line(t.rows[0]), sep, ...t.rows.slice(1).map(line)];
  const offsetOf = (cell) => {
    const r = Math.max(0, Math.min(cell.r, t.rows.length - 1)), c = Math.max(0, Math.min(cell.c, t.align.length - 1));
    let offset = lines.slice(0, r === 0 ? 0 : r + 1).reduce((n, l) => n + l.length + 1, 0) + 2;
    for (let i = 0; i < c; i++) offset += w[i] + 3;
    return offset;
  };
  return { text: lines.join('\n'), offsetOf };
}

// Aplica una operación al modelo y devuelve la celda donde debe quedar el cursor (o null si no aplica).
function applyOp(t, op, cur) {
  const { r, c } = cur;
  const cols = t.align.length;
  const empty = () => Array(cols).fill('');
  const swapCols = (a, b) => { t.rows.forEach((row) => { [row[a], row[b]] = [row[b], row[a]]; }); [t.align[a], t.align[b]] = [t.align[b], t.align[a]]; };
  switch (op) {
    case 'row-below': t.rows.splice(r + 1, 0, empty()); return { r: r + 1, c };
    case 'row-above': { const at = Math.max(1, r); t.rows.splice(at, 0, empty()); return { r: at, c }; }
    case 'row-delete':
      if (r === 0) return null;
      if (t.rows.length <= 2) { t.rows[1] = empty(); return { r: 1, c }; }
      t.rows.splice(r, 1); return { r: Math.min(r, t.rows.length - 1), c };
    case 'row-up': if (r <= 1) return null; [t.rows[r - 1], t.rows[r]] = [t.rows[r], t.rows[r - 1]]; return { r: r - 1, c };
    case 'row-down': if (r === 0 || r >= t.rows.length - 1) return null; [t.rows[r + 1], t.rows[r]] = [t.rows[r], t.rows[r + 1]]; return { r: r + 1, c };
    case 'col-after': t.rows.forEach((row) => row.splice(c + 1, 0, '')); t.align.splice(c + 1, 0, ''); return { r, c: c + 1 };
    case 'col-before': t.rows.forEach((row) => row.splice(c, 0, '')); t.align.splice(c, 0, ''); return { r, c };
    case 'col-delete': if (cols <= 1) return null; t.rows.forEach((row) => row.splice(c, 1)); t.align.splice(c, 1); return { r, c: Math.max(0, Math.min(c, cols - 2)) };
    case 'col-left': if (c === 0) return null; swapCols(c - 1, c); return { r, c: c - 1 };
    case 'col-right': if (c >= cols - 1) return null; swapCols(c + 1, c); return { r, c: c + 1 };
    case 'align-left': case 'align-center': case 'align-right': {
      const a = op.slice(6);
      t.align[c] = t.align[c] === a ? '' : a;
      return { r, c };
    }
    case 'format': return { r, c };
  }
  return null;
}

// ---------- estado: tabla que se muestra como Markdown y foco del editor ----------
const setRaw = StateEffect.define();
const rawField = StateField.define({
  create: () => -1,
  update(v, tr) {
    if (v >= 0 && tr.docChanged) v = tr.changes.mapPos(v, 1);
    for (const e of tr.effects) if (e.is(setRaw)) v = e.value;
    return v;
  },
});
const setFocus = StateEffect.define();
const focusField = StateField.define({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) v = e.value; return v; },
});

// ---------- edición de celdas ----------
let editing = null; // { view, wrap, cell }
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TOOLS = [
  ['row-above', 'Añadir fila arriba', '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M12 3v6M9 6h6"/>'],
  ['row-below', 'Añadir fila debajo', '<rect x="3" y="4" width="18" height="7" rx="1.5"/><path d="M12 15v6M9 18h6"/>'],
  ['col-before', 'Añadir columna a la izquierda', '<rect x="13" y="3" width="7" height="18" rx="1.5"/><path d="M3 12h6M6 9v6"/>'],
  ['col-after', 'Añadir columna a la derecha', '<rect x="4" y="3" width="7" height="18" rx="1.5"/><path d="M15 12h6M18 9v6"/>'],
  '|',
  ['align-left', 'Alinear a la izquierda', '<path d="M4 6h16M4 12h10M4 18h13"/>'],
  ['align-center', 'Centrar', '<path d="M4 6h16M7 12h10M5.5 18h13"/>'],
  ['align-right', 'Alinear a la derecha', '<path d="M4 6h16M10 12h10M7 18h13"/>'],
  '|',
  ['row-delete', 'Eliminar fila', '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M9 6h6"/>'],
  ['col-delete', 'Eliminar columna', '<rect x="13" y="3" width="7" height="18" rx="1.5"/><path d="M3 12h6"/>'],
  '|',
  ['source', 'Ver el Markdown de la tabla', '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/>'],
  ['delete', 'Eliminar tabla', '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5a2 2 0 0 0 2 1.5h7a2 2 0 0 0 2-1.5l1-12.5M9 7V4.5h6V7"/>'],
];

const shownText = (raw) => raw.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, ' ');
const readCell = (cell) => cell.textContent.replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').trim();
const toSource = (shown) => shown.replace(/\\?\|/g, '\\|');
const cellAt = (wrap, r, c) => wrap.querySelector(`[data-r="${r}"][data-c="${c}"]`);
const findWrap = (view, from) => [...view.contentDOM.querySelectorAll('.cm-table-wrap')].find((w) => w._from === from);

function restoreCell(cell) {
  cell.removeAttribute('contenteditable');
  cell.classList.remove('is-editing');
  cell.innerHTML = inlineMarkdown(cell._raw);
}

function beginCell(view, wrap, cell, selectAll = false) {
  if (!cell || view.state.readOnly) return;
  if (editing && editing.cell === cell) return;
  editing = { view, wrap, cell };
  wrap.classList.add('is-active');
  cell.classList.add('is-editing');
  cell.contentEditable = 'plaintext-only';
  cell.textContent = cell._shown;
  cell.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(cell);
  if (!selectAll) range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // El cursor del documento acompaña a la celda, para que los menús (Formato → Tabla) sepan dónde estás.
  const pos = Number(cell.dataset.pos);
  const main = view.state.selection.main;
  if (!main.empty || main.head !== pos) view.dispatch({ selection: { anchor: pos } });
}

// Termina la edición de la celda. nav indica qué sigue:
//   { kind: 'none' } · { kind: 'cell', r, c } · { kind: 'next' | 'prev' | 'up' | 'down' | 'enter' }
//   { kind: 'op', op } · { kind: 'exit', dir } · { kind: 'source' } · { kind: 'delete' }
function commit(nav = { kind: 'none' }, defer = false) {
  const ed = editing;
  if (!ed) return;
  editing = null;
  const { view, wrap, cell } = ed;
  wrap.classList.remove('is-active');
  const from = wrap._from, oldText = wrap._text;
  const shown = readCell(cell);
  const changed = shown !== cell._shown;
  const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
  const fresh = () => view.state.sliceDoc(from, from + oldText.length) === oldText && !view.state.readOnly;
  if (!fresh()) { restoreCell(cell); return; }

  const t = parseTable(oldText, from);
  if (changed) t.rows[r][c] = toSource(shown);
  const rows = t.rows.length, cols = t.align.length;
  let target = null, exit = 0, selectAll = false;
  switch (nav.kind) {
    case 'cell': target = { r: nav.r, c: nav.c }; break;
    case 'next':
      selectAll = true;
      if (c + 1 < cols) target = { r, c: c + 1 };
      else if (r + 1 < rows) target = { r: r + 1, c: 0 };
      else { t.rows.push(Array(cols).fill('')); target = { r: r + 1, c: 0 }; }
      break;
    case 'prev':
      selectAll = true;
      target = c > 0 ? { r, c: c - 1 } : r > 0 ? { r: r - 1, c: cols - 1 } : { r, c };
      break;
    case 'enter':
      selectAll = true;
      if (r + 1 >= rows) t.rows.push(Array(cols).fill(''));
      target = { r: r + 1, c };
      break;
    case 'down': if (r + 1 < rows) target = { r: r + 1, c }; else exit = 1; break;
    case 'up': if (r > 0) target = { r: r - 1, c }; else exit = -1; break;
    case 'op': target = applyOp(t, nav.op, { r, c }) || { r, c }; break;
    case 'exit': exit = nav.dir; break;
  }

  const out = serializeTable(t);
  const structural = t.rows.length !== rows || nav.kind === 'op';
  const newText = changed || structural ? out.text : oldText;
  const changes = newText !== oldText ? [{ from, to: from + oldText.length, insert: newText }] : [];
  const cellPos = (cl) => (newText === oldText ? t.pos[cl.r][cl.c] : from + out.offsetOf(cl));

  if (nav.kind === 'delete') {
    const end = Math.min(view.state.doc.length, from + oldText.length + 1);
    view.dispatch({ changes: { from, to: end }, selection: { anchor: from }, userEvent: 'delete' });
    view.focus();
    return;
  }
  if (nav.kind === 'source') {
    view.dispatch({ changes, selection: { anchor: cellPos({ r, c }) }, effects: setRaw.of(from) });
    view.focus();
    return;
  }
  if (exit) {
    const docLen = view.state.doc.length, oldTo = from + oldText.length;
    let anchor;
    if (exit > 0) {
      if (oldTo >= docLen) changes.push({ from: oldTo, insert: '\n' });
      anchor = from + newText.length + 1;
    } else if (from === 0) { changes.unshift({ from: 0, insert: '\n' }); anchor = 0; }
    else anchor = from - 1;
    view.dispatch({ changes, selection: { anchor }, scrollIntoView: true });
    view.focus();
    return;
  }
  if (target) {
    if (changes.length) {
      view.dispatch({ changes, selection: { anchor: cellPos(target) }, userEvent: 'input' });
      const w = findWrap(view, from);
      if (w) beginCell(view, w, cellAt(w, target.r, target.c), selectAll);
    } else {
      restoreCell(cell);
      beginCell(view, wrap, cellAt(wrap, target.r, target.c), selectAll);
    }
    return;
  }
  // Sin destino (se perdió el foco): solo guarda el cambio.
  if (!changes.length) { restoreCell(cell); return; }
  const send = () => {
    if (!fresh()) return;
    const head = view.state.selection.main.head;
    const inside = head >= from && head <= from + oldText.length;
    view.dispatch({ changes, selection: inside ? { anchor: cellPos({ r, c }) } : undefined, userEvent: 'input' });
  };
  if (defer) setTimeout(send, 0); else send();
}

// Guarda la celda que se esté editando (antes de cambiar de nota o cerrar la app).
export function flushTableEdit() { if (editing) commit(); }
export const isEditingCell = () => !!editing;

// Aplica formato en línea (negrita, cursiva…) al texto seleccionado dentro de la celda.
const CELL_MARKS = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], highlight: ['==', '=='], code: ['`', '`'], underline: ['<u>', '</u>'] };
export function cellFormat(id) {
  if (!editing || !CELL_MARKS[id]) return false;
  const [a, b] = CELL_MARKS[id];
  const sel = window.getSelection();
  if (!sel.rangeCount || !editing.cell.contains(sel.anchorNode)) return false;
  const text = sel.toString();
  document.execCommand('insertText', false, a + text + b);
  if (!text) for (let i = 0; i < b.length; i++) sel.modify('move', 'backward', 'character');
  return true;
}

function caretOffsets(cell) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return null;
  const pre = document.createRange();
  pre.selectNodeContents(cell);
  pre.setEnd(sel.focusNode, sel.focusOffset);
  return { at: pre.toString().length, len: cell.textContent.length };
}

function onCellKey(e) {
  if (!editing || e.isComposing) return;
  const { view, cell } = editing;
  const mod = e.metaKey || e.ctrlKey;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Tab') { stop(); commit({ kind: e.shiftKey ? 'prev' : 'next' }); }
  else if (e.key === 'Enter') { stop(); commit({ kind: 'enter' }); }
  else if (e.key === 'Escape') { stop(); commit({ kind: 'exit', dir: 1 }); }
  else if (e.key === 'ArrowDown' && !mod && !e.shiftKey) { stop(); commit({ kind: 'down' }); }
  else if (e.key === 'ArrowUp' && !mod && !e.shiftKey) { stop(); commit({ kind: 'up' }); }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !mod && !e.shiftKey && !e.altKey) {
    const o = caretOffsets(cell);
    if (o && e.key === 'ArrowLeft' && o.at === 0 && (cell.dataset.r !== '0' || cell.dataset.c !== '0')) { stop(); commit({ kind: 'prev' }); }
    else if (o && e.key === 'ArrowRight' && o.at === o.len) {
      const wrap = editing.wrap;
      const last = !cellAt(wrap, Number(cell.dataset.r), Number(cell.dataset.c) + 1) && !cellAt(wrap, Number(cell.dataset.r) + 1, 0);
      if (!last) { stop(); commit({ kind: 'next' }); }
    }
  } else if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !e.shiftKey && readCell(cell) === cell._shown) {
    stop(); commit(); view.focus(); undo(view);
  } else if (mod && !e.altKey) {
    const id = { b: 'bold', i: 'italic', e: 'code', u: 'underline' }[e.key.toLowerCase()] || (e.shiftKey && { x: 'strike', h: 'highlight' }[e.key.toLowerCase()]);
    if (id && cellFormat(id)) stop();
  }
}

class TableWidget extends WidgetType {
  constructor(text, from, opts, readOnly) { super(); this.text = text; this.from = from; this.opts = opts; this.readOnly = readOnly; }
  eq(o) { return o.text === this.text && o.from === this.from && o.readOnly === this.readOnly; }
  toDOM(view) {
    const t = parseTable(this.text, this.from);
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    wrap._from = this.from;
    wrap._text = this.text;
    const scroll = document.createElement('div');
    scroll.className = 'cm-table-scroll';
    const table = document.createElement('table');
    t.rows.forEach((cells, r) => {
      const tr = document.createElement('tr');
      cells.forEach((text, c) => {
        const cell = document.createElement(r === 0 ? 'th' : 'td');
        cell._raw = text;
        cell._shown = shownText(text);
        cell.innerHTML = inlineMarkdown(text);
        cell.dataset.r = r; cell.dataset.c = c; cell.dataset.pos = t.pos[r][c];
        cell.spellcheck = true;
        if (t.align[c]) cell.style.textAlign = t.align[c];
        tr.appendChild(cell);
      });
      (r === 0 ? table.createTHead() : table.tBodies[0] || table.createTBody()).appendChild(tr);
    });
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    if (!this.readOnly) {
      const tools = document.createElement('div');
      tools.className = 'cm-table-tools';
      tools.innerHTML = TOOLS.map((it) => (it === '|' ? '<i></i>' : `<button type="button" data-op="${it[0]}" title="${it[1]}">${SVG(it[2])}</button>`)).join('');
      wrap.appendChild(tools);
    }

    wrap.addEventListener('mousedown', (e) => {
      const tool = e.target.closest('[data-op]');
      if (tool) {
        e.preventDefault();
        if (!editing || editing.wrap !== wrap) return;
        const op = tool.dataset.op;
        commit(op === 'source' || op === 'delete' ? { kind: op } : { kind: 'op', op });
        return;
      }
      const cell = e.target.closest('th, td');
      if (cell && cell.classList.contains('is-editing')) return; // colocar el cursor dentro de la celda
      e.preventDefault();
      const link = e.target.closest('[data-url]'), wiki = e.target.closest('[data-wikilink]');
      if (link) return this.opts.openUrl(link.dataset.url);
      if (wiki) return this.opts.openWikilink(wiki.dataset.wikilink);
      if (!cell || this.readOnly) return;
      if (editing && editing.wrap === wrap) commit({ kind: 'cell', r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
      else { if (editing) commit(); beginCell(view, wrap, cell); }
    });
    wrap.addEventListener('keydown', onCellKey);
    wrap.addEventListener('focusout', (e) => {
      if (editing && editing.cell === e.target && !wrap.contains(e.relatedTarget)) commit();
    });
    wrap.addEventListener('paste', (e) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
      document.execCommand('insertText', false, text);
    });
    return wrap;
  }
  destroy(dom) { if (editing && editing.wrap === dom) commit({ kind: 'none' }, true); }
  ignoreEvent() { return true; }
}

class RawBarWidget extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const el = document.createElement('span');
    el.className = 'cm-table-rawbar';
    el.textContent = 'Ver como tabla';
    el.title = 'Volver a mostrar la tabla';
    el.addEventListener('mousedown', (e) => { e.preventDefault(); view.dispatch({ effects: setRaw.of(-1) }); view.focus(); });
    return el;
  }
  ignoreEvent() { return true; }
}

class MathBlockWidget extends WidgetType {
  constructor(tex, from) { super(); this.tex = tex; this.from = from; }
  eq(o) { return o.tex === this.tex && o.from === this.from; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-math-block';
    el.innerHTML = renderMath(this.tex, true);
    el.addEventListener('mousedown', (e) => { e.preventDefault(); view.dispatch({ selection: { anchor: this.from + 2 } }); view.focus(); });
    return el;
  }
  ignoreEvent() { return true; }
}

// ---------- decoraciones ----------
const touches = (state, from, to) => state.selection.ranges.some((r) => r.to >= from && r.from <= to);
// Una selección (no vacía) que termina dentro de la tabla, p. ej. un resultado de búsqueda: se muestra el Markdown.
const selectsInside = (state, from, to) => state.selection.ranges.some((r) => !r.empty && ((r.from > from && r.from < to) || (r.to > from && r.to < to)));

function findBlocks(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) || syntaxTree(state);
  const blocks = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'Table') return;
      const { from, to } = rangeOf(state, node);
      blocks.push({ type: 'table', from, to, top: isTopLevel(node.node) });
      return false;
    },
  });
  const text = state.doc.toString();
  for (const m of text.matchAll(/^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*$/gm)) blocks.push({ type: 'math', from: m.index, to: m.index + m[0].length, tex: m[1] });
  return blocks;
}

function isOpen(state, b) {
  if (b.type === 'math') return state.field(focusField, false) && touches(state, b.from, b.to);
  if (!b.top) return true;
  const raw = state.field(rawField, false);
  return (raw >= b.from && raw <= b.to && touches(state, b.from, b.to)) || selectsInside(state, b.from, b.to);
}

function decorate(state, blocks, opts) {
  const decos = [];
  const rawLines = (b, cls) => {
    for (let pos = b.from; pos <= b.to;) { const line = state.doc.lineAt(pos); decos.push(Decoration.line({ class: cls }).range(line.from)); pos = line.to + 1; }
  };
  for (const b of blocks) {
    const open = isOpen(state, b);
    if (b.type === 'math') {
      if (open) rawLines(b, 'cm-math-raw');
      else decos.push(Decoration.replace({ widget: new MathBlockWidget(b.tex, b.from), block: true }).range(b.from, b.to));
    } else if (open) {
      rawLines(b, 'cm-table-raw');
      const raw = state.field(rawField, false);
      if (b.top && raw >= b.from && raw <= b.to) decos.push(Decoration.widget({ widget: new RawBarWidget(), side: 1 }).range(state.doc.lineAt(b.from).to));
    } else {
      decos.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(b.from, b.to), b.from, opts, state.readOnly), block: true }).range(b.from, b.to));
    }
  }
  return Decoration.set(decos, true);
}

const signature = (state, blocks) => blocks.map((b) => (isOpen(state, b) ? '1' : '0')).join('') + (state.readOnly ? 'r' : '') + state.field(rawField, false);

// ---------- teclado (solo cuando la tabla se ve como Markdown) ----------
const rawTableAt = (state, pos) => {
  const node = tableAt(state, pos);
  if (!node) return null;
  const { from, to } = rangeOf(state, node);
  const raw = state.field(rawField, false);
  return !isTopLevel(node) || (raw >= from && raw <= to) ? node : null;
};

function moveCell(dir) {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const table = rawTableAt(state, head);
    if (!table) return false;
    const first = state.doc.lineAt(table.from).number, last = state.doc.lineAt(rangeOf(state, table).to).number;
    let line = state.doc.lineAt(head);
    let cells = cellsOfLine(line);
    let idx = cells.findIndex((c) => head >= c.start && head <= c.end);
    if (idx < 0) idx = dir > 0 ? -1 : cells.length;
    let target = cells[idx + dir];
    let n = line.number;
    while (!target) {
      n += dir;
      if (n < first) return true;
      if (n > last) {
        const cols = cellsOfLine(state.doc.line(first)).length;
        const row = '\n|' + '   |'.repeat(cols);
        view.dispatch({ changes: { from: state.doc.line(last).to, insert: row }, selection: { anchor: state.doc.line(last).to + 3 } });
        return true;
      }
      line = state.doc.line(n);
      if (isDelimiter(line.text)) continue;
      cells = cellsOfLine(line);
      target = dir > 0 ? cells[0] : cells[cells.length - 1];
    }
    view.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true });
    return true;
  };
}

function enterInTable(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const table = rawTableAt(state, sel.head);
  if (!table) return false;
  const line = state.doc.lineAt(sel.head);
  if (isDelimiter(line.text)) return false;
  const cells = cellsOfLine(line);
  const isHeader = line.number === state.doc.lineAt(table.from).number;
  if (!isHeader && cells.every((c) => !c.text)) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } });
    return true;
  }
  let at = line;
  if (isHeader) at = state.doc.line(line.number + 1);
  const row = '\n|' + '   |'.repeat(cells.length);
  view.dispatch({ changes: { from: at.to, insert: row }, selection: { anchor: at.to + 3 }, scrollIntoView: true });
  return true;
}

// Borrar hacia atrás justo debajo de una tabla (o Suprimir justo arriba) entra a la tabla en vez de romperla.
function stepInto(dir) {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const line = state.doc.lineAt(sel.head);
    const edge = dir < 0 ? sel.head === line.from && line.number > 1 : sel.head === line.to && line.number < state.doc.lines;
    if (!edge) return false;
    const pos = sel.head + dir;
    const node = tableAt(state, pos);
    if (!node || !isTopLevel(node) || rawTableAt(state, pos)) return false;
    view.dispatch({ selection: { anchor: pos }, userEvent: 'select' });
    return true;
  };
}

// Flecha arriba/abajo desde la línea pegada a una tabla: entra a la tabla (el editor, por sí solo, la saltaría).
function arrowInto(dir) {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.readOnly) return false;
    const line = state.doc.lineAt(sel.head);
    const n = line.number + dir;
    if (n < 1 || n > state.doc.lines || tableAt(state, sel.head)) return false;
    const target = state.doc.line(n);
    const node = target.text.trim() ? tableAt(state, target.from) : null;
    if (!node || !isTopLevel(node) || rawTableAt(state, target.from)) return false;
    const moved = view.moveVertically(sel, dir > 0);
    if (moved.head !== sel.head && moved.head >= line.from && moved.head <= line.to) return false; // quedan renglones del mismo párrafo
    view.dispatch({ selection: { anchor: dir > 0 ? target.from : target.from + 1 }, userEvent: 'select' });
    return true;
  };
}

// Si el cursor del editor cae dentro de una tabla, se pasa a editar esa celda.
function enterCellAtSelection(view) {
  if (editing || !view.hasFocus || view.state.readOnly) return;
  const { state } = view;
  const raw = state.field(rawField, false);
  if (raw >= 0) {
    // Al salir de una tabla que se veía como Markdown, vuelve a mostrarse como tabla.
    const rawNode = tableAt(state, Math.min(raw, state.doc.length));
    if (!rawNode || !touches(state, rangeOf(state, rawNode).from, rangeOf(state, rawNode).to)) view.dispatch({ effects: setRaw.of(-1) });
    return;
  }
  const sel = state.selection.main;
  const node = sel.empty ? tableAt(state, sel.head) : null;
  if (!node || !isTopLevel(node)) return;
  const { from, to } = rangeOf(state, node);
  const wrap = findWrap(view, from);
  if (!wrap) return;
  const firstNo = state.doc.lineAt(from).number;
  const line = state.doc.lineAt(sel.head);
  const offset = line.number - firstNo;
  const hasDelim = state.doc.lines > firstNo && isDelimiter(state.doc.line(firstNo + 1).text);
  let r = hasDelim ? (offset <= 0 ? 0 : Math.max(1, offset - 1)) : offset;
  const cells = cellsOfLine(offset === 1 && hasDelim && line.number < state.doc.lineAt(to).number ? state.doc.line(line.number + 1) : line);
  let c = cells.findIndex((x) => sel.head >= x.start && sel.head <= x.end);
  if (c < 0) c = sel.head <= line.from + 1 ? 0 : Math.max(0, cells.length - 1);
  let cell = cellAt(wrap, r, c);
  while (!cell && r > 0) cell = cellAt(wrap, --r, c);
  beginCell(view, wrap, cell || cellAt(wrap, 0, 0));
}

export function tablePreview(opts) {
  const field = StateField.define({
    create: (state) => { const blocks = findBlocks(state); return { blocks, sig: signature(state, blocks), deco: decorate(state, blocks, opts) }; },
    update(value, tr) {
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (!tr.docChanged && !treeChanged && !tr.selection && !tr.effects.length && tr.startState.readOnly === tr.state.readOnly) return value;
      const blocks = tr.docChanged || treeChanged ? findBlocks(tr.state) : value.blocks;
      const sig = signature(tr.state, blocks);
      if (blocks === value.blocks && sig === value.sig) return value;
      return { blocks, sig, deco: decorate(tr.state, blocks, opts) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  let queued = false;
  return [
    rawField,
    focusField,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
    field,
    EditorView.updateListener.of((u) => {
      if (queued || !(u.selectionSet || u.focusChanged || u.docChanged)) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; enterCellAtSelection(u.view); });
    }),
    // Escribir en la línea en blanco pegada a una tabla la convertiría en una fila más: se deja una línea de separación.
    EditorView.inputHandler.of((view, from, to, text) => {
      if (from !== to || !text.trim() || text.includes('\n')) return false;
      const { state } = view;
      const line = state.doc.lineAt(from);
      if (line.text.trim() || line.number === 1) return false;
      const prev = state.doc.line(line.number - 1);
      const node = prev.text.trim() ? tableAt(state, prev.from) : null;
      if (!node || !isTopLevel(node)) return false;
      view.dispatch({ changes: { from, insert: '\n' + text }, selection: { anchor: from + 1 + text.length }, userEvent: 'input.type', scrollIntoView: true });
      return true;
    }),
    Prec.high(keymap.of([
      { key: 'Tab', run: moveCell(1) },
      { key: 'Shift-Tab', run: moveCell(-1) },
      { key: 'Enter', run: enterInTable },
      { key: 'ArrowDown', run: arrowInto(1) },
      { key: 'ArrowUp', run: arrowInto(-1) },
      { key: 'Backspace', run: stepInto(-1) },
      { key: 'Delete', run: stepInto(1) },
    ])),
  ];
}

export function tableTemplate(rows, cols) {
  const head = '|' + Array.from({ length: cols }, (_, i) => ` Columna ${i + 1} |`).join('');
  const sep = '|' + ' --- |'.repeat(cols);
  const body = Array.from({ length: Math.max(rows - 1, 1) }, () => '|' + '   |'.repeat(cols)).join('\n');
  return `${head}\n${sep}\n${body}`;
}

// ---------- operaciones de tabla desde los menús (Formato → Tabla) ----------
export function tableOp(op) {
  return (view) => {
    if (editing) commit();
    const { state } = view;
    const pos = state.selection.main.head;
    const node = tableAt(state, pos);
    if (!node) return false;
    const { from, to } = rangeOf(state, node);
    const t = parseTable(state.doc.sliceString(from, to), from);
    // celda actual
    let cur = { r: 0, c: 0 };
    const firstNo = state.doc.lineAt(from).number;
    const line = state.doc.lineAt(pos);
    const offset = line.number - firstNo;
    if (offset >= 1) cur.r = Math.max(1, Math.min(t.rows.length - 1, offset - 1));
    const ci = cellsOfLine(line).findIndex((x) => pos >= x.start && pos <= x.end);
    cur.c = Math.max(0, Math.min(t.align.length - 1, ci));
    const target = applyOp(t, op, cur);
    if (!target) return true;
    const out = serializeTable(t);
    view.dispatch({ changes: { from, to, insert: out.text }, selection: { anchor: from + out.offsetOf(target) }, userEvent: 'input' });
    return true;
  };
}

export const inTable = (state) => !!tableAt(state, state.selection.main.head);
