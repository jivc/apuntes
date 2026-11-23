// Comandos de formato que usan los atajos, la barra flotante, el menú "Aa" y los menús de la app.
import { EditorSelection } from '@codemirror/state';
import { toggleTaskAt } from './livepreview.js';
import { tableTemplate, tableOp } from './tables.js';

export function wrap(marker) {
  return (v) => {
    v.dispatch(v.state.changeByRange((range) => {
      const text = v.state.sliceDoc(range.from, range.to);
      const before = v.state.sliceDoc(range.from - marker.length, range.from);
      const after = v.state.sliceDoc(range.to, range.to + marker.length);
      if (before === marker && after === marker) {
        return {
          changes: [{ from: range.from - marker.length, to: range.from }, { from: range.to, to: range.to + marker.length }],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
        };
      }
      if (text.startsWith(marker) && text.endsWith(marker) && text.length >= marker.length * 2) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(marker.length, -marker.length) },
          range: EditorSelection.range(range.from, range.to - marker.length * 2),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: marker + text + marker },
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    }));
    return true;
  };
}

// Envuelve con etiquetas distintas al abrir y cerrar (p. ej. <u>…</u>)
export function wrapTags(open, close) {
  return (v) => {
    v.dispatch(v.state.changeByRange((range) => {
      const before = v.state.sliceDoc(range.from - open.length, range.from);
      const after = v.state.sliceDoc(range.to, range.to + close.length);
      if (before === open && after === close) {
        return { changes: [{ from: range.from - open.length, to: range.from }, { from: range.to, to: range.to + close.length }], range: EditorSelection.range(range.from - open.length, range.to - open.length) };
      }
      const text = v.state.sliceDoc(range.from, range.to);
      return { changes: { from: range.from, to: range.to, insert: open + text + close }, range: EditorSelection.range(range.from + open.length, range.to + open.length) };
    }));
    return true;
  };
}

function transformSelection(fn) {
  return (v) => {
    if (v.state.selection.ranges.every((r) => r.empty)) return false;
    v.dispatch(v.state.changeByRange((range) => {
      const out = fn(v.state.sliceDoc(range.from, range.to));
      return { changes: { from: range.from, to: range.to, insert: out }, range: EditorSelection.range(range.from, range.from + out.length) };
    }));
    return true;
  };
}
const titleCase = (s) => s.toLocaleLowerCase('es').replace(/(^|[\s(¿¡"'«-])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase('es'));

function insertText(fn) {
  return (v) => {
    const text = fn();
    v.dispatch(v.state.replaceSelection(text));
    return true;
  };
}
const pad2 = (n) => String(n).padStart(2, '0');
const DATES = {
  'date-long': () => new Intl.DateTimeFormat('es', { dateStyle: 'long' }).format(new Date()),
  'date-short': () => new Intl.DateTimeFormat('es', { dateStyle: 'short' }).format(new Date()),
  'date-iso': () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; },
  'datetime': () => new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()),
  'datetime-iso': () => { const d = new Date(); return `${DATES['date-iso']()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; },
  'time': () => new Intl.DateTimeFormat('es', { timeStyle: 'short' }).format(new Date()),
};

// Inserta [^n] en el cursor y su definición al final de la nota; deja el cursor en la definición.
export function footnote(v) {
  const doc = v.state.doc.toString();
  const used = [...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const pos = v.state.selection.main.head;
  const tail = doc.endsWith('\n') ? '' : '\n';
  const defBlock = (/\n\[\^\d+\]:[^\n]*\n?$/.test(doc) ? '' : '\n') + `${tail}[^${n}]: `;
  const ref = `[^${n}]`;
  v.dispatch({
    changes: [{ from: pos, insert: ref }, { from: doc.length, insert: defBlock }],
    selection: { anchor: doc.length + ref.length + defBlock.length },
    scrollIntoView: true,
  });
  return true;
}

// Mueve las tareas completadas al final de la lista donde está el cursor.
export function sortTasks(v) {
  const { doc } = v.state;
  const here = doc.lineAt(v.state.selection.main.head).number;
  const isTask = (t) => /^\s*[-*+] \[[ xX]\]/.test(t);
  if (!isTask(doc.line(here).text)) return false;
  let a = here, b = here;
  while (a > 1 && isTask(doc.line(a - 1).text)) a--;
  while (b < doc.lines && isTask(doc.line(b + 1).text)) b++;
  const lines = [];
  for (let i = a; i <= b; i++) lines.push(doc.line(i).text);
  const sorted = [...lines.filter((l) => /\[ \]/.test(l)), ...lines.filter((l) => /\[[xX]\]/.test(l))];
  v.dispatch({ changes: { from: doc.line(a).from, to: doc.line(b).to, insert: sorted.join('\n') } });
  return true;
}

export const callout = (type) => (v) => {
  const sel = v.state.selection.main;
  const text = v.state.sliceDoc(sel.from, sel.to);
  const body = text ? text.split('\n').map((l) => '> ' + l).join('\n') : '> ';
  return insertBlock(`> [!${type.toUpperCase()}]\n${body}`)(v);
};

export function mathBlock(v) {
  const sel = v.state.selection.main;
  const text = v.state.sliceDoc(sel.from, sel.to);
  if (text && !text.includes('\n')) { v.dispatch({ changes: { from: sel.from, to: sel.to, insert: `$${text}$` } }); return true; }
  return insertBlock(`$$\n${text || ''}\n$$`, 3, text.length)(v);
}

export function insertLink(v) {
  const { from, to } = v.state.selection.main;
  const text = v.state.sliceDoc(from, to);
  if (/^https?:\/\/\S+$/.test(text)) {
    v.dispatch({ changes: { from, to, insert: `[enlace](${text})` }, selection: { anchor: from + 1, head: from + 7 } });
  } else {
    const label = text || 'texto';
    v.dispatch({ changes: { from, to, insert: `[${label}](https://)` }, selection: { anchor: from + label.length + 3, head: from + label.length + 11 } });
  }
  return true;
}

const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
function kindOf(prefix) {
  if (!prefix) return null;
  if (prefix.startsWith('#')) return 'h' + prefix.trim().length;
  if (prefix.startsWith('>')) return 'quote';
  if (/\[[ xX]\]/.test(prefix)) return 'task';
  if (/^\d/.test(prefix)) return 'number';
  return 'bullet';
}

function selectedLines(state) {
  const seen = new Set(), lines = [];
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) { seen.add(line.number); lines.push(line); }
      pos = line.to + 1;
    }
  }
  return lines;
}

