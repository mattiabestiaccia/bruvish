import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
// Minimap of the overlay, as in the approved mock-up laboratorio-stile/lavish/cornice/cornice.html
// (decision of 16 November 2026: where the lab DESIGN.md and the mock-up differ, the mock-up wins).
const read = name => readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
const [bridge, addon, css] = await Promise.all(['bridge.js', 'chrome-addon.js', 'chrome-addon.css'].map(read));
const tick = () => new Promise(r => setImmediate(r));

function runBridge(cards, { pointer = 'fine' } = {}) {
  const posted = [], listeners = {};
  const parent = { postMessage: message => posted.push(message) };
  const root = { dataset: {}, style: {}, scrollHeight: 4000 };
  const nodes = cards.map((c, i) => ({
    id: c.id, dataset: { mbState: c.state, ...c.fresh !== undefined ? { mbNew: c.fresh } : {} }, color: c.color,
    getClientRects: () => [1], getBoundingClientRect: () => ({ top: 100 * i }),
    matches: () => false, querySelector: () => ({ textContent: 'Carta ' + c.id, tagName: 'H3' }), getAttribute: () => null
  }));
  const document = {
    documentElement: root, body: {},
    querySelectorAll: selector => selector === '[data-mb-state],.card' ? nodes : [],
    addEventListener() { }
  };
  const getComputedStyle = el => ({
    getPropertyValue: name => el === root ? (name === '--title' ? ' #49cbbd ' : '') : name === '--mb-state-color' ? el.color : '',
    borderLeftColor: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)'
  });
  const context = {
    parent, document, getComputedStyle, scrollY: 0, innerHeight: 1000,
    matchMedia: query => ({ matches: query === '(pointer: ' + pointer + ')', addEventListener() { } }),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    requestAnimationFrame: () => 1,
    MutationObserver: class { observe(target, options) { context.observed = options.attributeFilter; } }
  };
  vm.runInNewContext(bridge, context);
  const deliver = data => listeners.message.forEach(fn => fn({ source: parent, data }));
  deliver({ type: 'lavish-mb:hello', token: 't' });
  deliver({ type: 'lavish-mb:restore', token: 't', fields: {} });
  return { posted, observed: context.observed, root };
}

function element(tag) {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), dataset: {}, attributes: {}, children: [], listeners: {}, hidden: false,
    style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
    classList: { add: name => classes.add(name), contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    append(...items) { this.children.push(...items); },
    replaceChildren() { this.children = []; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    get className() { return [...classes].join(' '); }, set className(value) { classes.clear(); value.split(' ').filter(Boolean).forEach(c => classes.add(c)); }
  };
  return el;
}

