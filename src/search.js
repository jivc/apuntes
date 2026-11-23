// Búsqueda con operadores al estilo Bear:
//   "frase exacta"   -excluir   #etiqueta   -#etiqueta
//   @todo @done @task @today @yesterday @last7days @untagged @tagged @pinned
//   @images @files @code @title @date(2026-10-16) @cdate(2026-10-16)
// (también en español: @tareas @hechas @hoy @ayer @semana @sinetiqueta @etiquetadas @fijadas @imagenes @adjuntos @codigo @titulo)

export const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ALIAS = {
  tareas: 'todo', pendientes: 'todo', hechas: 'done', completadas: 'done', tarea: 'task', tasks: 'task',
  hoy: 'today', ayer: 'yesterday', semana: 'last7days', sinetiqueta: 'untagged', sinetiquetas: 'untagged',
  etiquetadas: 'tagged', fijadas: 'pinned', ancladas: 'pinned', imagenes: 'images', imagen: 'images',
  adjuntos: 'files', attachments: 'files', archivos: 'files', codigo: 'code', titulo: 'title',
  fecha: 'date', creada: 'cdate',
};

export const OPERATORS = [
  ['@todo', 'Notas con tareas pendientes'], ['@done', 'Notas con tareas completadas'], ['@task', 'Notas con tareas'],
  ['@today', 'Modificadas hoy'], ['@yesterday', 'Modificadas ayer'], ['@last7days', 'Últimos 7 días'],
  ['@untagged', 'Sin etiquetas'], ['@tagged', 'Con etiquetas'], ['@pinned', 'Fijadas'],
  ['@images', 'Con imágenes'], ['@files', 'Con adjuntos'], ['@code', 'Con código'], ['@title', 'Buscar solo en títulos'],
  ['@date(AAAA-MM-DD)', 'Modificadas ese día'], ['@cdate(AAAA-MM-DD)', 'Creadas ese día'],
];

export function parseQuery(q) {
  const out = { terms: [], tags: [], ops: [], titleOnly: false, empty: true };
  const re = /(-?)"([^"]*)"|(-?)(#[^\s]+)|@(\w+)(?:\(([^)]*)\))?|(-?)(\S+)/g;
  for (const m of q.matchAll(re)) {
    out.empty = false;
    if (m[2] !== undefined) { if (m[2]) out.terms.push({ text: normalize(m[2]), neg: !!m[1] }); }
    else if (m[4]) out.tags.push({ tag: normalize(m[4].slice(1).replace(/#$/, '')), neg: !!m[3] });
    else if (m[5]) {
      let op = normalize(m[5]);
      op = ALIAS[op] || op;
      if (op === 'title') out.titleOnly = true;
      else out.ops.push({ op, arg: m[6] });
    } else if (m[8]) out.terms.push({ text: normalize(m[8]), neg: !!m[7] });
  }
  return out;
}

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const sameDay = (ms, iso) => {
  const d = new Date(ms);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return s === iso;
};

export function matchNote(n, p, ctx) {
  const hay = p.titleOnly ? normalize(n.title) : n.search;
  for (const t of p.terms) if (hay.includes(t.text) === t.neg) return false;
  for (const t of p.tags) {
    const has = n.tags.some((x) => { const xl = normalize(x); return xl === t.tag || xl.startsWith(t.tag + '/'); });
    if (has === t.neg) return false;
  }
  const today = dayStart(new Date());
  for (const { op, arg } of p.ops) {
    switch (op) {
      case 'todo': if (!n.open) return false; break;
      case 'done': if (!n.done) return false; break;
      case 'task': if (!(n.open + n.done)) return false; break;
      case 'today': if (n.mtime < today) return false; break;
      case 'yesterday': if (n.mtime < today - 864e5 || n.mtime >= today) return false; break;
      case 'last7days': if (n.mtime < today - 6 * 864e5) return false; break;
      case 'untagged': if (n.tags.length) return false; break;
      case 'tagged': if (!n.tags.length) return false; break;
      case 'pinned': if (!ctx.pinned.has(n.rel)) return false; break;
      case 'images': if (!/!\[[^\]]*\]\([^)]+\.(png|jpe?g|gif|webp|svg|heic|avif)\)|!\[\[[^\]]+\.(png|jpe?g|gif|webp|svg)\]\]/i.test(n.content)) return false; break;
      case 'files': if (!/!?\[[^\]]*\]\((?!https?:)[^)]+\.[a-z0-9]{2,5}\)|!\[\[[^\]]+\]\]/i.test(n.content)) return false; break;
      case 'code': if (!/```|`[^`\n]+`/.test(n.content)) return false; break;
      case 'date': if (!arg || !sameDay(n.mtime, arg.trim())) return false; break;
      case 'cdate': if (!arg || !sameDay(n.birthtime, arg.trim())) return false; break;
      default: break;
    }
  }
  return true;
}
