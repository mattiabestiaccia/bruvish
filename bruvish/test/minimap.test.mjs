import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
// Minimap of the overlay, as in the approved mock-up laboratorio-stile/lavish/cornice/cornice.html
// (decision of 16 November 2026: where the lab DESIGN.md and the mock-up differ, the mock-up wins).
const read = name => readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
const [bridge, addon, css, artifactJs] = await Promise.all(['bridge.js', 'chrome-addon.js', 'chrome-addon.css', 'artifact.js'].map(read));
const tick = () => new Promise(r => setImmediate(r));

function runBridge(cards, { pointer = 'fine', palette = { '--title': ' #49cbbd ' }, active = null, handshake = true, userAgent = 'Chrome', legacyControls = [] } = {}) {
  const posted = [], listeners = {}, documentListeners = {}, styles = [], scrolls = [];
  const parent = { postMessage: message => posted.push(message) };
  const root = { dataset: {}, style: {}, scrollHeight: 4000 };
  // A closed card (answered, not new) has no boxes while the injected rule hides it.
  const hiddenByRule = node => root.dataset.mbClosed === 'hide' && styles.length && (node.dataset.mbState === 'answered' || node.dataset.mbClosedCard === 'true') && !('mbNew' in node.dataset);
  const nodes = cards.map((c, i) => {
    const node = {
      id: c.id, dataset: { mbState: c.state, ...c.fresh !== undefined ? { mbNew: c.fresh } : {} }, color: c.color,
      classList: {contains: name => (c.classes || []).includes(name)},
      getClientRects: () => hiddenByRule(node) ? [] : [1], getBoundingClientRect: () => ({ top: 100 * i }),
      parentElement: { getClientRects: () => [1] }, closest: selector => ['[data-mb-state]','[data-mb-state],.card'].includes(selector) ? node : null,
      matches: () => false, querySelector: () => ({ textContent: 'Carta ' + c.id, tagName: 'H3' }), getAttribute: () => null,
      // Records whether the element had a layout box when it was scrolled to: a scroll without one does nothing.
      scrollIntoView: options => scrolls.push([node.id, node.getClientRects().length > 0, options?.block])
    };
    return node;
  });
  const document = {
    documentElement: root, body: {}, head: { append: style => styles.push(style) },
    createElement: tag => ({ tagName: tag.toUpperCase(), textContent: '' }),
    get activeElement() { return active?.() ?? document.body; },
    querySelectorAll: selector => selector === '[data-mb-state],.card' ? nodes : selector === '.mb-mode,[data-mb-mode-switch]' ? legacyControls : [],
    querySelector: selector => { if (!/^#[\w-]+$/.test(selector)) throw new SyntaxError('bad selector'); return nodes.find(node => '#' + node.id === selector) ?? null; },
    addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); }
  };
  const getComputedStyle = el => ({
    getPropertyValue: name => el === root ? (palette[name] ?? '') : name === '--mb-state-color' ? el.color : '',
    borderLeftColor: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)'
  });
  const context = {
    parent, document, navigator: {userAgent}, getComputedStyle, scrollY: 0, innerHeight: 1000,
    matchMedia: query => ({ matches: query === '(pointer: ' + pointer + ')', addEventListener() { } }),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    requestAnimationFrame: () => 1,
    MutationObserver: class { observe(target, options) { context.observed = options.attributeFilter; } }
  };
  vm.runInNewContext(bridge, context);
  const deliver = data => listeners.message.forEach(fn => fn({ source: parent, data }));
  if (handshake) {
    deliver({ type: 'lavish-mb:hello', token: 't' });
    deliver({ type: 'lavish-mb:restore', token: 't', fields: {} });
  }
  const dispatch = (type, event) => (documentListeners[type] || []).forEach(fn => fn(event));
  return { posted, observed: context.observed, root, dispatch, deliver, styles, scrolls, nodes };
}

test('handwritten card classes supply status colours and answered-card counts without generated metadata',()=>{
 const cards=[{id:'a',classes:['attesa'],color:''},{id:'b',classes:['fatta'],color:''},{id:'c',classes:['info'],color:''},{id:'d',classes:['bloccata'],color:''}];
 const run=runBridge(cards);
 const outline=run.posted.filter(m=>m.type==='lavish-mb:outline').at(-1);
 assert.deepEqual(Array.from(outline.items,item=>[item.state,item.color]),[['waiting','#d6ab32'],['answered','#63ca84'],['info','#6bb5ff'],['blocked','#fe8b83']]);
 assert.deepEqual([outline.closed,outline.open],[1,3]);
 assert.equal(outline.items[1].hidden,true,'handwritten answered cards participate in the existing filter');
 assert(run.observed.includes('class'),'legacy state changes must refresh rail and closed control');
 cards[0].classes=['fatta'];run.deliver({type:'lavish-mb:closed',token:'t',show:true});
 const changed=run.posted.filter(m=>m.type==='lavish-mb:outline').at(-1);
 assert.deepEqual([changed.items[0].state,changed.items[0].color,changed.closed],['answered','#63ca84',2],'a new answer changes state without stale generated metadata');
});