async function runAddon() {
  const listeners = {}, posted = [];
  const contentWindow = { postMessage: message => posted.push(message) };
  const iframe = { contentWindow, addEventListener() { } };
  const body = element('body');
  const document = {
    body, getElementById: id => id === 'artifact' ? iframe : null, createElement: element,
    querySelector: () => null, addEventListener() { }
  };
  const context = {
    document, posted,
    localStorage: { getItem: () => null, setItem() { } },
    crypto: { randomUUID: () => 'token-1' },
    CSS: { supports: (property, value) => property === 'color' && /^(#[0-9a-f]{3,8}|rgb\([\d, ]+\))$/i.test(value) },
    fetch: () => Promise.reject(new Error('offline')),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  };
  vm.runInNewContext(addon, context);
  await tick();
  const deliver = data => listeners.message.forEach(fn => fn({ source: contentWindow, data: { version: 1, token: 'token-1', ...data } }));
  const rail = body.children.find(el => el.className === 'mb-rail');
  return { body, rail, deliver, posted };
}

test('bridge: each minimap entry carries the novelty of its card and the outline carries the theme accent', () => {
  const { posted, observed } = runBridge([
    { id: 'a', state: 'info', fresh: 'new', color: '#6bb5ff' },
    { id: 'b', state: 'waiting', fresh: 'changed', color: '#d6ab32' },
    { id: 'c', state: 'answered', color: '#63ca84' },
    { id: 'd', state: 'blocked', fresh: 'bogus', color: '#fe8b83' }
  ]);
  const outline = posted.find(m => m.type === 'lavish-mb:outline');
  assert.deepEqual([...outline.items].map(i => [i.id, i.state, i.color, i.fresh]), [['a', 'info', '#6bb5ff', 'new'], ['b', 'waiting', '#d6ab32', 'changed'], ['c', 'answered', '#63ca84', ''], ['d', 'blocked', '#fe8b83', '']]);
  assert.equal(outline.accent, '#49cbbd', 'theme accent read from --title of the artifact');
  const position = posted.find(m => m.type === 'lavish-mb:position');
  assert.deepEqual(Object.keys(position).filter(k => !['type', 'version', 'token'].includes(k)), ['current'], 'no scroll progress: the minimap is the only cursor');
  assert(observed.includes('data-mb-new'), 'a changed novelty refreshes the minimap');
});

test('bridge: with a minimap and a fine pointer the native scrollbar of the document goes; touch screens and pages without a minimap keep it', () => {
  const cards = [{ id: 'a', state: 'info', color: '#6bb5ff' }, { id: 'b', state: 'waiting', color: '#d6ab32' }];
  assert.equal(runBridge(cards).root.style.scrollbarWidth, 'none', 'Mac and desktop browsers: the minimap is the only cursor');
  assert.equal(runBridge(cards, { pointer: 'coarse' }).root.style.scrollbarWidth, '', 'phone: the overlay scroll indicator stays');
  assert.equal(runBridge([]).root.style.scrollbarWidth, '', 'no minimap entries: the scrollbar is the only position cue left');
});

test('addon: no separate scroll cursor, new and changed lines are marked, focus takes the theme accent', async () => {
  const { body, rail, deliver } = await runAddon();
  assert(rail, 'minimap rail present');
  assert(!body.children.some(el => el.className === 'mb-position'), 'no .mb-position cursor');
  deliver({ type: 'lavish-mb:outline', accent: '#49cbbd', items: [
    { id: 'a', title: 'Carta a', state: 'info', color: '#6bb5ff', fresh: 'new' },
    { id: 'b', title: 'Carta b', state: 'waiting', color: '#d6ab32', fresh: 'changed' },
    { id: 'c', title: 'Carta c', state: 'answered', color: '#63ca84', fresh: '' }
  ] });
  assert.deepEqual(rail.children.map(b => [b.dataset.target, b.classList.contains('mb-new'), b.children[0].style.backgroundColor]), [['a', true, '#6bb5ff'], ['b', true, '#d6ab32'], ['c', false, '#63ca84']]);
  assert.deepEqual(rail.children.map(b => b.attributes['aria-label']), ['Vai a Carta a, nuova', 'Vai a Carta b, in attesa di risposta, modificata', 'Vai a Carta c']);
  assert.equal(rail.style.props['--mb-accent'], '#49cbbd');
  deliver({ type: 'lavish-mb:position', current: 'b', progress: .5 });
  assert.deepEqual(rail.children.map(b => b.classList.contains('current')), [false, true, false]);
  // An accent that is not a colour never reaches the style.
  deliver({ type: 'lavish-mb:outline', accent: 'url(x)', items: [{ id: 'a', title: 'Carta a', state: 'info' }] });
  assert.equal(rail.style.props['--mb-accent'], '#49cbbd');
});

test('minimap shape and colours follow the approved mock-up; the new lines pulse in opacity unless motion is reduced', () => {
  assert.doesNotMatch(css + addon, /mb-position/, 'the scroll cursor is gone');
  const rule = selector => css.match(new RegExp(selector.replace(/[.[\]=]/g, '\\$&') + '\\{([^}]*)\\}'))?.[1] || '';
  assert.match(rule('.mb-rail'), /gap:9px/);
  assert.match(rule('.mb-rail'), /overflow:auto;scrollbar-width:none/, 'a long minimap scrolls without a scrollbar of its own');
  assert.match(rule('.mb-rail button'), /width:22px;height:22px/);
  assert.match(rule('.mb-rail i'), /height:4px;width:12px/);
  assert.match(rule('.mb-rail .current i'), /width:22px/);
  for (const [state, color] of Object.entries({ waiting: '#d6ab32', answered: '#63ca84', info: '#6bb5ff', blocked: '#fe8b83' }))
    assert.match(rule('.mb-rail [data-state=' + state + '] i'), new RegExp('background:' + color));
  assert.doesNotMatch(css, /#e8c35a|#7cc79a|#8fb0ee|#ee8f8f|#8cbca7/, 'old fallback palette and focus colour removed');
  assert.match(rule('.mb-rail button:focus-visible i'), /outline:2px solid var\(--mb-accent,/);
  assert.match(css, /\.mb-rail \.mb-new i\{animation:mb-rail-novelty 2s ease-in-out infinite\}/);
  assert.match(css, /@keyframes mb-rail-novelty\{0%,100%\{opacity:\.45\}50%\{opacity:1\}\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.mb-rail \.mb-new i\{animation:none\}\}/);
});
