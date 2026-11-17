import { loadLibrary } from './library.js';
import { createSession } from './engine.js';
import { createStore } from './store.js';
import { S } from './strings.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const failedNote = document.getElementById('failed-note');
const offlineNote = document.getElementById('offline-note');
document.getElementById('brand').textContent = S.appTitle;
banner.textContent = S.banner; // index.html carries a static fallback copy of this text; keep in sync

function getStorage() {
  try { return window.localStorage; } catch { return null; }
}
const store = createStore(getStorage());

let lib = null; // { pathways, failed }
let session = null;
let sessionPathway = null;
let query = '';

function el(tag, opts = {}, ...kids) {
  const n = document.createElement(tag);
  if (opts.cls) n.className = opts.cls;
  if (opts.text != null) n.textContent = String(opts.text);
  for (const [k, v] of Object.entries(opts.attrs || {})) n.setAttribute(k, v);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) n.addEventListener(k, v);
  for (const k of kids) if (k) n.append(k);
  return n;
}

function badge(p) {
  return p.status === 'draft'
    ? el('span', { cls: 'badge draft', text: S.draft })
    : el('span', { cls: 'badge reviewed', text: S.reviewed(p.reviewed) });
}

function safeUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

const strOr = (v, d = '') => (typeof v === 'string' ? v : d);

function renderFailed() {
  failedNote.replaceChildren();
  const failed = lib ? lib.failed : [];
  if (!failed.length) { failedNote.hidden = true; return; }
  const ul = el('ul');
  for (const f of failed) ul.append(el('li', { text: `${f.id}: ${f.error}` }));
  failedNote.append(el('details', {}, el('summary', { text: S.failed(failed.length) }), ul));
  failedNote.hidden = false;
}

function pathwayItem(p, rerender) {
  const id = strOr(p.id);
  const on = store.isBookmarked(id);
  const link = el('a', { attrs: { href: `#/p/${encodeURIComponent(id)}` } },
    el('span', { cls: 't', text: strOr(p.title, id) }),
    badge(p));
  const star = el('button', {
    cls: 'star',
    text: on ? '★' : '☆',
    attrs: { type: 'button', 'aria-pressed': String(on), 'aria-label': `${on ? S.bookmarkRemove : S.bookmarkAdd}: ${strOr(p.title, id)}` },
    on: { click: () => { store.toggle(id); rerender(); } },
  });
  return el('li', { cls: 'item' }, link, star);
}

function renderHome() {
  session = null; sessionPathway = null;
  app.replaceChildren();
  const input = el('input', { attrs: { type: 'search', 'aria-label': S.searchLabel, placeholder: S.searchPlaceholder, autocomplete: 'off' } });
  input.value = query;
  const results = el('div');
  app.append(el('h1', { text: S.appTitle }), input, results);

  const draw = () => {
    results.replaceChildren();
    const q = query.trim().toLowerCase();
    const all = lib.pathways;
    const matches = all.filter(p =>
      !q || strOr(p.title).toLowerCase().includes(q) || strOr(p.category).toLowerCase().includes(q));
    if (!all.length) { results.append(el('p', { cls: 'muted', text: S.noPathways })); return; }
    if (!matches.length) { results.append(el('p', { cls: 'muted', text: S.noMatches })); return; }

    const marked = matches.filter(p => store.isBookmarked(strOr(p.id)));
    if (marked.length) {
      const ul = el('ul', { cls: 'list' });
      marked.forEach(p => ul.append(pathwayItem(p, draw)));
      results.append(el('h2', { text: S.bookmarks }), ul);
    }
    const groups = new Map();
    for (const p of matches) {
      const c = strOr(p.category) || S.uncategorised;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(p);
    }
    for (const c of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const ul = el('ul', { cls: 'list' });
      groups.get(c).forEach(p => ul.append(pathwayItem(p, draw)));
      results.append(el('h2', { text: c }), ul);
    }
  };
  input.addEventListener('input', () => { query = input.value; draw(); });
  draw();
}

function header(p) {
  const on = store.isBookmarked(strOr(p.id));
  return [
    el('div', { cls: 'row' },
      el('a', { cls: 'btn small', text: S.home, attrs: { href: '#/' } })),
    el('h1', { text: strOr(p.title, p.id) }),
    el('div', { cls: 'meta' }, badge(p), el('span', { text: strOr(p.category) })),
    p.status === 'draft' ? el('div', { cls: 'notice', text: S.draftNotice }) : null,
    el('div', { cls: 'row' }, el('button', {
      cls: 'btn small', text: on ? S.bookmarkRemove : S.bookmarkAdd,
      attrs: { type: 'button', 'aria-pressed': String(on) },
      on: { click: () => { store.toggle(strOr(p.id)); renderPathway(p); } },
    })),
  ];
}