test('a neutral card border never replaces a known status colour',()=>{
 const run=runBridge([{id:'a',state:'waiting',color:''},{id:'b',state:'blocked',color:''}]);
 assert.deepEqual(Array.from(run.posted.filter(m=>m.type==='lavish-mb:outline').at(-1).items,item=>item.color),['#d6ab32','#fe8b83']);
});

test('review menus have an opaque background in both transparency modes',()=>{
 assert.match(css,/\.menu\s*\{[^}]*background:\s*#1f2023/);
});

test('the closed-card control stays available for a page with only open cards',async()=>{
 const chrome=upstreamChrome();const run=await runAddon(new Map(),{chrome});
 run.deliver({type:'lavish-mb:outline',items:[{id:'a',state:'waiting'}],closed:0,open:1});
 assert.equal(chrome.bar.children.find(el=>el.className==='mb-closed-switch').hidden,false);
});

function element(tag) {
  const classes = new Set();
  const el = {
    nodeType: 1, tagName: tag.toUpperCase(), dataset: {}, attributes: {}, children: [], listeners: {}, hidden: false, textContent: '', parent: null,
    get parentElement() { return this.parent; },
    closest(selector) {
      const simple = (node, token) => token === node.tagName.toLowerCase() || (token.startsWith('.') && token.slice(1).split('.').every(name => node.classList.contains(name)));
      const matches = (node, part) => { const [ancestor, own] = part.trim().split(/\s+/).length > 1 ? part.trim().split(/\s+/) : [null, part.trim()]; if (!simple(node, own)) return false; if (!ancestor) return true; for (let up = node.parent; up; up = up.parent) if (simple(up, ancestor)) return true; return false; };
      for (let node = this; node; node = node.parent) if (selector.split(',').some(part => matches(node, part))) return node; return null;
    },
    style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
    replaceChildren(...items) { this.textContent = ''; this.children = []; this.append(...items); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
    before(item) { const siblings = this.parent.children; item.parent = this.parent; siblings.splice(siblings.indexOf(this), 0, item); },
    get childNodes() { return this.children; },
    querySelector(selector) { const name = selector.replace(/^\./, ''); for (const child of this.children) { if (child.classList?.contains(name)) return child; const found = child.querySelector?.(selector); if (found) return found; } return null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { if (!this.disabled) { this.clicks = (this.clicks || 0) + 1; this.listeners.click?.(); } },
    get className() { return [...classes].join(' '); }, set className(value) { classes.clear(); value.split(' ').filter(Boolean).forEach(c => classes.add(c)); }
  };
  return el;
}

// The upstream bar pieces the addon restyles: brand, annotate switch (track, knob, label), panel title, send buttons.
function upstreamChrome() {
  const bar = element('div'), brandBox = element('div'), brand = element('span'), annotate = element('button'), track = element('span'), knob = element('span'), label = element('span');
  brandBox.className = 'brand'; brand.className = 'brand-mark'; brand.textContent = 'Lavish'; brandBox.append(brand);
  annotate.className = 'annotate-switch';
  annotate.setAttribute('aria-pressed', 'true');
  annotate.setAttribute('title', 'Toggle annotate/explore mode (⌘E / Ctrl+E)');
  track.className = 'switch-track'; knob.className = 'switch-knob'; label.textContent = 'Annotate';
  track.append(knob); annotate.append(track, label); bar.append(brandBox, annotate);
  const title = element('h2'), send = element('button'), end = element('span'), input = element('textarea');
  title.textContent = 'Conversation'; send.textContent = 'Send to Agent'; end.textContent = 'Send & End';
  const endButton = element('button'), exit = element('svg');
  endButton.append(exit, end);
  return { bar, brandBox, brand, annotate, title, send, end, endButton, exit, input };
}

async function runAddon(storage = new Map(), { pointer = 'fine', chrome = null, active = null, panel = null, appMode = null } = {}) {
  const listeners = {}, posted = [], documentListeners = {}, observers = [];
  const contentWindow = { postMessage: message => posted.push(message) };
  const iframe = { contentWindow, addEventListener() { } };
  const body = element('body'), head = element('head');
  const root = { dataset: appMode ? {mbAppMode: appMode} : {}, style: { props: {}, setProperty(name, value) { this.props[name] = value; }, removeProperty(name) { delete this.props[name]; } } };
  const byId = { artifact: iframe, ...chrome ? { annotation: chrome.annotate, send: chrome.send, chatInput: chrome.input } : {} };
  const bySelector = { ...chrome ? { '.brand': chrome.brandBox, '.brand-mark': chrome.brand, '.panel h2': chrome.title, '#sendAndEnd span': chrome.end } : {}, ...panel ? { '.panel': panel } : {} };
  const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);
  const document = {
    body, head, documentElement: root, getElementById: id => byId[id] ?? null, createElement: element,
    createElementNS: (namespace, tag) => Object.assign(element(tag), { namespace }),
    querySelector: selector => bySelector[selector] ?? null,
    createTreeWalker: scope => { const nodes = descendants(scope); let i = 0; return { nextNode: () => nodes[i++] ?? null }; },
    get activeElement() { return active?.() ?? body; },
    addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); }
  };
  const context = {
    document, posted,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    crypto: { randomUUID: () => 'token-1' },
    matchMedia: query => ({ matches: query === '(pointer: ' + pointer + ')' }),
    CSS: { supports: (property, value) => property === 'color' && /^(#[0-9a-f]{3,8}|rgba?\([\d., ]+\))$/i.test(value) },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(target) { this.target = target; } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    fetch: () => Promise.reject(new Error('offline')),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  };
  vm.runInNewContext(addon, context);
  await tick();
  const deliver = data => listeners.message.forEach(fn => fn({ source: contentWindow, data: { version: 1, token: 'token-1', ...data } }));
  const key = (code, timeStamp, extra = {}) => (documentListeners.keydown || []).forEach(fn => fn({ code, timeStamp, ...extra }));
  // Upstream sets aria-pressed again on every toggle; the observer then mirrors it.
  const upstreamToggle = pressed => { chrome.annotate.setAttribute('aria-pressed', String(pressed)); observers.filter(o => o.target === chrome.annotate).forEach(o => o.fn()); };
  const rail = body.children.find(el => el.className === 'mb-rail');
  return { body, head, root, rail, deliver, posted, key, upstreamToggle, observers };
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

test('backdrop mode is app-authoritative, survives the handshake and ignores stored or artifact choices', async () => {
  const storage = new Map([['lavish-mb:mode','dark']]);
  const app = await runAddon(storage,{appMode:'transparent'});
  app.deliver({type:'lavish-mb:ready'});
  assert.equal(app.posted.filter(m=>m.type==='lavish-mb:mode').at(-1).mode,'transparent');
  app.deliver({type:'lavish-mb:mode',mode:'dark'});
  assert.equal(app.posted.filter(m=>m.type==='lavish-mb:mode').at(-1).mode,'transparent','an artifact cannot override the toolbar');
  app.root.dataset.mbAppMode='dark';app.observers.filter(o=>o.target===app.root).forEach(o=>o.fn());
  assert.equal(app.posted.filter(m=>m.type==='lavish-mb:mode').at(-1).mode,'dark','native preference updates reach the current artifact');
  app.deliver({type:'lavish-mb:ready'});
  assert.equal(app.posted.filter(m=>m.type==='lavish-mb:mode').at(-1).mode,'dark','reload uses current app preference');
  assert.equal(storage.get('lavish-mb:mode'),'dark','web mode is not rewritten');
  for(const pointer of ['fine','coarse']) {
    const browser=await runAddon(new Map([['lavish-mb:mode','transparent']]),{pointer});
    browser.deliver({type:'lavish-mb:ready'});
    assert.equal(browser.posted.filter(m=>m.type==='lavish-mb:mode').at(-1).mode,'dark','browser and phone ignore old transparent choice');
  }
});

test('only the Mac app bridge accepts transparent mode; browser and phone remain dark, old controls retire',()=>{
 const native='Mozilla/5.0 (Macintosh; Intel Mac OS X) Electron/44.2.0';
 for(const userAgent of ['Chrome Macintosh','Chrome Android','Electron/44.2.0 Windows',native]) {
  let removed=0;
  const run=runBridge([],{userAgent,legacyControls:[{remove(){removed++;}}]});
  assert.equal(removed,1);assert.equal(run.root.dataset.mbMode,'dark');
  run.deliver({type:'lavish-mb:mode',token:'wrong',mode:'transparent'});
  assert.equal(run.root.dataset.mbMode,'dark','wrong channel token is ignored');
  run.deliver({type:'lavish-mb:mode',token:'t',mode:'transparent'});
  assert.equal(run.root.dataset.mbMode,userAgent===native?'transparent':'dark');
  run.deliver({type:'lavish-mb:mode',token:'t',mode:'dark'});
  assert.equal(run.root.dataset.mbMode,'dark');
  run.dispatch('lavish-mb:mode-change',{detail:{mode:'transparent'}});
  assert.equal(run.posted.some(m=>m.type==='lavish-mb:mode'),false,'no artifact mode choice goes upstream');
  assert.equal(run.posted.at(-1).type,'lavish-mb:mode-request','old scripts only request the app value');
 }
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

test('bridge: closed cards are hidden from the start until the host page asks to show them, never all of them; the outline reports counts, dots and the theme family', () => {
  const palette = { '--card': 'rgba(38,30,51,0.5)', '--line': '#4d4360', '--ink': '#e3e2f5', '--muted': '#a5b1cb', '--title': '#49cbbd', '--field': 'rgba(19,15,27,0.3)' };
  const cards = [{ id: 'a', state: 'waiting', color: '#d6ab32' }, { id: 'b', state: 'answered', color: '#63ca84' }, { id: 'c', state: 'answered', fresh: 'changed', color: '#63ca84' }];
  const early = runBridge(cards, { palette, handshake: false });
  assert.deepEqual([early.root.dataset.mbClosed, early.styles.length, early.posted.length], ['hide', 1, 0], 'closed cards hidden as soon as the bridge runs, before the load and any message from the host page');
  const run = runBridge(cards, { palette });
  const last = () => run.posted.filter(m => m.type === 'lavish-mb:outline').at(-1);
  assert.deepEqual({ ...last().palette }, { card: 'rgba(38,30,51,0.5)', line: '#4d4360', ink: '#e3e2f5', muted: '#a5b1cb', title: '#49cbbd', field: 'rgba(19,15,27,0.3)' });
  assert.deepEqual([last().closed, last().open], [1, 2], 'a new or changed answered card is not closed');
  assert.equal(run.root.dataset.mbClosed, 'hide');
  run.deliver({ type: 'lavish-mb:closed', token: 't', show: false });
  assert.equal(run.root.dataset.mbClosed, 'hide');
  assert.deepEqual([...last().items].map(i => [i.id, i.closed, i.hidden]), [['a', false, false], ['b', true, true], ['c', false, false]], 'the hidden closed card stays in the minimap');
  run.deliver({ type: 'lavish-mb:closed', token: 't', show: true });
  assert.equal(run.root.dataset.mbClosed, 'show');
  assert.deepEqual([...last().items].map(i => i.hidden), [false, false, false]);
  run.deliver({ type: 'lavish-mb:closed', token: 't', show: 'no' });
  assert.equal(run.root.dataset.mbClosed, 'show', 'only a boolean changes the filter');
  const allClosed = runBridge([{ id: 'x', state: 'answered', color: '#63ca84' }]);
  allClosed.deliver({ type: 'lavish-mb:closed', token: 't', show: false });
  assert.equal(allClosed.root.dataset.mbClosed, 'show', 'a page of closed cards only is never emptied');
});

test('bridge: a reveal or an annotation inside a hidden closed card shows the closed cards, tells the host page and brings the element into view', () => {
  const cards = [{ id: 'a', state: 'waiting', color: '#d6ab32' }, { id: 'b', state: 'answered', color: '#63ca84' }];
  const run = runBridge(cards);
  const requests = () => run.posted.filter(m => m.type === 'lavish-mb:show-closed').length;
  run.deliver({ type: 'lavish:revealElement', selector: '#a' });
  run.deliver({ type: 'lavish:revealElement', selector: 'div[' });
  run.deliver({ type: 'lavish:revealElement', selector: '#missing' });
  run.deliver({ type: 'lavish:revealElement', selector: 7 });
  assert.deepEqual([run.root.dataset.mbClosed, requests(), run.scrolls], ['hide', 0, []], 'an open card, a bad selector or no element change nothing');
  // In Chrome the SDK, registered first, has already scrolled to the element while it had no box: the bridge scrolls again once it has one.
  run.deliver({ type: 'lavish:revealElement', selector: '#b' });
  assert.deepEqual([run.root.dataset.mbClosed, requests(), run.scrolls], ['show', 1, [['b', true, 'center']]], 'shown, then brought into view with its box');
  run.deliver({ type: 'lavish-mb:closed', token: 't', show: false });
  run.deliver({ type: 'lavish:annotateElement', selector: '#b' });
  assert.deepEqual([run.root.dataset.mbClosed, requests(), run.scrolls.length], ['show', 2, 2]);
  run.deliver({ type: 'lavish-mb:closed', token: 't', show: false });
  run.deliver({ type: 'lavish:queuedAnchors', selector: '#b' });
  assert.deepEqual([run.root.dataset.mbClosed, requests(), run.scrolls.length], ['hide', 2, 2], 'other SDK messages leave the filter alone');
});

test('bridge: a double tap of the right Option key in the artifact asks for annotation mode, except while typing or with a key in between', () => {
  let active = null;
  const run = runBridge([], { active: () => active });
  const toggles = () => run.posted.filter(m => m.type === 'lavish-mb:annotate-toggle').length;
  const key = (code, timeStamp, extra = {}) => run.dispatch('keydown', { code, timeStamp, ...extra });
  key('AltRight', 1000); key('AltRight', 1300);
  assert.equal(toggles(), 1, 'two taps within 400 ms');
  key('AltRight', 2000); key('AltRight', 2500);
  assert.equal(toggles(), 1, 'too slow');
  key('AltRight', 3000); key('KeyA', 3100); key('AltRight', 3200);
  assert.equal(toggles(), 1, 'another key in between');
  key('AltLeft', 4000); key('AltLeft', 4100);
  assert.equal(toggles(), 1, 'only the right Option key');
  key('AltRight', 5000); key('AltRight', 5100, { repeat: true }); key('AltRight', 5200);
  assert.equal(toggles(), 2, 'auto-repeat is not a tap');
  active = { tagName: 'TEXTAREA' };
  key('AltRight', 6000); key('AltRight', 6100);
  assert.equal(toggles(), 2, 'not while typing in a text field');
  active = { tagName: 'INPUT', type: 'radio' };
  key('AltRight', 7000); key('AltRight', 7100);
  assert.equal(toggles(), 3, 'a focused radio button is not a text field');
});

test('addon: arrow to the artifacts index, BRUVISH mark, Italian panel, annotate as a labelless pencil switch mirrored to aria-checked', async () => {
  const chrome = upstreamChrome();
  const { head } = await runAddon(new Map(), { chrome });
  assert.equal(chrome.brand.textContent, 'BRUVISH');
  const index = chrome.bar.children[0];
  assert.deepEqual([index.tagName, index.className, index.href, index.textContent, index.attributes['aria-label']], ['A', 'mb-index', '/', '←', 'Indice degli artefatti'], 'the arrow to the catalog home comes first, before the mark');
  assert.equal(chrome.bar.children[1], chrome.brandBox);
  assert.deepEqual([chrome.title.textContent, chrome.send.textContent, chrome.input.placeholder], ['Conversazione', '', 'Scrivi all’agente…']);
  assert.deepEqual([chrome.send.getAttribute('aria-label'),chrome.send.getAttribute('title')],['Invia all’agente','Invia all’agente']);
  assert.equal(chrome.send.children[0].tagName,'SVG');
  assert.deepEqual([chrome.endButton.getAttribute('aria-label'),chrome.endButton.getAttribute('title')],['Invia e chiudi','Invia e chiudi']);
  assert.deepEqual(chrome.endButton.children,[chrome.exit],'send and close keeps only its original icon');
  assert.equal(head.children[0].href, '/mb-catalog-fonts.css', 'the page fonts reach the frame');
  const annotate = chrome.annotate;
  assert.equal(annotate.attributes.role, 'switch');
  assert.equal(annotate.attributes['aria-label'], 'Annota');
  assert.equal(annotate.attributes['aria-checked'], 'true');
  assert.equal(annotate.getAttribute('aria-pressed'), null, 'a switch carries aria-checked, not aria-pressed');
  assert.equal(annotate.attributes.title, 'Annota · doppio tocco di ⌥ destro · ⌘E / Ctrl+E');
  assert.deepEqual(annotate.children.map(c => c.className), ['switch-track'], 'no "Annotate" text');
  const svg = annotate.querySelector('.switch-knob').children[0];
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attributes['aria-hidden'], 'true');
  assert.deepEqual(svg.children.map(c => c.tagName), ['PATH', 'PATH'], 'pencil');
});

test('addon: the annotate switch also toggles with a double tap of the right Option key, and on the artifact\'s request', async () => {
  const chrome = upstreamChrome();
  let active = null;
  const { key, deliver, upstreamToggle } = await runAddon(new Map(), { chrome, active: () => active });
  key('AltRight', 100); key('AltRight', 450);
  assert.equal(chrome.annotate.clicks, 1);
  upstreamToggle(false);
  assert.equal(chrome.annotate.attributes['aria-checked'], 'false', 'upstream state mirrored after the toggle');
  key('AltRight', 1000); key('ShiftLeft', 1100); key('AltRight', 1200);
  key('AltRight', 2000); key('AltRight', 2401);
  assert.equal(chrome.annotate.clicks, 1, 'another key in between, or more than 400 ms');
  active = { tagName: 'TEXTAREA' };
  key('AltRight', 3000); key('AltRight', 3100);
  assert.equal(chrome.annotate.clicks, 1, 'not while writing to the agent');
  active = { tagName: 'DIV', isContentEditable: true };
  key('AltRight', 4000); key('AltRight', 4100);
  assert.equal(chrome.annotate.clicks, 1, 'not in an editable region');
  active = null;
  deliver({ type: 'lavish-mb:annotate-toggle' });
  assert.equal(chrome.annotate.clicks, 2, 'double tap seen inside the artifact');
  chrome.annotate.disabled = true;
  key('AltRight', 5000); key('AltRight', 5100);
  assert.equal(chrome.annotate.clicks, 2, 'an ended session keeps the switch disabled');
});

test('addon: closed-cards switch (check in a circle) remains available whenever the page has cards', async () => {
  const chrome = upstreamChrome();
  const { rail, root, deliver, posted } = await runAddon(new Map(), { chrome });
  const closed = chrome.bar.children.find(el => el.className === 'mb-closed-switch');
  assert(closed, 'closed switch in the bar');
  assert.equal(chrome.bar.children.indexOf(closed), chrome.bar.children.indexOf(chrome.annotate) - 1, 'right before annotate');
  assert.deepEqual([closed.attributes.role, closed.attributes['aria-checked'], closed.attributes['aria-label'], closed.hidden], ['switch', 'false', 'Anche le carte chiuse', true]);
  assert.deepEqual(closed.querySelector('.switch-knob').children[0].children.map(c => c.tagName), ['CIRCLE', 'PATH'], 'check in a circle');
  deliver({ type: 'lavish-mb:ready' });
  assert.deepEqual(posted.filter(m => m.type === 'lavish-mb:closed').map(m => m.show), [false], 'closed cards hidden by default');
  const items = [{ id: 'a', title: 'Carta a', state: 'waiting' }, { id: 'b', title: 'Carta b', state: 'answered', closed: true, hidden: true }];
  const family = { card: 'rgba(38,30,51,0.5)', line: '#4d4360', ink: '#e3e2f5', muted: '#a5b1cb', title: '#49cbbd', field: 'rgba(19,15,27,0.3)' };
  const framePalette = () => Object.fromEntries(Object.keys(family).map(name => [name, root.style.props['--mb-' + name]]));
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1, palette: family });
  assert.equal(closed.hidden, false);
  assert.deepEqual(framePalette(), family, 'a complete family reaches the frame');
  const themeB = Object.fromEntries(Object.keys(family).map(name => [name, undefined]));
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1, palette: { card: '', line: '#e5e5e5', ink: '#1d1d1f', muted: '#6e6e73', title: '', field: '' } });
  assert.deepEqual(framePalette(), themeB, 'a page that defines only some colours gets theme B, never a mix');
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1, palette: family });
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1, palette: { ...family, ink: 'url(x)' } });
  assert.deepEqual(framePalette(), themeB, 'a value that is not a colour drops the whole family');
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1, palette: family });
  deliver({ type: 'lavish-mb:outline', items, closed: 1, open: 1 });
  assert.deepEqual(framePalette(), themeB, 'a revision without a family returns to theme B');
  assert.deepEqual(rail.children.map(b => b.classList.contains('mb-closed')), [false, true], 'the hidden closed card is a dot');
  closed.click();
  assert.equal(closed.attributes['aria-checked'], 'true');
  assert.deepEqual(posted.filter(m => m.type === 'lavish-mb:closed').map(m => m.show), [false, true]);
  closed.click();
  rail.children[1].listeners.click();
  assert.deepEqual(posted.filter(m => ['lavish-mb:closed', 'lavish-mb:reveal'].includes(m.type)).slice(-2).map(m => [m.type, m.show ?? m.id]), [['lavish-mb:closed', true], ['lavish-mb:reveal', 'b']], 'a dot shows the closed cards, then goes there');
  closed.click();
  deliver({ type: 'lavish-mb:show-closed' });
  assert.deepEqual([closed.attributes['aria-checked'], posted.filter(m => m.type === 'lavish-mb:closed').at(-1).show], ['true', true], 'a reveal inside a hidden closed card turns the switch on');
  deliver({ type: 'lavish-mb:outline', items: [{ id: 'a', title: 'Carta a', state: 'answered', closed: true }], closed: 1, open: 0 });
  assert.equal(closed.hidden, false, 'the control stays available on pages containing only answered cards');
});

