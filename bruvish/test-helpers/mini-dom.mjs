// A small DOM built from a rendered page, enough to run the page scripts in node:vm: elements, attributes, dataset,
// classList, hidden, value/checked, text, createElement, insertion, events with capture and bubble phases, and
// selectors made of tags, #id, .class, [attr] and [attr="value"] joined by descendant or child combinators.
const VOID = new Set(['input', 'meta', 'br', 'img', 'hr', 'link']);
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|amp);/gi, (_, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === 'x' ? 2 : 1), e[1].toLowerCase() === 'x' ? 16 : 10)) : ({ lt: '<', gt: '>', quot: '"', amp: '&' })[e]);
const camel = name => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = key => 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

export function createDocument(html) {
  html = html.replace(/\r\n?/g, '\n');
  const document = { listeners: {} };
  const make = (tagName, attributes = {}) => {
    const el = {
      tagName, attributes: { ...attributes }, children: [], parent: null, listeners: {}, scrolled: 0,
      style: { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] || ''; } },
      value: attributes.value ?? '', checked: 'checked' in attributes,
      get type() { return this.attributes.type || ''; },
      get name() { return this.attributes.name || ''; },
      get id() { return this.attributes.id || ''; },
      set id(v) { this.attributes.id = v; },
      get className() { return this.attributes.class || ''; },
      set className(v) { this.attributes.class = v; },
      get hidden() { return 'hidden' in this.attributes; },
      set hidden(v) { if (v) this.attributes.hidden = ''; else delete this.attributes.hidden; },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      hasAttribute(k) { return k in this.attributes; },
      get classList() {
        const self = this, list = () => (self.attributes.class || '').split(/\s+/).filter(Boolean), write = l => { self.attributes.class = l.join(' '); };
        return { contains: c => list().includes(c), add: (...cs) => write([...new Set([...list(), ...cs])]), remove: (...cs) => write(list().filter(c => !cs.includes(c))),
          toggle(c, force) { const on = force === undefined ? !list().includes(c) : !!force; if (on) this.add(c); else this.remove(c); return on; } };
      },
      get dataset() {
        const self = this;
        return new Proxy({}, { get: (_, k) => self.attributes[kebab(String(k))], set: (_, k, v) => { self.attributes[kebab(String(k))] = String(v); return true; },
          has: (_, k) => kebab(String(k)) in self.attributes, deleteProperty: (_, k) => { delete self.attributes[kebab(String(k))]; return true; },
          ownKeys: () => Object.keys(self.attributes).filter(k => k.startsWith('data-')).map(camel), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
      },
      get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); },
      set textContent(v) { this.children = v === '' ? [] : [String(v)]; },
      get elements() { return this.children.filter(c => typeof c !== 'string'); },
      get nextElementSibling() { const s = this.parent?.elements || []; return s[s.indexOf(this) + 1] ?? null; },
      get form() { return this.closest('form'); },
      get ownerDocument() { return document; },
      append(...nodes) { for (const n of nodes) { if (typeof n !== 'string') { n.remove(); n.parent = this; } this.children.push(n); } },
      appendChild(node) { this.append(node); return node; },
      after(node) { node.remove(); const i = this.parent.children.indexOf(this); node.parent = this.parent; this.parent.children.splice(i + 1, 0, node); },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
      contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; },
      focus() { document.activeElement = this; },
      scrollIntoView() { this.scrolled++; },
      addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, capture: options === true || !!options?.capture }); },
      matches(selector) { return matchesList(this, selector, null); },
      closest(selector) { for (let el = this; el; el = el.parent) if (el.tagName && el.matches(selector)) return el; return null; },
      querySelectorAll(selector) { const found = [], visit = el => el.elements.forEach(c => { if (matchesList(c, selector, this)) found.push(c); visit(c); }); visit(this); return found; },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      click() { return dispatch(this, 'click'); },
      requestSubmit() { return dispatch(this, 'submit'); },
    };
    return el;
  };
  const root = make('#root'), stack = [root];
  for (const [, text, close, tag, attrs] of html.matchAll(/([^<]*)(?:<(\/?)([a-zA-Z0-9]+)([^>]*)>|$)/g)) {
    if (text && stack.at(-1).tagName !== 'script' && stack.at(-1).tagName !== 'style') stack.at(-1).children.push(decode(text));
    if (!tag) continue;
    const name = tag.toLowerCase();
    if (close) { while (stack.length > 1 && stack.pop().tagName !== name); continue; }
    const el = make(name, Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, decode(v ?? '')])));
    if (name === 'textarea') el.valueFromText = true;
    el.parent = stack.at(-1); el.parent.children.push(el);
    if (!VOID.has(name)) stack.push(el);
  }
  for (const t of root.querySelectorAll('textarea')) t.value = t.textContent;
  root.querySelectorAll('[data-mb-question]').forEach(form => form.querySelectorAll('input').forEach(input => {
    // Radio groups: checking one option unchecks the others of the same form and name.
    let checked = input.checked;
    Object.defineProperty(input, 'checked', { get: () => checked, set: v => { if (v && input.type === 'radio') form.querySelectorAll('input').filter(o => o !== input && o.name === input.name).forEach(o => { o.checked = false; }); checked = !!v; } });
  }));
  function dispatch(target, type, init = {}) {
    let stopped = false, immediate = false, prevented = false;
    const event = { type, target, ...init, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = immediate = true; }, get defaultPrevented() { return prevented; } };
    const path = []; for (let n = target; n; n = n.parent) path.push(n);
    path.push(document);
    const run = (node, capture) => { for (const l of [...(node.listeners[type] || [])]) { if (immediate) return; if (l.capture === capture || node === target) { event.currentTarget = node; l.fn(event); } } };
    for (const node of [...path].reverse().slice(0, -1)) { if (stopped) return event; run(node, true); }
    if (!stopped) { event.currentTarget = target; for (const l of [...(target.listeners[type] || [])]) { if (immediate) break; l.fn(event); } }
    if (init.bubbles !== false) for (const node of path.slice(1)) { if (stopped) break; run(node, false); }
    return event;
  }
  const html_ = root.querySelector('html') || root;
  Object.assign(document, {
    root, documentElement: html_, readyState: 'complete', activeElement: null, dispatch,
    querySelectorAll: s => root.querySelectorAll(s), querySelector: s => root.querySelector(s),
    getElementById: id => root.querySelectorAll('[id]').find(el => el.id === id) ?? null,
    createElement: tag => make(tag.toLowerCase()),
    addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, capture: options === true || !!options?.capture }); },
  });
  return document;
}

