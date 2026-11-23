// Vista previa en vivo: oculta las marcas de Markdown fuera de la línea que se está editando.
import { ViewPlugin, Decoration, WidgetType, EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { syntaxTree, foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
import katex from 'katex';

export const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;
const WIKILINK_RE = /\[\[([^[\]\n]+?)\]\]/g;
const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const hide = Decoration.replace({});
const CHEVRON_SVG = '<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Avisos estilo GitHub/Obsidian/Bear: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
export const CALLOUTS = {
  note: ['note', 'ℹ️', 'Nota'], info: ['note', 'ℹ️', 'Información'], tip: ['tip', '💡', 'Consejo'], hint: ['tip', '💡', 'Consejo'],
  success: ['tip', '✅', 'Hecho'], important: ['important', '❗', 'Importante'], warning: ['warning', '⚠️', 'Advertencia'],
  attention: ['warning', '⚠️', 'Atención'], caution: ['caution', '⛔', 'Precaución'], danger: ['caution', '⛔', 'Peligro'],
  error: ['caution', '⛔', 'Error'], question: ['important', '❓', 'Pregunta'], quote: ['note', '❝', 'Cita'],
};

export function renderMath(tex, display) {
  try { return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' }); }
  catch { return tex; }
}

class FoldWidget extends WidgetType {
  constructor(folded) { super(); this.folded = folded; }
  eq(o) { return o.folded === this.folded; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-fold-toggle' + (this.folded ? ' is-folded' : '');
    el.title = this.folded ? 'Desplegar sección' : 'Plegar sección';
    el.innerHTML = CHEVRON_SVG;
    return el;
  }
  ignoreEvent() { return false; }
}

// Lenguajes que se ofrecen en el selector de los bloques de código ([id para el Markdown, nombre visible]).
export const CODE_LANGS = [
  ['', 'Texto simple'], ['bash', 'Bash / Terminal'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'], ['go', 'Go'],
  ['html', 'HTML'], ['java', 'Java'], ['javascript', 'JavaScript'], ['json', 'JSON'], ['latex', 'LaTeX'], ['markdown', 'Markdown'],
  ['php', 'PHP'], ['python', 'Python'], ['r', 'R'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['sas', 'SAS'], ['sql', 'SQL'], ['swift', 'Swift'],
  ['typescript', 'TypeScript'], ['xml', 'XML'], ['yaml', 'YAML'],
];
const LANG_ALIASES = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', tex: 'latex', md: 'markdown', rb: 'ruby', rs: 'rust' };
export function langLabel(lang) {
  const k = LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase();
  const hit = CODE_LANGS.find(([id]) => id === k);
  return hit ? (k ? hit[1] : 'Texto') : lang;
}
export const MAIL_LANGS = new Set(['correo', 'email', 'mail']);
const MAIL_FIELD = /^(para|to|cc|cco|bcc|asunto|subject)\s*:/i;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})[ \t]*([^\s`]*)/;

// Texto de un bloque ```correo → { to, cc, bcc, subject, body }
export function parseMail(text) {
  const mail = { to: '', cc: '', bcc: '', subject: '', body: '' };
  const keys = { para: 'to', to: 'to', cc: 'cc', cco: 'bcc', bcc: 'bcc', asunto: 'subject', subject: 'subject' };
  const lines = text.split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m || !keys[m[1].toLowerCase()]) break;
    mail[keys[m[1].toLowerCase()]] = m[2].trim();
  }
  mail.body = lines.slice(i).join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  return mail;
}

// Cabecera de un bloque de código: lenguaje (clic para cambiarlo) y «Copiar»; en un bloque de correo, «Enviar».
class CodeHeadWidget extends WidgetType {
  constructor(lang, code, pos, collapsed, mail) { super(); this.lang = lang; this.code = code; this.pos = pos; this.collapsed = collapsed; this.mail = mail; }
  eq(o) { return o.lang === this.lang && o.code === this.code && o.pos === this.pos && o.collapsed === this.collapsed && o.mail === this.mail; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-code-head' + (this.mail ? ' is-mail' : '');
    const left = document.createElement('span');
    if (this.mail) { left.className = 'cm-mail-title'; left.textContent = '✉︎ Correo'; }
    else { left.className = 'cm-code-lang'; left.textContent = langLabel(this.lang); left.title = 'Cambiar el lenguaje'; left.dataset.pos = this.pos; }
    if (!this.collapsed) left.style.visibility = 'hidden';
    el.appendChild(left);
    const right = document.createElement('span');
    right.className = 'cm-code-actions';
    if (this.mail) {
      const send = document.createElement('span');
      send.className = 'cm-mail-send';
      send.textContent = 'Enviar';
      send.title = 'Revisar y abrir en tu aplicación de correo';
      send._code = this.code;
      right.appendChild(send);
    }
    const copy = document.createElement('span');
    copy.className = 'cm-copy-code';
    copy.textContent = 'Copiar';
    copy._code = this.mail ? parseMail(this.code).body : this.code;
    right.appendChild(copy);
    el.appendChild(right);
    return el;
  }
  ignoreEvent() { return false; }
}

class MathWidget extends WidgetType {
  constructor(tex) { super(); this.tex = tex; }
  eq(o) { return o.tex === this.tex; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-math';
    el.innerHTML = renderMath(this.tex, false);
    return el;
  }
}

class CalloutWidget extends WidgetType {
  constructor(type) { super(); this.type = type; }
  eq(o) { return o.type === this.type; }
  toDOM() {
    const [, emoji, label] = CALLOUTS[this.type] || CALLOUTS.note;
    const el = document.createElement('span');
    el.className = 'cm-callout-label';
    el.textContent = `${emoji} ${label}`;
    return el;
  }
}

function headingFold(state, line) {
  let found = null;
  foldedRanges(state).between(line.to, line.to + 1, (from, to) => { if (from === line.to) found = { from, to }; });
  return found;
}

export function toggleFoldAt(view, pos) {
  const line = view.state.doc.lineAt(pos);
  const folded = headingFold(view.state, line);
  if (folded) { view.dispatch({ effects: unfoldEffect.of(folded) }); return true; }
  const range = foldable(view.state, line.from, line.to);
  if (range) { view.dispatch({ effects: foldEffect.of(range) }); return true; }
  return false;
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-checkbox' + (this.checked ? ' is-checked' : '');
    el.dataset.pos = this.pos;
    el.innerHTML = CHECK_SVG;
    return el;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const el = document.createElement('span'); el.className = 'cm-bullet'; return el; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const el = document.createElement('span'); el.className = 'cm-rule'; return el; }
}

class ImageWidget extends WidgetType {
  constructor(src, alt) { super(); this.src = src; this.alt = alt; }
  eq(o) { return o.src === this.src; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.onerror = () => { wrap.classList.add('is-broken'); wrap.textContent = '🖼 ' + (this.alt || this.src); };
    wrap.appendChild(img);
    return wrap;
  }
}

function toFileUrl(p) {
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function resolveSrc(url, baseDir) {
  if (/^(https?:|data:|file:)/i.test(url)) return url;
  let p;
  try { p = decodeURI(url); } catch { p = url; }
  if (!/^([a-z]:)?[\\/]/i.test(p)) p = baseDir + '/' + p;
  return toFileUrl(p);
}

function build(view, opts) {
  const { state } = view;
  const doc = state.doc;
  const active = new Set();
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number, b = doc.lineAt(r.to).number;
      for (let i = a; i <= b; i++) active.add(i);
    }
  }
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const decos = [];
  const codeRanges = [];
  const lineClass = (pos, cls) => decos.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const eachLine = (from, to, fn) => {
    for (let pos = from; pos <= to;) { const line = doc.lineAt(pos); fn(line); pos = line.to + 1; }
  };
  const hideWithSpace = (from, to) => {
    if (doc.sliceString(to, to + 1) === ' ') to++;
    decos.push(hide.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const line = doc.lineAt(node.from);
          lineClass(node.from, `cm-h cm-h${heading[1]}`);
          const folded = !!headingFold(state, line);
          if (folded || foldable(state, line.from, line.to)) decos.push(Decoration.widget({ widget: new FoldWidget(folded), side: -1 }).range(line.from));
          return;
        }
        switch (name) {
          case 'HeaderMark':
            if (node.node.parent && node.node.parent.name.startsWith('ATX') && !isActive(node.from)) hideWithSpace(node.from, node.to);
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to));
            break;
          case 'InlineCode':
            codeRanges.push([node.from, node.to]);
            break;
          case 'CodeMark':
            if (node.node.parent && node.node.parent.name === 'InlineCode' && !isActive(node.from)) decos.push(hide.range(node.from, node.to));
            break;
          case 'FencedCode':
          case 'CodeBlock': {
            codeRanges.push([node.from, node.to]);
            const firstL = doc.lineAt(node.from), lastL = doc.lineAt(node.to);
            const open = name === 'FencedCode' ? FENCE_OPEN.exec(firstL.text) : null;
            if (!open) {
              eachLine(node.from, node.to, (line) => {
                let cls = 'cm-codeblock';
                if (line.number === firstL.number) cls += ' cm-codeblock-first';
                if (line.number === lastL.number) cls += ' cm-codeblock-last';
                decos.push(Decoration.line({ class: cls }).range(line.from));
              });
              break;
            }
            const lang = open[3] || '';
            const mail = MAIL_LANGS.has(lang.toLowerCase());
            const closed = lastL.number > firstL.number && new RegExp('^\\s*' + open[2][0] + '{' + open[2].length + ',}\\s*$').test(lastL.text);
            const body = lastL.number > firstL.number ? doc.sliceString(firstL.to + 1, closed ? Math.max(firstL.to + 1, lastL.from - 1) : node.to) : '';
            // Con el cursor fuera del bloque se ocultan las ``` y queda una cabecera limpia.
            const collapsed = !(view.hasFocus && state.selection.ranges.some((r) => r.from <= lastL.to && r.to >= firstL.from));
            decos.push(Decoration.widget({ widget: new CodeHeadWidget(lang, body, firstL.from, collapsed, mail), side: 1 }).range(firstL.to));
            if (collapsed) {
              if (firstL.to > firstL.from) decos.push(hide.range(firstL.from, firstL.to));
              if (closed && lastL.to > lastL.from) decos.push(hide.range(lastL.from, lastL.to));
            }
            let inHeader = mail;
            eachLine(node.from, node.to, (line) => {
              let cls = 'cm-codeblock' + (mail ? ' cm-mail' : '');
              if (line.number === firstL.number) cls += ' cm-codeblock-first cm-codeblock-fence' + (collapsed ? ' is-collapsed' : '');
              else if (line.number === lastL.number && closed) cls += ' cm-codeblock-fence' + (collapsed ? ' is-collapsed' : '');
              else if (inHeader) {
                const f = MAIL_FIELD.exec(line.text);
                if (f) { cls += ' cm-mail-field'; decos.push(Decoration.mark({ class: 'cm-mail-label' }).range(line.from, line.from + f[0].length)); }
                else inHeader = false;
              }
              if (line.number === lastL.number) cls += ' cm-codeblock-last';
              decos.push(Decoration.line({ class: cls }).range(line.from));
            });
            break;
          }
          case 'Blockquote': {
            const first = doc.lineAt(node.from);
            const m = /^(\s*>\s*)\[!(\w+)\][+-]?\s?/.exec(first.text);
            const type = m && CALLOUTS[m[2].toLowerCase()] ? m[2].toLowerCase() : null;
            const cls = type ? `cm-quote cm-callout cm-callout-${CALLOUTS[type][0]}` : 'cm-quote';
            eachLine(node.from, node.to, (line) => decos.push(Decoration.line({ class: cls + (type && line.number === first.number ? ' cm-callout-first' : '') }).range(line.from)));
            if (type && !active.has(first.number)) decos.push(Decoration.replace({ widget: new CalloutWidget(type) }).range(first.from + m[1].length, first.from + m[0].length));
            break;
          }
          case 'QuoteMark':
            if (!isActive(node.from)) hideWithSpace(node.from, node.to);
            break;
          case 'ListMark': {
            const item = node.node.parent;
            const task = item && item.getChild('Task');
            const isBullet = item && item.parent && item.parent.name === 'BulletList';
            if (task) { if (!isActive(node.from)) decos.push(hide.range(node.from, task.from)); }
            else if (isBullet && !isActive(node.from)) decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            else decos.push(Decoration.mark({ class: 'cm-listmark' }).range(node.from, node.to));
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, end));
            if (checked) lineClass(node.from, 'cm-task-done');
            break;
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            break;
          case 'Image': {
            const url = node.node.getChild('URL');
            if (url && !isActive(node.from)) {
              const raw = doc.sliceString(node.from, node.to);
              const alt = (/^!\[([^\]]*)\]/.exec(raw) || [])[1] || '';
              const src = resolveSrc(doc.sliceString(url.from, url.to), opts.baseDir());
              decos.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to));
            }
            return false;
          }
          case 'Link': {
            const url = node.node.getChild('URL');
            const marks = node.node.getChildren('LinkMark');
            if (url && marks.length >= 2 && marks[1].from > marks[0].to) {
              const href = doc.sliceString(url.from, url.to);
              const rendered = !isActive(node.from);
              if (rendered) decos.push(hide.range(node.from, marks[0].to));
              decos.push(Decoration.mark({ class: 'cm-link' + (rendered ? ' is-rendered' : ''), attributes: { 'data-url': href } }).range(marks[0].to, marks[1].from));
              if (rendered) decos.push(hide.range(marks[1].from, node.to));
            }
            return false;
          }
          case 'URL':
            if (node.node.parent && node.node.parent.name === 'Autolink') break;
            decos.push(Decoration.mark({ class: 'cm-link cm-bare-url', attributes: { 'data-url': doc.sliceString(node.from, node.to) } }).range(node.from, node.to));
            break;
        }
      },
    });

    // Etiquetas y [[enlaces]] (fuera de bloques de código)
    const inCode = (a, b) => codeRanges.some(([f, t]) => a < t && b > f);
    eachLine(from, Math.max(from, to - 1), (line) => {
      const text = line.text;
      for (const m of text.matchAll(TAG_RE)) {
        const start = line.from + m.index + m[1].length, end = start + 1 + m[2].length;
        if (!inCode(start, end) && !/^\d+$/.test(m[2])) {
          decos.push(Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': m[2].replace(/\/$/, '') } }).range(start, end));
        }
      }
      for (const m of text.matchAll(/==([^=\n]+)==/g)) {
        const start = line.from + m.index, end = start + m[0].length;
        if (inCode(start, end)) continue;
        const rendered = !active.has(line.number);
        if (rendered) decos.push(hide.range(start, start + 2));
        decos.push(Decoration.mark({ class: 'cm-highlight' }).range(start + 2, end - 2));
        if (rendered) decos.push(hide.range(end - 2, end));
      }
      const rendered = !active.has(line.number);
      for (const m of text.matchAll(/<u>(.+?)<\/u>/g)) {
        const start = line.from + m.index, end = start + m[0].length;
        if (inCode(start, end)) continue;
        if (rendered) decos.push(hide.range(start, start + 3));
        decos.push(Decoration.mark({ class: 'cm-underline' }).range(start + 3, end - 4));
        if (rendered) decos.push(hide.range(end - 4, end));
      }
      for (const m of text.matchAll(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g)) {
        const start = line.from + m.index + m[1].length, end = line.from + m.index + m[0].length;
        if (inCode(start, end)) continue;
        if (rendered) decos.push(Decoration.replace({ widget: new MathWidget(m[2]) }).range(start, end));
        else decos.push(Decoration.mark({ class: 'cm-math-src' }).range(start, end));
      }
      const fdef = /^\[\^([^\]\s]+)\]:/.exec(text);
      if (fdef) {
        decos.push(Decoration.line({ class: 'cm-footnote-def' }).range(line.from));
        decos.push(Decoration.mark({ class: 'cm-footnote-label' }).range(line.from, line.from + fdef[0].length));
      }
      for (const m of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
        const start = line.from + m.index, end = start + m[0].length;
        if (inCode(start, end)) continue;
        decos.push(Decoration.mark({ class: 'cm-footnote-ref', attributes: { title: 'Pie de página ' + m[1] } }).range(start, end));
      }
      for (const m of text.matchAll(WIKILINK_RE)) {
        const start = line.from + m.index, end = start + m[0].length;
        if (inCode(start, end)) continue;
        const target = m[1].split('|')[0].trim();
        const label = m[1].includes('|') ? m[1].slice(m[1].indexOf('|') + 1) : null;
        const rendered = !active.has(line.number);
        if (rendered) {
          decos.push(hide.range(start, label ? start + 2 + m[1].indexOf('|') + 1 : start + 2));
          decos.push(Decoration.mark({ class: 'cm-wikilink is-rendered', attributes: { 'data-wikilink': target } }).range(label ? start + 3 + m[1].indexOf('|') : start + 2, end - 2));
          decos.push(hide.range(end - 2, end));
        } else {
          decos.push(Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-wikilink': target } }).range(start, end));
        }
      }
    });
  }
  return Decoration.set(decos, true);
}