test('addon: official panel texts turn Italian, also when written later, and the reader\'s own words never change', async () => {
  const text = (value, parent) => { const node = { nodeType: 3, nodeValue: value, parentElement: parent }; parent.children.push(node); return node; };
  const box = (tag, className, parent, attributes = {}) => { const el = element(tag); el.className = className; Object.assign(el.attributes, attributes); if (parent) parent.append(el); return el; };
  const panel = box('aside', 'panel');
  const status = text('Queued ', box('small', '', panel));
  const editor = box('textarea', 'queued-edit-input', panel, { 'aria-label': 'Edit queued prompt' });
  const draft = text('Copy', editor);
  const message = text('Copy', box('div', 'bubble-text', panel));
  const path = box('button', 'menu-file', panel, { title: "Copy path · /tmp/a$&b$'.html" });
  const receipt = box('span', 'receipt-step', panel, { 'aria-label': 'Seen 10:30 AM', title: 'Done: not yet' });
  const selected = text('3 selected', box('span', 'warnings-selected', panel));
  const revisionLabel = text('Working draft', box('span', 'revision-label', panel));
  const revisionSummary = text('Done with layout', box('p', 'revision-summary', panel));
  const revisionCopy = text('Copy', box('span', 'revision-label', panel));
  const chip = text('Seen 3m ago', box('span', 'warning-chip', panel));
  const { observers } = await runAddon(new Map(), { panel });
  assert.deepEqual([status.nodeValue, editor.attributes['aria-label'], path.attributes.title, receipt.attributes['aria-label'], receipt.attributes.title, selected.nodeValue],
    ['In coda ', 'Modifica il messaggio in coda', "Copia il percorso · /tmp/a$&b$'.html", 'Visto 10:30 AM', 'Fatto: non ancora', '3 scelti'], 'a path keeps its characters as they are');
  assert.deepEqual([draft.nodeValue, message.nodeValue], ['Copy', 'Copy'], 'a queued note being edited and a sent message are the reader\'s words');
  assert.deepEqual([revisionLabel.nodeValue, revisionSummary.nodeValue, revisionCopy.nodeValue], ['Working draft', 'Done with layout', 'Copy'], 'revision labels and summaries are the agent\'s words');
  assert.equal(chip.nodeValue, 'Seen 3m ago', 'layout-issue chips stay as the server writes them');
  const written = ['Working...', 'Exporting...', 'Exported with 2 unresolved assets and 1 notice', 'Exported with 1 notice', 'Export failed - retry', 'Reveal 2/3', 'Uploading…',
    'Not sent — more than 4 images on one prompt; an image is no longer available. Remove or fix the image, then send again.', 'Unsupported file type. Use PNG, JPEG, or WEBP.', 'You can attach up to 1 image.']
    .map(value => text(value, box('span', '', panel)));
  const revealRevision = box('button', 'revision-reveal', panel, { 'aria-label': 'Reveal the next block changed in Working draft' });
  const revealWarning = box('button', 'warning-action', panel, { 'aria-label': 'Reveal Text overflow on .card in the artifact' });
  const dismissWarning = box('button', 'warning-action', panel, { 'aria-label': 'Dismiss Text overflow for this artifact revision' });
  const chipCopy = box('span', 'chat-attachment-copy', panel);
  const fileName = text('Copy', box('strong', '', chipCopy));
  const retry = box('button', '', panel, { 'aria-label': 'Retry Copy.png' });
  const thumbnail = box('img', 'bubble-attachment', panel, { title: 'Remove background.png' });
  const expired = box('span', 'bubble-attachment bubble-attachment-expired', panel, { title: 'Select area on map.png' });
  const expiredText = text('Image expired', expired);
  const more = box('span', 'bubble-attachment-more', panel, { title: '2 more images' });
  const unread = box('div', 'panel-summary is-unread', panel);
  const unreadText = text('Copy', unread);
  const summary = text('2 queued', box('div', 'panel-summary', panel));
  const revisionTime = text('Done 10:30', box('span', 'revision-time', panel));
  const endedPath = text('Remove me.html', box('p', 'ended-copy', panel));
  const later = text('Cancel', box('button', 'queued-edit-cancel', panel));
  observers.find(o => o.target === panel).fn([{ type: 'childList', addedNodes: [later] }]);
  observers.find(o => o.target === panel).fn([...written, revealRevision, revealWarning, dismissWarning, chipCopy, retry, thumbnail, expired, more, unread, summary.parentElement, revisionTime.parentElement, endedPath.parentElement].map(node => ({ type: 'childList', addedNodes: [node] })));
  assert.deepEqual(written.map(node => node.nodeValue), ['L’agente sta lavorando…', 'Esportazione…', 'Esportato con 2 risorse non risolte e 1 avviso', 'Esportato con 1 avviso', 'Esportazione non riuscita: riprova', 'Mostra 2/3', 'Caricamento…',
    'Non inviato: più di 4 immagini in un messaggio; un’immagine non è più disponibile. Togli o correggi l’immagine, poi invia di nuovo.', 'Tipo di file non supportato. Usa PNG, JPEG o WEBP.', 'Puoi allegare fino a 1 immagine.']);
  assert.deepEqual([revealRevision, revealWarning, dismissWarning, retry].map(el => el.attributes['aria-label']),
    ['Mostra il blocco successivo cambiato in Working draft', 'Mostra Text overflow on .card nell’artefatto', 'Ignora Text overflow per questa revisione dell’artefatto', 'Riprova Copy.png'], 'the agent\'s label, the server\'s title and the file name stay verbatim');
  assert.equal(fileName.nodeValue, 'Copy', 'an attachment file name is the reader\'s');
  assert.deepEqual([thumbnail.attributes.title, expired.attributes.title, expiredText.nodeValue, more.attributes.title], ['Remove background.png', 'Select area on map.png', 'Immagine scaduta', '2 altre immagini'], 'thumbnail titles are file names; the official words around them still turn Italian');
  assert.deepEqual([unreadText.nodeValue, summary.nodeValue], ['Copy', '2 in coda'], 'the unread reply preview is the agent\'s words, the other summaries are official');
  assert.deepEqual([revisionTime.nodeValue, endedPath.nodeValue], ['Done 10:30', 'Remove me.html'], 'a revision time from the agent and the session file path stay verbatim');
  assert.equal(later.nodeValue, 'Annulla', 'text the official code writes later');
});

