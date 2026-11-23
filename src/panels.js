// Diálogos y paneles flotantes: pedir texto, elegir ícono de etiqueta, búsqueda rápida y visor de imágenes.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function overlay(cls, html) {
  const el = document.createElement('div');
  el.className = 'ov ' + cls;
  el.innerHTML = html;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  return el;
}
function closeOverlay(el) { el.classList.remove('is-open'); setTimeout(() => el.remove(), 160); }

// Pide un texto (Electron no tiene window.prompt). Devuelve el texto o null.
export function askText({ title, label = '', value = '', ok = 'Aceptar', placeholder = '' }) {
  return new Promise((resolve) => {
    const el = overlay('ov-dialog', `
      <form class="dlg">
        <h3>${esc(title)}</h3>
        ${label ? `<p>${esc(label)}</p>` : ''}
        <input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">
        <div class="dlg-row"><button type="button" class="secondary-btn" data-x>Cancelar</button><button type="submit" class="primary-btn small">${esc(ok)}</button></div>
      </form>`);
    const input = el.querySelector('input');
    input.focus(); input.select();
    const done = (v) => { closeOverlay(el); resolve(v); };
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(null); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

export function confirmBox({ title, label = '', ok = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    const el = overlay('ov-dialog', `
      <div class="dlg" tabindex="-1">
        <h3>${esc(title)}</h3>${label ? `<p>${esc(label)}</p>` : ''}
        <div class="dlg-row"><button class="secondary-btn" data-x>Cancelar</button><button class="primary-btn small ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button></div>
      </div>`);
    const done = (v) => { closeOverlay(el); resolve(v); };
    el.querySelector('[data-ok]').focus();
    el.querySelector('[data-ok]').addEventListener('click', () => done(true));
    el.querySelector('[data-x]').addEventListener('click', () => done(false));
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(false); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
  });
}

const ICONS = ['📁', '📌', '⭐', '💡', '📚', '📓', '✏️', '🎓', '🔬', '🧪', '📊', '📈', '💼', '🏠', '❤️', '🍳', '🛒', '✈️', '🎵', '🎬', '🏃', '🌱', '💰', '🧾', '📅', '⏰', '🗂️', '🔖', '🧠', '🚀', '🎯', '🛠️', '💻', '📷', '🎨', '🐻', '👶', '👥', '🌎', '📝', '✅', '❓', '🔒', '🧘', '☕', '🍎', '⚽', '🎁'];

// Elige un ícono (TagCon) para una etiqueta. Devuelve emoji, '' (quitar) o null (cancelar).
export function pickIcon(tag, current) {
  return new Promise((resolve) => {
    const el = overlay('ov-dialog', `
      <div class="dlg dlg-icons">
        <h3>Ícono para #${esc(tag)}</h3>
        <div class="icon-grid">${ICONS.map((i) => `<button data-i="${i}" class="${i === current ? 'on' : ''}">${i}</button>`).join('')}</div>
        <div class="dlg-row"><input type="text" maxlength="4" placeholder="Otro emoji" value="${esc(current && !ICONS.includes(current) ? current : '')}">
        <button class="secondary-btn" data-none>Sin ícono</button><button class="secondary-btn" data-x>Cancelar</button></div>
      </div>`);
    const done = (v) => { closeOverlay(el); resolve(v); };
    el.querySelector('.icon-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) done(b.dataset.i); });
    el.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) done(e.target.value.trim()); });
    el.querySelector('[data-none]').addEventListener('click', () => done(''));
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(null); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

// Búsqueda rápida: notas, #etiquetas y @secciones (encabezados). search(q) devuelve [{kind,label,detail,run}].
export function quickOpen(search) {
  const el = overlay('ov-quick', `
    <div class="qo">
      <input type="text" placeholder="Buscar notas, #etiquetas o @secciones" spellcheck="false">
      <div class="qo-list"></div>
      <div class="qo-hint">↑↓ para moverte · Enter para abrir · Esc para cerrar</div>
    </div>`);
  const input = el.querySelector('input'), list = el.querySelector('.qo-list');
  let items = [], idx = 0;
  const render = () => {
    items = search(input.value).slice(0, 60);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    list.innerHTML = items.length ? items.map((it, i) => `
      <div class="qo-item ${i === idx ? 'on' : ''}" data-i="${i}"><span class="qo-kind">${it.kind}</span><span class="qo-label">${esc(it.label)}</span><span class="qo-detail">${esc(it.detail || '')}</span></div>`).join('')
      : '<div class="qo-empty">Sin resultados</div>';
    const on = list.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const close = () => closeOverlay(el);
  const go = (i) => { const it = items[i]; close(); if (it) it.run(); };
  input.addEventListener('input', () => { idx = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('mousedown', (e) => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); go(Number(r.dataset.i)); } });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  render();
  input.focus();
}

// Visor de imágenes a pantalla completa.
export function lightbox(src) {
  const el = overlay('ov-lightbox', `<img src="${esc(src)}" alt="">`);
  const close = () => { closeOverlay(el); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
}

// Plantilla de correo. mode 'insert': crear la plantilla · mode 'send': revisar, completar {{datos}} y abrir en la app de correo.
// Devuelve { to, cc, bcc, subject, body, action } o null si se cancela.
const VAR_RE = /\{\{\s*([^{}\n]+?)\s*\}\}/g;
export function mailDialog({ mode, mail }) {
  return new Promise((resolve) => {
    const send = mode === 'send';
    const names = send ? [...new Set([mail.to, mail.cc, mail.bcc, mail.subject, mail.body].flatMap((x) => [...String(x || '').matchAll(VAR_RE)].map((m) => m[1])))] : [];
    const el = overlay('ov-dialog ov-mail', `
      <form class="dlg dlg-mail">
        <h3>${send ? 'Enviar correo' : 'Nueva plantilla de correo'}</h3>
        <p>${send ? 'Revisa el mensaje. Se abrirá como borrador en tu aplicación de correo y tú decides cuándo enviarlo.' : 'Escribe el correo una vez y reutilízalo. Para datos que cambian cada vez usa llaves dobles, por ejemplo {{nombre}}: Apuntes te los pedirá al enviar.'}</p>
        ${names.length ? `<div class="mail-vars"><div class="mail-vars-title">Datos de esta plantilla</div>${names.map((n, i) => `<label><span>${esc(n)}</span><input type="text" data-var="${i}" spellcheck="false"></label>`).join('')}<div class="mail-vars-note">Se colocarán en lugar de cada {{dato}} al abrir o copiar el mensaje.</div></div>` : ''}
        <label class="mail-row"><span>Para</span><input type="text" name="to" value="${esc(mail.to || '')}" placeholder="correo@ejemplo.com, otro@ejemplo.com" spellcheck="false"></label>
        <label class="mail-row"><span>CC</span><input type="text" name="cc" value="${esc(mail.cc || '')}" spellcheck="false"></label>
        <label class="mail-row"><span>CCO</span><input type="text" name="bcc" value="${esc(mail.bcc || '')}" spellcheck="false"></label>
        <label class="mail-row"><span>Asunto</span><input type="text" name="subject" value="${esc(mail.subject || '')}"></label>
        <textarea name="body" rows="9" placeholder="Escribe aquí el mensaje…">${esc(mail.body || '')}</textarea>
        <div class="dlg-row">
          <button type="button" class="secondary-btn" data-x>Cancelar</button>
          ${send ? '<button type="button" class="secondary-btn" data-copy>Copiar mensaje</button>' : ''}
          <button type="submit" class="primary-btn small">${send ? 'Abrir en mi correo' : 'Insertar plantilla'}</button>
        </div>
      </form>`);
    const form = el.querySelector('form');
    const fill = (text) => text.replace(VAR_RE, (m, name) => {
      const i = names.indexOf(name);
      const v = i >= 0 ? el.querySelector(`[data-var="${i}"]`).value.trim() : '';
      return v || m;
    });
    const values = (action) => {
      const out = { action };
      for (const k of ['to', 'cc', 'bcc', 'subject', 'body']) out[k] = fill(form.elements[k].value).trim();
      return out;
    };
    const done = (v) => { closeOverlay(el); resolve(v); };
    const first = el.querySelector('[data-var]') || (send && mail.to ? form.elements.body : form.elements[send ? 'to' : 'subject']);
    first.focus();
    form.addEventListener('submit', (e) => { e.preventDefault(); done(values(send ? 'open' : 'insert')); });
    const copy = el.querySelector('[data-copy]');
    if (copy) copy.addEventListener('click', () => done(values('copy')));
    el.querySelector('[data-x]').addEventListener('click', () => done(null));
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(null); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    });
  });
}