export function toggleTaskAt(view, pos) {
  const cur = view.state.doc.sliceString(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(cur)) return false;
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: cur[1] === ' ' ? 'x' : ' ' } });
  return true;
}

// Al escribir ``` (con o sin lenguaje) y pulsar Enter, el bloque se cierra solo y el cursor queda dentro.
function closeFence(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = /^(\s*)(`{3,}|~{3,})[ \t]*[\w+#.-]*[ \t]*$/.exec(line.text);
  if (!m || sel.head !== line.to) return false;
  let node = syntaxTree(state).resolveInner(line.from + m[1].length, 1);
  while (node && node.name !== 'FencedCode') node = node.parent;
  if (!node || state.doc.lineAt(node.from).number !== line.number) return false; // es la línea que cierra un bloque
  const last = state.doc.lineAt(node.to);
  const closed = last.number > line.number && new RegExp('^\\s*' + m[2][0] + '{' + m[2].length + ',}\\s*$').test(last.text);
  if (closed) return false;
  view.dispatch({ changes: { from: line.to, insert: `\n${m[1]}\n${m[1]}${m[2]}` }, selection: { anchor: line.to + 1 + m[1].length }, userEvent: 'input' });
  return true;
}

// Flecha abajo en la última línea de la nota, dentro de un bloque de código: crea una línea nueva para poder seguir escribiendo.
function leaveLastBlock(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.readOnly) return false;
  const line = state.doc.lineAt(sel.head);
  if (line.number !== state.doc.lines) return false;
  let node = syntaxTree(state).resolveInner(line.from, 1);
  while (node && node.name !== 'FencedCode') node = node.parent;
  if (!node) return false;
  view.dispatch({ changes: { from: state.doc.length, insert: '\n' }, selection: { anchor: state.doc.length + 1 }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

export function livePreview(opts) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view, opts); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view, opts);
      }
    }
  }, { decorations: (v) => v.decorations });

  const handlers = EditorView.domEventHandlers({
    mousedown(e, view) {
      const fold = e.target.closest('.cm-fold-toggle');
      if (fold) { e.preventDefault(); toggleFoldAt(view, view.posAtDOM(fold)); return true; }
      const langBtn = e.target.closest('.cm-code-lang');
      if (langBtn) {
        e.preventDefault();
        if (view.state.readOnly) return true;
        const line = view.state.doc.lineAt(Number(langBtn.dataset.pos));
        const m = FENCE_OPEN.exec(line.text);
        if (m) opts.pickLanguage(m[3] || '').then((lang) => {
          const now = view.state.doc.lineAt(Math.min(line.from, view.state.doc.length));
          const m2 = FENCE_OPEN.exec(now.text);
          if (lang == null || !m2) return;
          const at = now.from + m2[1].length + m2[2].length;
          view.dispatch({ changes: { from: at, to: now.from + m2[0].length, insert: lang } });
        });
        return true;
      }
      const send = e.target.closest('.cm-mail-send');
      if (send) { e.preventDefault(); opts.sendMail(parseMail(send._code || '')); return true; }
      const copy = e.target.closest('.cm-copy-code');
      if (copy) {
        e.preventDefault();
        navigator.clipboard.writeText(copy._code || '').then(() => { copy.textContent = 'Copiado ✓'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1400); });
        return true;
      }
      const box = e.target.closest('.cm-checkbox');
      if (box) { e.preventDefault(); toggleTaskAt(view, Number(box.dataset.pos)); return true; }
      const mod = e.metaKey || e.ctrlKey;
      const wiki = e.target.closest('[data-wikilink]');
      if (wiki && (mod || wiki.classList.contains('is-rendered'))) { e.preventDefault(); opts.openWikilink(wiki.dataset.wikilink); return true; }
      const link = e.target.closest('[data-url]');
      if (link && (mod || link.classList.contains('is-rendered'))) { e.preventDefault(); opts.openUrl(link.dataset.url); return true; }
      const tag = e.target.closest('[data-tag]');
      if (tag && mod) { e.preventDefault(); opts.openTag(tag.dataset.tag); return true; }
      return false;
    },
  });
  return [plugin, handlers, Prec.high(keymap.of([{ key: 'Enter', run: closeFence }, { key: 'ArrowDown', run: leaveLastBlock }]))];
}
