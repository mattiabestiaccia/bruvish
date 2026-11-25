// The cascade and horizontal layout of the test pages, shared by blocks.test.mjs and review-tree-widths.test.mjs.
import assert from 'node:assert/strict';

// The declarations that reach one element through the cascade of a style sheet: every rule whose selector matches the
// element (with its ancestors and earlier siblings), by importance, then specificity, then source order.
export function computed(css, el, width = 1024) {
  const split = (text, sep) => { const out = []; let depth = 0, quote = '', cur = ''; for (const c of text) { if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === sep && !depth) { out.push(cur); cur = ''; continue; } cur += c; } return [...out, cur].map(x => x.trim()).filter(Boolean); };
  const rules = [];
  const walk = text => { for (let at = 0, open; (open = text.indexOf('{', at)) >= 0;) {
    let end = open + 1; for (let depth = 1; depth; end++) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0;
    const prelude = text.slice(at, open).trim(), body = text.slice(open + 1, end - 1);
    if (/^@media\b/.test(prelude)) {
      const limits = [...prelude.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
      if (limits.every(([, kind, px]) => kind === 'min' ? width >= Number(px) : width <= Number(px))) walk(body);
    } else if (/^@supports\b/.test(prelude)) walk(body); else if (!prelude.startsWith('@')) rules.push({ selectors: split(prelude, ','), body });
    at = end;
  } };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  const PART = /([a-z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=("[^"]*"|'[^']*'|[^\]]*))?\]|:not\(([^()]*)\)|:where\(([^()]*)\)|(::?[\w-]+(?:\([^()]*\))?)/gy;
  const compound = (node, text) => { let ok = true, spec = [0, 0, 0], m; const part = new RegExp(PART);
    while (part.lastIndex < text.length) {
      const start = part.lastIndex; if (!(m = part.exec(text)) || m.index !== start) throw new Error('selector not supported by the test cascade: ' + text);
      if (m[1]) { spec[2] += m[1] !== '*'; ok &&= m[1] === '*' || node.tagName === m[1]; }
      else if (m[2]) { spec[0]++; ok &&= node.id === m[2]; }
      else if (m[3]) { spec[1]++; ok &&= node.classList.contains(m[3]); }
      else if (m[4]) { spec[1]++; ok &&= m[4] in node.attributes && (m[5] === undefined || node.attributes[m[4]] === m[5].replace(/^["']|["']$/g, '')); }
      else if (m[6] !== undefined) { const inner = compound(node, m[6]); spec = spec.map((n, i) => n + inner.spec[i]); ok &&= !inner.ok; }
      else if (m[7] !== undefined) ok &&= compound(node, m[7]).ok;
      else if (m[8].startsWith(':has(')) { const inner = m[8].slice(5, -1), result = compound(node, inner); spec = spec.map((n, i) => n + result.spec[i]); ok &&= !!node.querySelector?.(inner); }
      else { spec[m[8].startsWith('::') ? 2 : 1]++; ok &&= m[8] === ':root' && node.tagName === 'html'; }
    }
    return { ok: ok && !!node.tagName && node.tagName !== '#root', spec };
  };
  const before = node => { const list = node.parent?.elements || []; return list.slice(0, list.indexOf(node)).reverse(); };
  const match = (node, parts, i) => { if (!node || !compound(node, parts[i]).ok) return false; if (i === 0) return true;
    const step = parts[i - 1];
    const tries = step === '>' ? [node.parent] : step === '+' ? before(node).slice(0, 1) : step === '~' ? before(node) : (() => { const up = []; for (let p = node.parent; p; p = p.parent) up.push(p); return up; })();
    return tries.some(other => match(other, parts, i - 2)); };
  const found = [];
  rules.forEach((rule, order) => rule.selectors.forEach(selector => {
    const parts = selector.replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).flatMap((p, i, all) => i && !'>+~'.includes(p) && !'>+~'.includes(all[i - 1]) ? [' ', p] : [p]);
    if (!match(el, parts, parts.length - 1)) return;
    const spec = parts.filter((p, i) => i % 2 === 0).reduce((sum, p) => compound({ tagName: '', id: '', classList: { contains: () => false }, attributes: {} }, p).spec.map((n, i) => n + sum[i]), [0, 0, 0]);
    split(rule.body, ';').forEach(declaration => { const colon = declaration.indexOf(':'); const value = declaration.slice(colon + 1).trim();
      found.push({ name: declaration.slice(0, colon).trim(), value: value.replace(/\s*!important$/, ''), rank: [/!important$/.test(value) ? 1 : 0, ...spec, order] }); });
  }));
  found.sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; });
  return Object.fromEntries(found.map(d => [d.name, d.value]));
}

// A CSS length in px: px, %, vw, var() and calc/min/max/clamp; % against `base`, vw against the viewport.
export function cssLength(value, base, viewport, lookup = () => undefined) {
  if (value === undefined || value === 'auto' || value === 'none') return NaN;
  for (let v; (v = /var\((--[\w-]+)\)/.exec(value));) value = value.replace(v[0], lookup(v[1]) ?? 'NaN');
  const expr = value.replace(/calc\(/g, '(').replace(/(\d*\.?\d+)(px|%|vw)?/g, (_, n, unit) => unit === '%' ? `(${n}*${base}/100)` : unit === 'vw' ? `(${n}*${viewport}/100)` : n);
  assert.match(expr, /^(?:[\d.+\-*/(), ]|min|max|clamp|NaN)*$/, 'length not supported by the test layout: ' + value);
  return Function('min', 'max', 'clamp', 'return ' + expr)(Math.min, Math.max, (lo, v, hi) => Math.max(lo, Math.min(v, hi)));
}

// The horizontal box of an element laid out by the cascade, in px from the left of its parent's content box: block
// width auto fills the parent, max-width caps it, auto margins share the free space; border-box sizing, as
// `*{box-sizing:border-box}` sets. Longhands (margin-left, margin-inline) win over the shorthand.
export function layoutBox(css, el, viewport) {
  if (!el.parent?.tagName || el.parent.tagName === '#root') return { left: 0, width: viewport, border: [0, 0], inner: viewport, innerLeft: 0, parent: viewport };
  const look = computed(css, el, viewport), base = layoutBox(css, el.parent, viewport).inner;
  const lookup = name => { for (let n = el; n?.tagName; n = n.parent) { const v = computed(css, n, viewport)[name]; if (v !== undefined) return v; } };
  const words = value => { const out = []; let depth = 0, cur = ''; for (const c of value + ' ') { depth += c === '(' ? 1 : c === ')' ? -1 : 0; if (c === ' ' && !depth) { if (cur) out.push(cur); cur = ''; } else cur += c; } return out; };
  const length = value => cssLength(value, base, viewport, lookup);
  const sides = prop => {
    const all = words(look[prop] ?? '0'), inline = look[prop + '-inline'] && words(look[prop + '-inline']);
    return [look[prop + '-left'] ?? inline?.[0] ?? all[3] ?? all[1] ?? all[0], look[prop + '-right'] ?? inline?.[1] ?? inline?.[0] ?? all[1] ?? all[0]].map(length);
  };
  const [ml, mr] = sides('margin'), padding = sides('padding'), edge = words(look.border ?? '0')[0], border = [0, 0].map(() => /^\d/.test(edge) ? length(edge) : 0);
  let width = length(look.width);
  if (Number.isNaN(width)) width = base - (ml || 0) - (mr || 0);
  if (!Number.isNaN(length(look['max-width']))) width = Math.min(width, length(look['max-width']));
  const free = base - width - (ml || 0) - (mr || 0), left = Number.isNaN(ml) ? (Number.isNaN(mr) ? free / 2 : free) : ml;
  return { left, width, border, inner: width - padding[0] - padding[1] - border[0] - border[1], innerLeft: left + border[0] + padding[0], parent: base };
}