// Aplica o quita un prefijo de bloque (título, lista, tarea, cita) a las líneas seleccionadas.
export function block(kind) {
  return (v) => {
    const lines = selectedLines(v.state);
    const parsed = lines.map((l) => { const m = PREFIX.exec(l.text); return { line: l, indent: m[1], prefix: m[2] || '', kind: kindOf(m[2]) }; });
    const remove = kind === 'paragraph' || parsed.every((p) => p.kind === kind);
    let n = 0;
    const changes = parsed.map((p) => {
      const from = p.line.from + p.indent.length, to = from + p.prefix.length;
      let insert = '';
      if (!remove) {
        if (kind === 'bullet') insert = '- ';
        else if (kind === 'task') insert = '- [ ] ';
        else if (kind === 'quote') insert = '> ';
        else if (kind === 'number') insert = `${++n}. `;
        else if (kind.startsWith('h')) insert = '#'.repeat(Number(kind.slice(1))) + ' ';
      }
      return { from, to, insert };
    });
    v.dispatch({ changes });
    return true;
  };
}

export function toggleTaskLine(v) {
  const line = v.state.doc.lineAt(v.state.selection.main.head);
  const m = /^(\s*)([-*+] )?(\[[ xX]\] )?/.exec(line.text);
  if (m[3]) return toggleTaskAt(v, line.from + m[1].length + (m[2] || '').length);
  return block('task')(v);
}

export function insertBlock(text, cursorOffset = null, selectLen = 0) {
  return (v) => {
    const { state } = v;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const blank = !line.text.trim();
    const at = blank ? line.from : line.to;
    const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
    const before = blank ? (prev && prev.text.trim() ? '\n' : '') : '\n\n';
    const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    const after = nextLine && nextLine.text.trim() ? '\n\n' : '\n';
    const insert = before + text + after;
    const anchor = at + before.length + (cursorOffset ?? text.length);
    v.dispatch({ changes: { from: at, to: blank ? line.to : at, insert }, selection: { anchor, head: anchor + selectLen }, scrollIntoView: true });
    return true;
  };
}

export function codeBlock(v) {
  const sel = v.state.selection.main;
  if (sel.empty) return insertBlock('```\n\n```', 4)(v);
  const a = v.state.doc.lineAt(sel.from), b = v.state.doc.lineAt(sel.to);
  v.dispatch({ changes: [{ from: a.from, insert: '```\n' }, { from: b.to, insert: '\n```' }], selection: { anchor: a.from + 4 } });
  return true;
}

// Bloque de plantilla de correo: es un bloque de código ```correo con Para/CC/CCO/Asunto y el mensaje.
export function mailBlockText(mail) {
  const head = [`Para: ${mail.to || ''}`];
  if (mail.cc) head.push(`CC: ${mail.cc}`);
  if (mail.bcc) head.push(`CCO: ${mail.bcc}`);
  head.push(`Asunto: ${mail.subject || ''}`);
  const body = (mail.body || '').replace(/\s+$/, '');
  const fence = /^```/m.test(body) ? '~~~' : '```';
  return `${fence}correo\n${head.join('\n')}\n\n${body}\n${fence}`;
}

export const divider = insertBlock('---');
export const insertTable = (rows, cols) => insertBlock(tableTemplate(rows, cols), 2, 'Columna 1'.length);

export const COMMANDS = {
  bold: wrap('**'),
  italic: wrap('*'),
  strike: wrap('~~'),
  highlight: wrap('=='),
  code: wrap('`'),
  link: insertLink,
  h1: block('h1'),
  h2: block('h2'),
  h3: block('h3'),
  paragraph: block('paragraph'),
  bullet: block('bullet'),
  number: block('number'),
  task: toggleTaskLine,
  quote: block('quote'),
  codeblock: codeBlock,
  divider,
  table: insertTable(3, 3),
  underline: wrapTags('<u>', '</u>'),
  h4: block('h4'),
  h5: block('h5'),
  h6: block('h6'),
  upper: transformSelection((s) => s.toLocaleUpperCase('es')),
  lower: transformSelection((s) => s.toLocaleLowerCase('es')),
  titlecase: transformSelection(titleCase),
  footnote,
  sorttasks: sortTasks,
  math: mathBlock,
  'callout-note': callout('note'),
  'callout-tip': callout('tip'),
  'callout-important': callout('important'),
  'callout-warning': callout('warning'),
  'callout-caution': callout('caution'),
  ...Object.fromEntries(Object.entries(DATES).map(([k, fn]) => [k, insertText(fn)])),
  ...Object.fromEntries(['row-below', 'row-above', 'row-delete', 'row-up', 'row-down', 'col-after', 'col-before', 'col-delete', 'col-left', 'col-right', 'align-left', 'align-center', 'align-right', 'format'].map((k) => ['table-' + k, tableOp(k)])),
};