// A window for node:vm around a document: messages from the parent, a Lavish SDK stub that records queued prompts.
export function createWindow(document, { lavish = true, hash = '' } = {}) {
  const listeners = {}, parent = {};
  const window = {
    document, parent, queued: [], location: { hash }, history: { replaceState: (a, b, url) => { window.location.hash = url; } },
    resizeObservers: [],
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; window.resizeObservers.push(this); }
      observe(target) { this.target = target; }
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    post(data) { (listeners.message || []).forEach(fn => fn({ source: parent, data })); },
    fire(type, event = {}) { (listeners[type] || []).forEach(fn => fn(event)); },
    JSON, Map, Set, Array, String, Number, Object, decodeURIComponent,
  };
  if (lavish) window.lavish = { queuePrompt: (prompt, options) => window.queued.push({ prompt, ...options }) };
  window.window = window;
  // artifact.js checks event targets with instanceof: the inputs of this DOM count as input elements.
  window.HTMLInputElement = class { static [Symbol.hasInstance](el) { return el?.tagName === 'input'; } };
  return window;
}

function matchesList(el, list, scope) {
  return splitList(list).some(selector => {
    const tokens = selector.trim().replace(/\s*>\s*/g, ' > ').match(/(?:[^\s"[]+|\[[^\]]*\])+/g);
    const compound = (node, token) => {
      if (token === ':scope') return node === scope;
      if (!node.tagName || node.tagName === '#root') return false;
      if (token.endsWith(':checked')) { if (!node.checked) return false; token = token.slice(0, -8); }
      const excluded = [];
      token = token.replace(/:not\(([^()]*)\)/g, (_, inner) => { excluded.push(inner); return ''; });
      if (excluded.some(inner => compound(node, inner))) return false;
      const m = /^([a-z0-9*]*)((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:"(?:[^"\\]|\\.)*"|'[^']*'))?\])*)$/.exec(token);
      if (!m) throw new Error('selector not supported by the test DOM: ' + token);
      const plain = m[2].replace(/\[[^\]]*\]/g, '');
      return (!m[1] || m[1] === '*' || node.tagName === m[1])
        && [...plain.matchAll(/#([\w-]+)/g)].every(c => node.id === c[1])
        && [...plain.matchAll(/\.([\w-]+)/g)].every(c => node.classList.contains(c[1]))
        && [...m[2].matchAll(/\[([\w-]+)(?:=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'))?\]/g)].every(a => {
          const value = a[2] ?? a[3];
          if (value !== undefined && /[\n\r\f]/.test(value)) throw new Error('unescaped newline in a CSS string');
          const decoded = value?.replace(/\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|([^\r\n\f]))/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char);
          return a[1] in node.attributes && (value === undefined || node.attributes[a[1]] === decoded);
        });
    };
    const from = (node, i) => {
      if (!node || !compound(node, tokens[i])) return false;
      if (i === 0) return true;
      if (tokens[i - 1] === '>') return from(node.parent, i - 2);
      for (let up = node.parent; up; up = up.parent) if (from(up, i - 1)) return true;
      return false;
    };
    return from(el, tokens.length - 1);
  });
}
function splitList(list) {
  const out = []; let depth = 0, quote = false, cur = '';
  for (const c of list) { if (c === '"') quote = !quote; if (!quote && c === '[') depth++; if (!quote && c === ']') depth--; if (c === ',' && !depth && !quote) { out.push(cur); cur = ''; } else cur += c; }
  return [...out, cur];
}