test('interview: a first tap selects an option, a second tap on the same option queues the answer', () => {
  const listeners = {}, submitted = [];
  class HTMLInputElement { constructor(value) { this.type = 'radio'; this.value = value; this.checked = false; this.label = { classes: new Set(), classList: null }; this.label.classList = { add: c => this.label.classes.add(c), remove: c => this.label.classes.delete(c) }; } closest() { return this.label; } }
  const yes = new HTMLInputElement('yes'), no = new HTMLInputElement('no');
  const status = { textContent: '' };
  const form = { dataset: { mbQuestion: 'q0' }, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, requestSubmit() { submitted.push((yes.checked && 'yes') || (no.checked && 'no')); }, querySelector: s => s === '.queue-status' ? status : null };
  const document = { documentElement: { dataset: {} }, readyState: 'complete', querySelectorAll: s => s === '[data-mb-question]' ? [form] : s === '.mb-armed' ? [yes, no].map(i => i.label).filter(l => l.classes.has('mb-armed')) : [], addEventListener() { } };
  vm.runInNewContext(artifactJs, { document, navigator: { userAgent: '' }, matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null }, MutationObserver: class { observe() { } }, HTMLInputElement, FormData: class { }, CustomEvent: class { } });
  const tap = input => { yes.checked = no.checked = false; input.checked = true; listeners.click.forEach(fn => fn({ target: input })); };
  tap(yes);
  assert.deepEqual(submitted, [], 'first tap only selects');
  assert(yes.label.classes.has('mb-armed'), 'the selected option asks for a second tap');
  tap(no);
  assert.deepEqual(submitted, [], 'a different option is a new first tap');
  assert.deepEqual([yes.label.classes.has('mb-armed'), no.label.classes.has('mb-armed')], [false, true]);
  tap(no);
  assert.deepEqual(submitted, ['no'], 'second tap on the same option queues it');
  listeners.click.forEach(fn => fn({ target: { tagName: 'LABEL' } }));
  assert.deepEqual(submitted, ['no'], 'the click on the label itself is not a tap');
});
