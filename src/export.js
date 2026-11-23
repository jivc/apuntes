// Convierte una nota a HTML para exportar (HTML/PDF), imprimir o "Copiar como".
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import { renderMath, CALLOUTS } from './livepreview.js';

const md = new MarkdownIt({ html: true, linkify: true, typographer: false }).use(footnotePlugin);

function toFileUrl(p) {
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// Reemplaza fórmulas por marcadores para que markdown-it no las toque.
function protectMath(src, store) {
  const keep = (html) => { store.push(html); return `APUNTESMATH${store.length - 1}FIN`; };
  return src
    .replace(/^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*$/gm, (_m, tex) => keep(`<div class="math">${renderMath(tex, true)}</div>`))
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_m, pre, tex) => pre + keep(renderMath(tex, false)));
}

export function noteToHtmlBody(content, baseDir) {
  const store = [];
  let src = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // Bloques de código: no tocar su contenido
  const fences = [];
  src = src.replace(/^(```|~~~)[\s\S]*?^\1[ \t]*$/gm, (m) => { fences.push(m); return `\u0000F${fences.length - 1}\u0000`; });
  src = protectMath(src, store);
  src = src
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => `<span class="wikilink">${b || a}</span>`)
    .replace(/(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu, (m, pre, tag) => (/^\d+$/.test(tag) ? m : `${pre}<span class="tag">#${tag}</span>`));
  src = src.replace(/\u0000F(\d+)\u0000/g, (_m, i) => fences[Number(i)]);
  let html = md.render(src);
  html = html.replace(/APUNTESMATH(\d+)FIN/g, (_m, i) => store[Number(i)]).replace(/<p>(<div class="math">[\s\S]*?<\/div>)<\/p>/g, '$1');
  // Tareas
  html = html.replace(/<li>\s*\[( |x|X)\]\s*/g, (_m, x) => `<li class="task${x.trim() ? ' done' : ''}"><input type="checkbox" disabled${x.trim() ? ' checked' : ''}> `);
  // Avisos > [!TIPO]
  html = html.replace(/<blockquote>\s*<p>\[!(\w+)\][+-]?\s*/gi, (m, type) => {
    const c = CALLOUTS[type.toLowerCase()];
    return c ? `<blockquote class="callout callout-${c[0]}"><p><strong>${c[1]} ${c[2]}</strong><br>` : m;
  });
  // Imágenes relativas → ruta absoluta
  html = html.replace(/<img src="(?!https?:|data:|file:)([^"]+)"/g, (_m, src2) => {
    let p = src2;
    try { p = decodeURI(src2); } catch {}
    return `<img src="${toFileUrl(/^([a-z]:)?[\\/]/i.test(p) ? p : baseDir + '/' + p)}"`;
  });
  return html;
}

export const EXPORT_CSS = `
  body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #33383d; max-width: 720px; margin: 40px auto; padding: 0 24px; }
  h1, h2, h3, h4 { color: #22262a; line-height: 1.3; letter-spacing: -.01em; }
  h1 { font-size: 2em; margin: .2em 0 .6em; }
  a { color: #d9474c; }
  mark { background: #ffe58f; border-radius: 3px; padding: 0 .15em; }
  code { font: .88em "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; background: #f4f2f0; color: #b0373c; padding: .1em .3em; border-radius: 4px; }
  pre { background: #f7f6f4; padding: 14px 16px; border-radius: 10px; overflow: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { margin: 1em 0; padding: .3em 1em; border-left: 3px solid #e0474c; color: #5d636a; }
  blockquote.callout { border-radius: 8px; border-left-width: 4px; color: inherit; }
  .callout-note { background: #eef5ff; border-color: #3b82f6 !important; }
  .callout-tip { background: #edf9f0; border-color: #22a35a !important; }
  .callout-important { background: #f5f0ff; border-color: #8b5cf6 !important; }
  .callout-warning { background: #fff7e8; border-color: #f59e0b !important; }
  .callout-caution { background: #fff0f0; border-color: #e5484d !important; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #e3e1de; padding: 6px 12px; text-align: left; }
  th { background: #f7f6f4; }
  li.task { list-style: none; margin-left: -1.4em; }
  li.task.done { color: #9a9ea3; text-decoration: line-through; }
  .tag { color: #c43b40; background: #fbeaea; border-radius: 5px; padding: 0 .3em; font-size: .9em; }
  .wikilink { color: #d9474c; border-bottom: 1px dotted; }
  img { max-width: 100%; border-radius: 8px; }
  hr { border: 0; border-top: 1px solid #e3e1de; margin: 2em 0; }
  .math { overflow-x: auto; }
  .footnotes { font-size: .9em; color: #5d636a; }
  @media print { body { margin: 0 auto; } }
`;

export function noteToHtmlDocument(title, content, baseDir, katexCssUrl) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
${katexCssUrl ? `<link rel="stylesheet" href="${katexCssUrl}">` : ''}<style>${EXPORT_CSS}</style></head><body>${noteToHtmlBody(content, baseDir)}</body></html>`;
}