function listBlock(title, items, cls) {
  if (!Array.isArray(items) || !items.length) return null;
  const ul = el('ul', { cls });
  items.forEach(i => ul.append(el('li', { text: i })));
  return el('div', {}, el('h2', { text: title }), el('div', { cls: 'card' }, ul));
}

function sourcesBlock(p) {
  const ul = el('ul');
  for (const s of p.sources) {
    const label = `${strOr(s.title, '(untitled)')}${s.year != null ? ` (${s.year})` : ''}`;
    const href = s.url ? safeUrl(s.url) : null;
    ul.append(el('li', {}, href
      ? el('a', { text: label, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } })
      : document.createTextNode(label)));
  }
  return el('div', {}, el('h2', { text: S.sources }), el('div', { cls: 'card' }, ul));
}

function renderPathway(p) {
  if (sessionPathway !== p) { session = createSession(p); sessionPathway = p; }
  const node = session.current();
  const hist = session.history();
  app.replaceChildren(...header(p));

  const rerender = () => renderPathway(p);
  const nav = el('div', { cls: 'row' },
    el('button', { cls: 'btn small', text: S.back, attrs: { type: 'button', ...(hist.length <= 1 ? { disabled: '' } : {}) },
      on: { click: () => { session.back(); rerender(); } } }),
    el('button', { cls: 'btn small', text: S.restart, attrs: { type: 'button' },
      on: { click: () => { session.restart(); rerender(); } } }));

  const trail = session.trail();
  if (trail.length) {
    const ol = el('ol', { cls: 'trail', attrs: { 'aria-label': S.trail } });
    for (const step of trail) {
      const n = p.nodes[step.node];
      const chosen = n.answers[step.answer];
      ol.append(el('li', { text: `${strOr(n.text)} → ${chosen ? strOr(chosen.label) : ''}` }));
    }
    app.append(ol);
  }

  if (session.isEnd()) {
    app.append(
      el('div', { cls: 'meta', text: S.result }),
      el('h1', { text: strOr(node.title) }),
      listBlock(S.actions, node.actions, 'actions'),
      listBlock(S.cautions, node.cautions, 'cautions'),
      sourcesBlock(p),
      nav);
  } else {
    const answers = el('div', { cls: 'answers' });
    node.answers.forEach((a, i) => answers.append(el('button', {
      cls: 'btn', text: a.label, attrs: { type: 'button' },
      on: { click: () => { session.answer(i); rerender(); } },
    })));
    app.append(
      el('div', { cls: 'meta', text: S.step(hist.length) }),
      el('p', { cls: 'q', text: node.text }),
      answers, nav);
  }
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function route() {
  if (!lib) return;
  const m = /^#\/p\/(.+)$/.exec(location.hash);
  if (m) {
    let id;
    try { id = decodeURIComponent(m[1]); } catch { id = m[1]; }
    const p = lib.pathways.find(x => x.id === id);
    if (p) { renderPathway(p); return; }
    app.replaceChildren(el('p', { text: S.notFound }), el('a', { cls: 'btn small', text: S.home, attrs: { href: '#/' } }));
    return;
  }
  renderHome();
}

function fitBanner() {
  document.documentElement.style.setProperty('--banner-h', `${banner.offsetHeight}px`);
}

async function init() {
  fitBanner();
  window.addEventListener('resize', fitBanner);
  window.addEventListener('hashchange', route);
  await load();
}

async function load() {
  app.textContent = S.loading;
  try {
    lib = await loadLibrary((u) => fetch(u, { cache: 'no-cache' }));
    if (!lib || !Array.isArray(lib.pathways) || !Array.isArray(lib.failed)) throw new Error('bad library');
    // loadLibrary reports an unreadable index.json as failed id 'index' with no pathways
    if (!lib.pathways.length && lib.failed.some(f => f.id === 'index')) throw new Error('index unavailable');
  } catch {
    lib = null;
    failedNote.hidden = true;
    offlineNote.hidden = true;
    app.replaceChildren(
      el('p', { cls: 'notice', text: S.loadError, attrs: { role: 'alert' } }),
      el('button', { cls: 'btn small', text: S.retry, attrs: { type: 'button' }, on: { click: load } }));
    return;
  }
  offlineNote.replaceChildren();
  if (lib.offline) {
    offlineNote.append(
      el('span', { text: S.offlineCopy }), ' ',
      el('button', { cls: 'btn small', text: S.refresh, attrs: { type: 'button' }, on: { click: load } }));
  }
  offlineNote.hidden = !lib.offline;
  renderFailed();
  route();
}
init();
