// Building blocks of the renderer beyond the interview cards (tabs, header, pills, tones, labels, help, tables,
// notes, diffs with line comments, free text in answers, events). Every field is optional: a page without them
// renders exactly as before, with the same assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderDocument, cardFingerprint, parseDiff } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const asset = name => readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
const [fontsCss, baseCss, baseJs, blocksCss, blocksJs] = await Promise.all(['fonts.css', 'artifact.css', 'artifact.js', 'artifact-blocks.css', 'artifact-blocks.js'].map(n => asset(n).catch(() => '')));
const example = async name => JSON.parse(await readFile(new URL('../examples/' + name + '.json', import.meta.url), 'utf8'));
const doc = (cards, extra = {}) => ({ title: 'Prova', guide: 'Leggi.', sections: [{ id: 's', title: 'Sezione', cards }], ...extra });
const card = (extra = {}) => ({ id: 'a', title: 'Una carta', paragraphs: ['Testo.'], ...extra });
const render = (input, options = {}) => renderDocument(input, { id: 'fixture', ...options });
const cardHtml = (html, id = 'a') => html.match(new RegExp('<article class="card" id="' + id + '"[\\s\\S]*?</article>'))[0];
const sha = text => createHash('sha256').update(text).digest('hex');
// The page without its embedded stylesheet and script, so a deliberate change of the shared assets does not move it.
const skeleton = html => html.replace(/<style>[\s\S]*?<\/style><script>[\s\S]*?<\/script>/, '<style/><script/>');
const styleOf = html => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const scriptOf = html => /<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1];

// Runs the page scripts on a small DOM of the rendered page.
function boot(html, options) {
  const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
  const window = createWindow(document, options);
  vm.runInNewContext(scriptOf(html), window);
  return { document, window };
}

// The declarations that reach one element through the cascade of a style sheet: every rule whose selector matches the
// element (with its ancestors and earlier siblings), by importance, then specificity, then source order.
function computed(css, el, width = 1024) {
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

test('pages without the new fields render byte for byte as before, with the base assets only', async () => {
  // Hashes of the page skeleton computed on carry before the building blocks existed (5f9757a).
  const before = { dummy: '8c899f6300efd2e1b560bc1e4d5270fae7bb2d95cefb32caa353a58c06698f99', 'carte-complete': '14a5287082fb19399da30e8d483253b8b64ae47afb77eee5cdf649181ae6258e' };
  for (const [name, hash] of Object.entries(before)) {
    const html = await render(await example(name));
    assert.equal(sha(skeleton(html)), hash, name);
    assert.equal(styleOf(html), fontsCss + '\n' + baseCss, name + ': stylesheet');
    assert.equal(scriptOf(html), baseJs, name + ': script');
  }
});

test('a card tone colours the card and its minimap entry; the page then carries the building-block assets', async () => {
  const html = await render(doc([card({ tone: 'decidi', status: 'waiting' }), card({ id: 'b', tone: 'verde' })]));
  assert.match(cardHtml(html), /^<article class="card" id="a" data-mb-state="waiting" data-mb-tone="decidi">/);
  assert.match(cardHtml(html, 'b'), /data-mb-state="info" data-mb-tone="verde"/);
  assert.equal(styleOf(html), fontsCss + '\n' + baseCss + '\n' + blocksCss);
  assert.equal(scriptOf(html), baseJs + '\n' + blocksJs);
  await assert.rejects(render(doc([card({ tone: 'fucsia' })])), /Card a: tone must be one of blu, verde, giallo, rosso, decidi, viola/);
});

test('labels sit right after the card title, on the same line, with inline marks and a tone', async () => {
  const html = await render(doc([card({ labels: [{ text: '**Bloccante** <b>', tone: 'rosso' }, { text: 'tipo `doc`', tone: 'blu' }] })]));
  assert.match(cardHtml(html), /<div class="mb-card-head"><h3>Una carta<\/h3><span class="mb-labels"><span class="mb-label" data-tone="rosso"><strong>Bloccante<\/strong> &lt;b&gt;<\/span><span class="mb-label" data-tone="blu">tipo <code>doc<\/code><\/span><\/span><\/div><p>/);
  for (const labels of ['x', [{ text: '', tone: 'blu' }], [{ text: 'a', tone: 'nero' }], [{ tone: 'blu' }]])
    await assert.rejects(render(doc([card({ labels })])), /Card a: labels/);
});

test('help opens with a click on «?» in the flow of the card, closes with another click, never on hover, and is not read aloud', async () => {
  const html = await render(doc([card({ help: 'Serve a **decidere**. Poi chiudi.' })]));
  const body = cardHtml(html);
  assert.match(body, /<div class="mb-card-head"><h3>Una carta<\/h3><button class="mb-help-toggle" type="button" data-mb-help aria-expanded="false" aria-controls="mb-help-a" aria-label="A cosa serve questa carta">\?<\/button><\/div><div class="mb-help" id="mb-help-a" hidden><b class="mb-help-title">A cosa ti serve<\/b><p><span class="sentence">Serve a <strong>decidere<\/strong>.<\/span><span class="sentence">Poi chiudi.<\/span><\/p><\/div><p>/);
  const { document, window } = boot(html);
  const button = document.querySelector('[data-mb-help]'), panel = document.getElementById('mb-help-a');
  for (const type of ['mouseover', 'mouseenter', 'pointerover', 'pointerenter', 'focus', 'focusin']) document.dispatch(button, type);
  assert.equal(panel.hidden, true, 'hover and focus leave the help closed');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  assert.equal(panel.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  // The voice reads title and body, not the help.
  const spoken = [];
  Object.assign(window, { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { speaking: false, speak: u => spoken.push(u.text), cancel() {} } });
  document.querySelector('[data-mb-voice]').click();
  assert.deepEqual(spoken, ['Una carta Testo.']);
  await assert.rejects(render(doc([card({ help: '' })])), /Card a: help/);
});

test('voice sits left of the corner help with a gap at every card breakpoint, and the bubble stays below both', async () => {
  for (const theme of ['B', 'F', 'E2', 'G2', 'D3', 'revisione']) {
    const html = await render(doc([card({ help: 'Serve.' }), card({ id: 'plain' })], { theme }));
    const { document } = boot(html), css = styleOf(html), container = document.getElementById('a');
    const voice = container.querySelector('.voice'), toggle = container.querySelector('[data-mb-help]');
    for (const width of [1024, 601, 600, 390, 240]) {
      const look = el => computed(css, el, width), px = value => parseFloat(value) || 0;
      const cardLook = look(container), voiceLook = look(voice), toggleLook = look(toggle);
      assert.equal(voiceLook.float, 'right');
      assert.equal(toggleLook.position, 'absolute');
      assert.equal(toggleLook.right, '10px');
      assert.equal(toggleLook.top, '10px');
      const voiceRight = px(cardLook['padding-right'] || cardLook.padding) + px(voiceLook['margin-right']);
      const helpLeft = px(toggleLook.right) + px(toggleLook.width);
      assert(voiceRight > helpLeft, theme + ' at ' + width + ': voice and help have separate hit areas');
      assert.equal(look(document.getElementById('plain').querySelector('.voice'))['margin-right'], undefined);
      assert.equal(look(container.querySelector('.mb-help')).clear, 'both', 'the bubble cannot paint under the floated voice');
    }
    toggle.click();
    assert.equal(container.querySelector('.mb-help').hidden, false);
  }
});

test('help controls always open their own panels when provided and generated IDs would collide, regardless of order', async () => {
  const cards = [card({ help: 'Uno.' }), card({ id: 'a-', help: 'Due.' }), card({ id: 'mb-help-a-', help: 'Tre.' })];
  const section = { id: 's', title: 'Sezione', cards };
  const colliding = { id: 'mb-help-a', title: 'Un altro pannello', cards: [card({ id: 'mb-help-a--', help: 'Quattro.' })] };
  for (const sections of [[section, colliding], [colliding, section]]) {
    const html = await render({ title: 'Prova', guide: 'Leggi.', sections });
    const { document } = boot(html);
    const ids = createDocument(html.replace(/<(style|script)\b([^>]*)>[\s\S]*?<\/\1>/g, '<$1$2></$1>')).querySelectorAll('[id]').map(el => el.id);
    assert.equal(new Set(ids).size, ids.length, 'HTML IDs are unique across all sections, cards, help and records');
    for (const button of document.querySelectorAll('[data-mb-help]')) {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      assert(panel.classList.contains('mb-help'));
      assert.equal(panel.closest('article'), button.closest('article'));
      button.click();
      assert.equal(panel.hidden, false);
      assert.equal(button.closest('section').hidden, false);
      button.click();
      assert.equal(panel.hidden, true);
    }
  }
  for (const id of ['usage-guide', 'mb-state', 'mb-render']) {
    await assert.rejects(render(doc([card({ id })])), /unique stable id/);
    await assert.rejects(render({ title: 'Prova', guide: 'Leggi.', sections: [{ id, title: 'Sezione', cards: [card()] }] }), /unique stable id/);
  }
});

test('the header carries a badge with a closed set of inline icons, a subtitle and meta items; pills follow under it', async () => {
  const header = { badge: { text: 'Aperta', tone: 'verde', icon: 'open' }, subtitle: 'Unisce `fase2` in `carry`', meta: ['repo **bruvish**', 'oggi <b>'] };
  const html = await render(doc([card()], { header, intro: 'Una frase.', pills: [{ text: 'rischio **basso**', tone: 'verde' }, { text: 'tocca la sandbox', tone: 'decidi' }] }));
  const head = /<header>[\s\S]*?<\/header>/.exec(html)[0];
  assert.match(head, /^<header><div class="mb-header-meta"><span class="mb-badge" data-tone="verde"><svg class="mb-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1\.5 3\.25[^"]*"><\/path><\/svg>Aperta<\/span><span class="mb-meta-item">repo <strong>bruvish<\/strong><\/span><span class="mb-meta-item">oggi &lt;b&gt;<\/span><\/div><h1>Prova<\/h1><p class="mb-subtitle">Unisce <code>fase2<\/code> in <code>carry<\/code><\/p><p><span class="sentence">Una frase\.<\/span><\/p><div class="mb-pills"><span class="mb-pill" data-tone="verde">rischio <strong>basso<\/strong><\/span><span class="mb-pill" data-tone="decidi">tocca la sandbox<\/span><\/div><\/header>$/);
  for (const icon of ['open', 'merged', 'closed', 'draft', 'check', 'x', 'dot']) {
    const page = await render(doc([card()], { header: { badge: { text: 'Stato', tone: 'viola', icon } } }));
    assert.match(page, /<span class="mb-badge" data-tone="viola"><svg class="mb-icon" viewBox="0 0 16 16"[^>]*><path fill="currentColor" d="M[0-9][^"]+"><\/path><\/svg>Stato<\/span>/, icon);
  }
  assert.match(await render(doc([card()], { header: { badge: { text: 'Senza icona', tone: 'blu' } } })), /<span class="mb-badge" data-tone="blu">Senza icona<\/span>/);
  await assert.rejects(render(doc([card()], { header: { badge: { text: 'x', tone: 'blu', icon: 'rocket' } } })), /header\.badge\.icon must be one of open, merged, closed, draft, check, x, dot/);
  await assert.rejects(render(doc([card()], { header: { badge: { text: '', tone: 'blu' } } })), /header\.badge/);
  await assert.rejects(render(doc([card()], { header: { meta: 'x' } })), /header\.meta/);
  await assert.rejects(render(doc([card()], { pills: [{ text: 'x' }] })), /pills must be an array/);
  const license = await readFile(new URL('../licenses/Octicons-MIT.txt', import.meta.url), 'utf8');
  assert.match(license, /MIT License[\s\S]*GitHub/);
});

test('a card table has headers and rows; « · » puts two items on two lines; a { text, tone } cell is a level', async () => {
  const table = { headers: ['File', 'Rischio', 'Nota'], rows: [['`a.js` · `b.js`', { text: 'alto', tone: 'rosso' }, '**sì** <i>'], ['c', { text: 'basso', tone: 'verde' }, '']] };
  const body = cardHtml(await render(doc([card({ fields: [{ label: 'Oggi', paragraphs: ['Uno.'] }], table })])));
  assert.match(body, /<\/table><table class="mb-table"><thead><tr><th scope="col">File<\/th><th scope="col">Rischio<\/th><th scope="col">Nota<\/th><\/tr><\/thead><tbody><tr><td><code>a\.js<\/code><br><code>b\.js<\/code><\/td><td><span class="mb-level" data-tone="rosso">alto<\/span><\/td><td><strong>sì<\/strong> &lt;i&gt;<\/td><\/tr><tr><td>c<\/td><td><span class="mb-level" data-tone="verde">basso<\/span><\/td><td><\/td><\/tr><\/tbody><\/table>/, 'after the fields');
  assert.match(cardHtml(await render(doc([card({ table: { rows: [['x']] } })]))), /<table class="mb-table"><tbody><tr><td>x<\/td><\/tr><\/tbody><\/table>/, 'headers are optional');
  for (const bad of [[], { rows: 'x' }, { headers: ['a'], rows: [['x', 'y']] }, { rows: [[1]] }, { rows: [[{ text: 'x', tone: 'nero' }]] }])
    await assert.rejects(render(doc([card({ table: bad })])), /Card a: table/);
});

test('secondary notes close the card in grey italics, under a dashed line', async () => {
  const q = { options: [{ value: 'a', label: 'A', recommended: true }] };
  const body = cardHtml(await render(doc([card({ question: q, notes: ['Prima nota. Seconda frase.', '`x` <y>'] })])));
  assert.match(body, /<\/form><div class="mb-notes"><p><span class="sentence">Prima nota\.<\/span><span class="sentence">Seconda frase\.<\/span><\/p><p><span class="sentence"><code>x<\/code> &lt;y&gt;<\/span><\/p><\/div><\/article>$/);
  for (const notes of ['x', ['']]) await assert.rejects(render(doc([card({ notes })])), /Card a: notes/);
  await assert.rejects(render(doc([card({ notes: [3] })])), /A sentence is a string/);
});

test('events are one line each with a dot in their tone', async () => {
  const body = cardHtml(await render(doc([card({ table: { rows: [['x']] }, events: [{ text: 'Aperta da **Mattia**', tone: 'verde' }, { text: 'Unita <b>', tone: 'viola' }] })])));
  assert.match(body, /<\/table><div class="mb-events"><div class="mb-event"><span class="mb-dot" data-tone="verde"><\/span><span>Aperta da <strong>Mattia<\/strong><\/span><\/div><div class="mb-event"><span class="mb-dot" data-tone="viola"><\/span><span>Unita &lt;b&gt;<\/span><\/div><\/div>/);
  await assert.rejects(render(doc([card({ events: [{ text: 'x', tone: 'nero' }] })])), /Card a: events/);
});

const DIFF = `diff --git a/src/a.js b/src/a.js
index 1111111..2222222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,4 +1,4 @@ function a() {
 const uno = 1;
-const due = "<b>2</b>";
+const due = '<script>alert(2)</script>';
+--- non una testata
 const tre = 3;
diff --git a/docs/nuovo.md b/docs/nuovo.md
new file mode 100644
--- /dev/null
+++ b/docs/nuovo.md
@@ -0,0 +1,2 @@
+# Titolo
+Riga & due
\\ No newline at end of file
`;

test('a unified diff is read file by file with line numbers, also when a removed or added line looks like a header', () => {
  const files = parseDiff(DIFF);
  assert.deepEqual(files.map(f => [f.name, f.status, f.added, f.removed]), [['src/a.js', 'modified', 2, 1], ['docs/nuovo.md', 'added', 2, 0]]);
  assert.deepEqual(files[0].lines.map(l => [l.type, l.old, l.new]), [['hunk', null, null], ['context', 1, 1], ['del', 2, null], ['add', null, 2], ['add', null, 3], ['context', 3, 4]]);
  assert.equal(files[0].lines[4].text, '--- non una testata');
  assert.deepEqual(files[1].lines.map(l => l.type), ['hunk', 'add', 'add', 'meta']);
  // diff -u without git headers: the +++ line opens each file.
  const plain = parseDiff('--- a/x.txt\t2026\n+++ b/x.txt\t2026\n@@ -1 +1 @@\n-a\n+b\n--- vecchio.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-via\n');
  assert.deepEqual(plain.map(f => [f.name, f.status, f.added, f.removed]), [['x.txt', 'modified', 1, 1], ['vecchio.txt', 'deleted', 0, 1]]);
});

test('Git C-quoted paths decode once into the same name in Git headers and both sides of unified headers', () => {
  const paths = [
    [String.raw`caf\303\251.txt`, 'café.txt'],
    [String.raw`\360\237\232\200.txt`, '🚀.txt'],
    [String.raw`a\tb\nc\rd\\e\"f.txt`, 'a\tb\nc\rd\\e"f.txt'],
    [String.raw`\a\b\f\v.txt`, '\x07\b\f\v.txt'],
    [String.raw`literal\\303\\251.txt`, String.raw`literal\303\251.txt`],
    ['plain with spaces.txt', 'plain with spaces.txt'],
  ];
  for (const [encoded, name] of paths) {
    const git = 'diff --git "a/' + encoded + '" "b/' + encoded + '"\n';
    const headers = '--- "a/' + encoded + '"\t2026\n+++ "b/' + encoded + '"\t2026\n';
    const hunk = '@@ -1 +1 @@\n-old\n+new\n';
    for (const text of [git, git + headers + hunk, headers + hunk])
      assert.equal(parseDiff(text)[0].name, name);
    for (const prefix of ['', git]) {
      const added = parseDiff(prefix + '--- /dev/null\n+++ "b/' + encoded + '"\n@@ -0,0 +1 @@\n+new\n');
      const deleted = parseDiff(prefix + '--- "a/' + encoded + '"\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n');
      assert.equal(added[0].name, name);
      assert.equal(deleted[0].name, name);
    }
    const renamed = parseDiff('diff --git a/old.txt "b/' + encoded + '"\nsimilarity index 100%\nrename from old.txt\nrename to "' + encoded + '"\n');
    assert.equal(renamed[0].name, name);
    assert.equal(renamed[0].status, 'renamed');
  }
});

test('real Git quoted paths bind displayed file names, notes, line anchors and queued comments to the actual file', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'), path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'bruvish-quoted-diff-'));
  try {
    await mkdir(path.join(dir, 'before'));
    await mkdir(path.join(dir, 'after'));
    for (const name of ['café.txt', 'café "quoted" \\name.txt', 'café\tline\nname.txt', 'dir b/f.txt', 'dir b/café.txt', 'a\rb.txt', 'a\fb.txt', 'a\r\nb.txt']) {
      await mkdir(path.dirname(path.join(dir, 'before', name)), { recursive: true });
      await mkdir(path.dirname(path.join(dir, 'after', name)), { recursive: true });
      await writeFile(path.join(dir, 'before', name), 'old\n');
      await writeFile(path.join(dir, 'after', name), 'new\n');
      const output = spawnSync('git', ['-c', 'core.quotePath=true', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', 'before/' + name, 'after/' + name], { cwd: dir, encoding: 'utf8' });
      assert.equal(output.status, 1, output.stderr);
      const expected = 'after/' + name;
      assert.equal(parseDiff(output.stdout)[0].name, expected);
      const html = await render(doc([card({ diff: { text: output.stdout, notes: { [expected + ':1']: 'Una nota sul file.' } } })]));
      const { document, window } = boot(html);
      assert.equal(document.querySelector('.mb-diff-name').textContent, expected);
      assert.equal(document.querySelector('.mb-line-note').textContent, 'Una nota sul file.');
      const row = document.querySelector('tr[data-mb-line]');
      assert.equal(row.dataset.mbLine, expected + ':1');
      row.querySelector('[data-mb-comment]').click();
      const box = row.nextElementSibling;
      box.querySelector('textarea').value = 'Un commento.';
      box.querySelector('.mb-comment-add').click();
      assert.deepEqual({ ...window.queued[0].data }, { file: expected, line: 1, text: 'Un commento.' });
      assert.equal(window.queued[0].element, row);
      assert.equal(document.querySelector(window.queued[0].selector), row, 'the CSS selector resolves to the exact file and line');
      assert.equal(window.queued[0].queueKey, 'line:' + expected + ':1');
      window.post({ type: 'lavish:queuedAnchors', selectors: [window.queued[0].selector] });
      assert(row.classList.contains('mb-queued'));
      window.post({ type: 'lavish:deliveredAnchors', selectors: [window.queued[0].selector] });
      window.post({ type: 'lavish:queuedAnchors', selectors: [] });
      assert(row.classList.contains('mb-sent'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('authoritative Git headers preserve ambiguous unquoted paths in modifications, deletions, additions, moves and copies', () => {
  for (const name of ['dir b/f.txt', 'dir b/café.txt', 'b/dir b/f.txt']) {
    const git = 'diff --git a/' + name + ' b/' + name + '\n';
    const modified = git + '--- a/' + name + '\t\n+++ b/' + name + '\t\n@@ -1 +1 @@\n-old\n+new\n';
    const added = git + 'new file mode 100644\n--- /dev/null\n+++ b/' + name + '\t\n@@ -0,0 +1 @@\n+new\n';
    const deleted = git + 'deleted file mode 100644\n--- a/' + name + '\t\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n';
    const renamed = 'diff --git a/old b/' + name + '\nsimilarity index 100%\nrename from old\nrename to ' + name + '\n';
    const copied = 'diff --git a/old b/' + name + '\nsimilarity index 100%\ncopy from old\ncopy to ' + name + '\n';
    for (const [text, status] of [[modified, 'modified'], [added, 'added'], [deleted, 'deleted'], [renamed, 'renamed'], [copied, 'modified'], [git + 'old mode 100644\nnew mode 100755\n', 'modified'], [git + 'Binary files a/' + name + ' and b/' + name + ' differ\n', 'modified']])
      assert.deepEqual(parseDiff(text).map(file => [file.name, file.status]), [[name, status]]);
  }
});

test('answer selectors preserve CR, LF and FF in values with and without an answer text field', async () => {
  for (const value of ['a\rb', 'a\nb', 'a\fb', 'a\r\nb', 'a"\\\r\fb']) {
    for (const text of [undefined, { label: 'Note' }]) {
      const html = await render(doc([card({ status: 'waiting', question: { options: [{ value, label: 'Una scelta', recommended: true }], text } })]));
      const { document, window } = boot(html);
      const form = document.querySelector('[data-mb-question]'), input = form.querySelector('input');
      assert.equal(input.value, value, 'HTML parsing preserves the value');
      input.checked = true;
      form.requestSubmit();
      const prompt = window.queued[0];
      assert.equal(prompt.data.answer.choice, value);
      assert.equal(document.querySelector(prompt.selector), input, 'CSS string decoding preserves the same value');
      window.post({ type: 'lavish:queuedAnchors', selectors: [prompt.selector] });
      assert(input.closest('label').classList.contains('mb-queued'));
      window.post({ type: 'lavish:deliveredAnchors', selectors: [prompt.selector] });
      window.post({ type: 'lavish:queuedAnchors', selectors: [] });
      assert(input.closest('label').classList.contains('mb-sent'));
    }
  }
});

test('a card diff is one collapsible block per file, with coloured lines, new-side numbers and notes under their line', async () => {
  const body = cardHtml(await render(doc([card({ diff: { text: DIFF, notes: { 'src/a.js:2': 'Qui **attenzione** <b>.', 'docs/nuovo.md:1': 'Titolo nuovo.' } } })])));
  assert.match(body, /<div class="mb-diff"><details class="mb-diff-file" open><summary><span class="mb-diff-name">src\/a\.js<\/span><span class="mb-diff-stat"><span class="mb-plus">\+2<\/span> <span class="mb-minus">−1<\/span><\/span><\/summary>/);
  assert.match(body, /<summary><span class="mb-diff-name">docs\/nuovo\.md<\/span><span class="mb-diff-stat">nuovo · <span class="mb-plus">\+2<\/span><\/span><\/summary>/);
  assert.match(body, /<tr class="mb-del"><td class="mb-num">2<\/td><td class="mb-num"><\/td><td class="mb-code"><span class="mb-sign">−<\/span>const due = &quot;&lt;b&gt;2&lt;\/b&gt;&quot;;<\/td><td class="mb-cmt"><\/td><\/tr>/);
  assert.match(body, /<tr class="mb-add" data-mb-line="src\/a\.js:2"><td class="mb-num"><\/td><td class="mb-num">2<\/td><td class="mb-code"><span class="mb-sign">\+<\/span>const due = &#39;&lt;script&gt;alert\(2\)&lt;\/script&gt;&#39;;<\/td><td class="mb-cmt">[\s\S]*?<\/td><\/tr><tr class="mb-note-row"><td colspan="4"><div class="mb-line-note">Qui <strong>attenzione<\/strong> &lt;b&gt;\.<\/div><\/td><\/tr>/);
  assert.match(body, /<tr class="mb-context" data-mb-line="src\/a\.js:4"><td class="mb-num">3<\/td><td class="mb-num">4<\/td>/);
  assert.match(body, /<tr class="mb-hunk"><td class="mb-num"><\/td><td class="mb-num"><\/td><td class="mb-code">@@ -1,4 \+1,4 @@ function a\(\) \{<\/td><td class="mb-cmt"><\/td><\/tr>/);
  assert.doesNotMatch(body, /<script>|<b>/, 'the diff text is escaped');
  await assert.rejects(render(doc([card({ diff: { text: DIFF, notes: { 'src/a.js:99': 'x' } } })])), /Card a: diff note "src\/a\.js:99" matches no line of the new side/);
  await assert.rejects(render(doc([card({ diff: { text: 3 } })])), /Card a: diff must be/);
  await assert.rejects(render(doc([card({ diff: { text: 'niente' } })])), /Card a: diff has no file/);
});

test('each line of the new side has a discreet «commenta» that queues a line comment, with the queued and sent marks', async () => {
  const html = await render(doc([card({ diff: { text: DIFF } })]));
  const body = cardHtml(html);
  assert.match(body, /<tr class="mb-add" data-mb-line="src\/a\.js:2">[\s\S]*?<td class="mb-cmt"><button class="mb-comment-toggle" type="button" data-mb-comment aria-expanded="false" aria-label="Commenta la riga 2 di src\/a\.js">commenta<\/button><\/td><\/tr>/);
  assert.match(body, /<tr class="mb-del">(?:(?!<\/tr>)[\s\S])*<td class="mb-cmt"><\/td><\/tr>/, 'no comment on a removed line');
  const { document, window } = boot(html);
  const row = document.querySelector('tr[data-mb-line="src/a.js:2"]'), toggle = row.querySelector('[data-mb-comment]');
  toggle.click();
  const box = row.nextElementSibling;
  assert.equal(box.className, 'mb-comment-row');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const area = box.querySelector('textarea'), [add] = box.querySelectorAll('button'), status = box.querySelector('[role="status"]');
  assert.equal(area.getAttribute('aria-label'), 'Commento sulla riga 2 di src/a.js');
  assert.equal(document.activeElement, area);
  add.click();
  assert.equal(status.textContent, 'Scrivi il commento.');
  assert.equal(window.queued.length, 0);
  area.value = '  Meglio una costante.  ';
  add.click();
  assert.equal(window.queued.length, 1);
  const [prompt] = window.queued;
  assert.equal(prompt.tag, 'line-comment');
  assert.equal(prompt.queueKey, 'line:src/a.js:2');
  assert.equal(prompt.selector, 'tr[data-mb-line="src/a.js:2"]');
  assert.equal(prompt.element, row);
  assert.deepEqual({ ...prompt.data }, { file: 'src/a.js', line: 2, text: 'Meglio una costante.' });
  assert.match(prompt.prompt, /Meglio una costante\./);
  assert.equal(box.hidden, true);
  // Queued, then sent, then queued again: the same marks as the answers.
  window.post({ type: 'lavish:queuedAnchors', selectors: [prompt.selector] });
  assert(row.classList.contains('mb-queued'));
  assert.equal(row.querySelector('.mb-line-mark').textContent, '✓ in coda');
  window.post({ type: 'lavish:deliveredAnchors', selectors: [prompt.selector] });
  window.post({ type: 'lavish:queuedAnchors', selectors: [] });
  assert(!row.classList.contains('mb-queued') && row.classList.contains('mb-sent'));
  assert.equal(row.querySelector('.mb-line-mark').textContent, '✓ inviata');
  window.post({ type: 'lavish:queuedAnchors', selectors: [prompt.selector] });
  assert(row.classList.contains('mb-queued') && !row.classList.contains('mb-sent'));
  toggle.click();
  assert.equal(box.hidden, false, 'the toggle opens the same box again');
  // Without Lavish the box says so and queues nothing.
  const bare = boot(html, { lavish: false });
  const bareRow = bare.document.querySelector('tr[data-mb-line="src/a.js:2"]');
  bareRow.querySelector('[data-mb-comment]').click();
  const bareBox = bareRow.nextElementSibling;
  bareBox.querySelector('textarea').value = 'x';
  bareBox.querySelector('button').click();
  assert.equal(bareBox.querySelector('[role="status"]').textContent, 'Apri la pagina con Lavish per accodare il commento.');
});

test('a question may ask for a text, shown for the options listed in "for"; the queued answer becomes { choice, text }', async () => {
  const question = { label: 'Cosa faccio?', options: [{ value: 'a', label: 'Unisci', recommended: true }, { value: 'b', label: 'Chiedi modifiche' }], reason: 'Va bene.', text: { label: 'Quali **modifiche**?', placeholder: 'Scrivi <qui>', for: ['b'] } };
  const html = await render(doc([card({ status: 'waiting', question })]));
  const body = cardHtml(html);
  assert.match(body, /<\/label><div class="mb-answer-text" data-mb-for="\[&quot;b&quot;\]" hidden><label><span class="mb-answer-label">Quali <strong>modifiche<\/strong>\?<\/span><textarea data-mb-field="a:text" name="text" rows="3" placeholder="Scrivi &lt;qui&gt;"><\/textarea><\/label><\/div><table class="mb-fields mb-reason">/);
  const { document, window } = boot(html);
  const form = document.querySelector('[data-mb-question]'), box = form.querySelector('.mb-answer-text'), area = form.querySelector('textarea');
  const [a, b] = form.querySelectorAll('input[name="choice"]'), status = form.querySelector('.queue-status');
  const choose = input => { input.checked = true; document.dispatch(input, 'change'); };
  choose(a);
  assert.equal(box.hidden, true);
  choose(b);
  assert.equal(box.hidden, false);
  form.requestSubmit();
  assert.equal(window.queued.length, 0);
  assert.equal(status.textContent, 'Scrivi il testo per questa risposta.');
  assert(status.classList.contains('mb-alert'));
  area.value = ' Togli la regola. ';
  form.requestSubmit();
  assert.equal(window.queued.length, 1, 'queued once, by the building blocks only');
  const [queued] = window.queued;
  assert.deepEqual(JSON.parse(JSON.stringify(queued.data)), { question: 'a', answer: { choice: 'b', text: 'Togli la regola.' } });
  assert.equal(queued.queueKey, 'answer:a');
  assert.equal(queued.tag, 'choice');
  assert.equal(queued.selector, '[data-mb-question="a"] input[value="b"]');
  assert.equal(queued.element, b);
  assert.equal(status.textContent, '');
  choose(a);
  assert.equal(box.hidden, true);
  form.requestSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(window.queued[1].data.answer)), { choice: 'a' }, 'a hidden text is not sent');
  // A draft restored by the bridge sets the option without change events, then announces mb:restored: the text shows.
  const restoredPage = boot(html);
  const [, restoredB] = restoredPage.document.querySelectorAll('input[name="choice"]'), restoredBox = restoredPage.document.querySelector('.mb-answer-text');
  restoredB.checked = true;
  restoredPage.document.querySelector('textarea').value = 'Togli la regola.';
  assert.equal(restoredBox.hidden, true);
  restoredPage.document.dispatch(restoredPage.document, 'mb:restored');
  assert.equal(restoredBox.hidden, false, 'the restored choice shows its restored text');
  // Without "for" the text is always there and optional; a saved answer fills it back.
  const always = await render(doc([card({ status: 'waiting', question: { ...question, text: { label: 'Note' } } })], { state: { revision: 1, answers: { a: { choice: 'a', text: 'Già <scritto>' } } } }));
  assert.match(always, /<div class="mb-answer-text"><label><span class="mb-answer-label">Note<\/span><textarea data-mb-field="a:text" name="text" rows="3">Già &lt;scritto&gt;<\/textarea><\/label><\/div>/);
  const second = boot(always);
  const secondForm = second.document.querySelector('[data-mb-question]');
  secondForm.querySelector('textarea').value = '';
  secondForm.requestSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(second.window.queued[0].data.answer)), { choice: 'a' });
  // Without Lavish, the same message as the answers.
  const bare = boot(always, { lavish: false });
  bare.document.querySelector('[data-mb-question]').requestSubmit();
  assert.equal(bare.document.querySelector('.queue-status').textContent, 'Apri la pagina con Lavish per accodare la risposta.');
  for (const text of ['x', { for: ['z'] }, { for: 'b' }, { label: 3 }])
    await assert.rejects(render(doc([card({ question: { ...question, text } })])), /Card a: question\.text/);
});

test('a page in tabs turns every section into a tab of the index bar, with a counter; without JS the sections stay one under the other', async () => {
  const input = { title: 'Prova', guide: 'Leggi.', tabs: true, sections: [{ id: 'sintesi', title: 'Sintesi', cards: [card()] }, { id: 'file', title: 'File modificati', count: 3, cards: [card({ id: 'b' }), card({ id: 'c' })] }] };
  const html = await render(input);
  assert.match(html, /<nav class="mb-tabs" aria-label="Schede"><a href="#sintesi" data-mb-tab="sintesi" data-lavish-action>Sintesi<\/a><a href="#file" data-mb-tab="file" data-lavish-action>File modificati<span class="mb-count">3<\/span><\/a><\/nav><section id="sintesi">/);
  assert.doesNotMatch(html, /<section[^>]* hidden/, 'every section is visible without JS');
  assert.doesNotMatch(await render({ ...input, tabs: undefined, layout: 'schede' }), /<nav class="mb-tabs"/, 'only tabs: true makes tabs; layout is not a field');
  const { document, window } = boot(html);
  const [first, second] = ['sintesi', 'file'].map(id => document.getElementById(id));
  const [tabA, tabB] = document.querySelectorAll('nav.mb-tabs a');
  assert.deepEqual([first.hidden, second.hidden], [false, true]);
  assert.equal(tabA.getAttribute('aria-current'), 'page');
  let prevented = document.dispatch(tabB, 'click').defaultPrevented;
  assert(prevented);
  assert.deepEqual([first.hidden, second.hidden], [true, false]);
  assert.equal(tabB.getAttribute('aria-current'), 'page');
  assert.equal(tabA.getAttribute('aria-current'), null);
  assert.equal(window.location.hash, '#file');
  // A link or a reveal that points into a hidden tab opens that tab first.
  window.location.hash = '#a';
  window.fire('hashchange');
  assert.deepEqual([first.hidden, second.hidden], [false, true]);
  assert(document.getElementById('a').scrolled > 0);
  window.post({ type: 'lavish:revealElement', selector: '#c' });
  assert.deepEqual([first.hidden, second.hidden], [true, false]);
  // Opening on a hash shows its tab.
  const deep = boot(html, { hash: '#b' });
  assert.equal(deep.document.getElementById('file').hidden, false);
  // A counter also shows in a page without tabs.
  assert.match(await render({ ...doc([card()]), sections: [{ id: 's', title: 'Sezione', count: '2 nuove', cards: [card()] }] }), /<nav><a href="#s">Sezione<span class="mb-count">2 nuove<\/span><\/a><\/nav>/);
  await assert.rejects(render({ ...input, tabs: 'si' }), /tabs must be true or false/);
  await assert.rejects(render({ ...input, sections: [{ ...input.sections[0], count: [1] }] }), /Section sintesi: count/);
});

test('tabs remain interactive with the real annotation SDK enabled, including clicks on their counters', async () => {
  const modules = await Promise.all(['../../src/artifact-sdk.js', '../../src/mermaid-node.js', '../../src/table-cell.js', '../../src/artifact-revisions.js'].map(name => import(name)));
  const source = modules.flatMap(module => Object.entries(module).map(([name, value]) => 'const ' + name + '=' + (typeof value === 'function' ? value.toString() : JSON.stringify(value)) + ';')).join('\n');
  const html = await render({ title: 'Schede', guide: 'Leggi.', tabs: true, sections: [{ id: 'one', title: 'Uno', count: 1, cards: [card()] }, { id: 'two', title: 'Due', count: 1, cards: [card({ id: 'b' })] }] });
  const { document, window } = boot(html), messages = [];
  Object.assign(document, { head: document.querySelector('head'), body: document.querySelector('body') });
  window.parent.postMessage = message => messages.push(message);
  Object.assign(window, { navigator: { platform: 'Linux' }, MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, getComputedStyle: () => ({}), Element: class {} });
  vm.runInNewContext(source + '\nconst mermaidHelpers={' + Object.keys(modules[1]).join(',') + '};createArtifactSdk(deriveLavishQueueKey, isNativeInteractiveControl, mermaidHelpers);', window);
  assert(messages.some(message => message.type === 'lavish:annotationMode' && message.enabled === true));
  assert(document.getElementById('lavish-cursor-style'), 'annotation mode installed its controls');
  const [one, two] = ['one', 'two'].map(id => document.getElementById(id));
  const [tabA, tabB] = document.querySelectorAll('nav.mb-tabs a');
  for (const [tab, target] of [[tabB, tabB], [tabA, tabA], [tabB, tabB.querySelector('.mb-count')], [tabA, tabA.querySelector('.mb-count')]]) {
    document.dispatch(target, 'click');
    assert.equal(two.hidden, tab === tabA);
    assert.equal(one.hidden, tab === tabB);
    assert.equal(tab.getAttribute('aria-current'), 'page');
    assert.equal(window.location.hash, '#' + tab.dataset.mbTab);
  }
});

test('every new card field enters the fingerprint only when present', () => {
  const plain = card({ status: 'waiting', question: { options: [{ value: 'a', label: 'A', recommended: true }] } });
  const extras = { tone: 'rosso', labels: [{ text: 'x', tone: 'blu' }], help: 'Aiuto.', table: { rows: [['x']] }, notes: ['Nota.'], diff: { text: DIFF }, events: [{ text: 'x', tone: 'verde' }], question: { ...plain.question, text: { label: 'Note' } } };
  for (const [key, value] of Object.entries(extras))
    assert.notEqual(cardFingerprint({ ...plain, [key]: value }), cardFingerprint(plain), key);
});

test('the example revisione-completa uses every building block and renders through the CLI', async () => {
  const input = await example('revisione-completa');
  const cards = input.sections.flatMap(s => s.cards);
  assert(input.tabs && input.header.badge.icon && input.header.subtitle && input.header.meta.length && input.pills.length && input.sections.some(s => s.count !== undefined));
  for (const key of ['tone', 'labels', 'help', 'table', 'notes', 'diff', 'events']) assert(cards.some(c => c[key] !== undefined), key);
  assert(cards.some(c => c.diff?.notes && Object.keys(c.diff.notes).length) && cards.some(c => c.question?.text?.for) && cards.some(c => c.tone === 'decidi'));
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os'), path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-blocks-'));
  try {
    const output = path.join(dir, 'page.html');
    const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname, file = new URL('../examples/revisione-completa.json', import.meta.url).pathname;
    const r = spawnSync(process.execPath, [cli, 'render', file, '--output', output], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = await readFile(output, 'utf8');
    for (const needle of ['nav class="mb-tabs"', 'mb-badge', 'mb-pill', 'data-mb-tone="decidi"', 'mb-label', 'mb-help', 'mb-table', 'mb-level', 'mb-notes', 'mb-diff-file', 'mb-line-note', 'data-mb-comment', 'mb-answer-text', 'mb-event']) assert(html.includes(needle), needle);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('yellow is always intense: through the cascade of the page, a giallo card looks exactly like a decidi card', async () => {
  const states = { waiting: { status: 'waiting' }, info: { status: 'info' }, blocked: { status: 'blocked' }, answered: { status: 'answered' } };
  for (const [state, extra] of Object.entries(states)) {
    const html = await render(doc([card({ id: 'g', tone: 'giallo', ...extra }), card({ id: 'd', tone: 'decidi', ...extra }), card({ id: 'p', ...extra })]));
    const { document } = boot(html), css = styleOf(html), look = (id, sheet = css) => computed(sheet, document.getElementById(id));
    assert.deepEqual(look('g'), look('d'), state);
    if (state !== 'answered') assert.notDeepEqual(look('g'), look('p'), state + ': the tone changes the card');
    // A later rule that wins for giallo alone would break the rule, and the comparison sees it.
    const broken = css + '.card[data-mb-tone=giallo][data-mb-state]{box-shadow:none}';
    assert.notDeepEqual(look('g', broken), look('d', broken), state);
  }
});

test('after an answer with text is queued, the next tap on the same option arms it again and only the one after queues', async () => {
  const question = { options: [{ value: 'a', label: 'Unisci', recommended: true }, { value: 'b', label: 'Chiedi modifiche' }], text: { label: 'Quali?', for: ['b'] } };
  const plain = { options: [{ value: 'c', label: 'Sì', recommended: true }, { value: 'd', label: 'No' }] };
  const html = await render(doc([card({ status: 'waiting', question }), card({ id: 'z', status: 'waiting', question: plain })]));
  for (const way of ['click', 'space']) {
    const { document, window } = boot(html);
    const [form, other] = document.querySelectorAll('[data-mb-question]'), [a, b] = form.querySelectorAll('input[name="choice"]'), [c] = other.querySelectorAll('input[name="choice"]');
    form.querySelector('textarea').value = 'Togli la regola.';
    const tap = input => { input.checked = true; if (way === 'click') document.dispatch(input, 'click'); else document.dispatch(input, 'keyup', { key: ' ' }); };
    const twice = (input, count, why) => {
      tap(input);
      assert.equal(window.queued.length, count - 1, way + ': ' + why + ': the first tap arms');
      assert(input.closest('label').classList.contains('mb-armed'), way + ': ' + why);
      tap(input);
      assert.equal(window.queued.length, count, way + ': ' + why + ': the second tap queues');
    };
    twice(b, 1, 'first answer');
    const selector = window.queued[0].selector;
    // The chrome lists the option as newly queued, which disarms it: two taps queue it again, not three.
    window.post({ type: 'lavish:queuedAnchors', selectors: [selector] });
    twice(b, 2, 'after the option enters the queue');
    // A list where the option was already queued disarms nothing: the tap after queueing arms it again.
    window.post({ type: 'lavish:queuedAnchors', selectors: [selector] });
    twice(b, 3, 'with the option already queued');
    // A tap on an option of a question without text, in between, drops the memory.
    tap(c);
    assert.equal(window.queued.length, 3, way);
    twice(b, 4, 'after another question');
    // Without any list from the chrome, the tap after queueing arms again.
    twice(b, 5, 'without a list');
    // Another option of the same question in between drops the memory: it is armed and queued as usual.
    twice(a, 6, 'another option');
  }
});

test('the help is the bubble of the approved review page: in the flow under the title, accent border, shadow, opaque, round «?» in the corner', async () => {
  const html = await render(doc([card({ help: 'Serve.' })]));
  const { document } = boot(html);
  const opaque = colour => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*(1|1\.0+)\s*)?\)$/.test(colour);
  const none = value => value === undefined || /^(none|0(px)?|transparent)$/.test(value.trim());
  const problems = css => {
    const look = computed(css, document.querySelector('.mb-help')), found = [];
    if (/^(absolute|fixed)$/.test(look.position || '')) found.push('over the card instead of under the title');
    if (none(look.border) && none(look['border-width'])) found.push('no border');
    if (none(look['box-shadow'])) found.push('no shadow');
    if (!opaque((look['background-color'] || look.background || '').trim())) found.push('background not opaque');
    const toggle = computed(css, document.querySelector('.mb-help-toggle'));
    if (toggle.position !== 'absolute') found.push('«?» not in the corner');
    if (none(toggle['border-radius'])) found.push('«?» not round');
    return found;
  };
  assert.deepEqual(problems(styleOf(html)), []);
  assert.deepEqual(problems(styleOf(html) + '.card .mb-help{position:absolute;box-shadow:none}'), ['over the card instead of under the title', 'no shadow']);
});

test('one help open at a time; a click outside the bubble or Esc closes it, a click inside leaves it open', async () => {
  const html = await render(doc([card({ help: 'Uno.' }), card({ id: 'b', help: 'Due.' })]));
  const { document } = boot(html);
  const [first, second] = document.querySelectorAll('[data-mb-help]');
  const one = document.getElementById('mb-help-a'), two = document.getElementById('mb-help-b');
  first.click();
  assert.equal(one.hidden, false);
  second.click();
  assert.equal(one.hidden, true, 'opening the second closes the first');
  assert.equal(two.hidden, false);
  document.dispatch(two, 'click');
  assert.equal(two.hidden, false, 'a click inside the bubble keeps it open');
  document.dispatch(document.querySelector('h3'), 'click');
  assert.equal(two.hidden, true, 'a click outside closes it');
  second.click();
  document.dispatch(document, 'keydown', { key: 'Enter' });
  assert.equal(two.hidden, false);
  document.dispatch(document, 'keydown', { key: 'Escape' });
  assert.equal(two.hidden, true);
  assert.equal(second.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, second, 'Esc gives the focus back to «?»');
  // A click outside still closes it when another handler stops the click first: Lavish annotation mode does so in
  // capture on the document, and an answer form may stop it in capture.
  const stop = event => event.stopPropagation();
  const cardA = document.querySelector('article.card'), textA = cardA.querySelectorAll('p').find(p => !p.closest('.mb-help'));
  for (const [node, target, why] of [[document, document.querySelector('h1'), 'a capture handler on the document'], [cardA, textA, 'a capture handler on a card']]) {
    second.click();
    node.addEventListener('click', stop, true);
    document.dispatch(target, 'click');
    assert.equal(two.hidden, true, why + ' that stops the click does not keep it open');
    node.listeners.click = node.listeners.click.filter(l => l.fn !== stop);
  }
});

// Values of the approved review page (agenti-comune/tools/pr-revisione/revisione.css): accent #4ed1de, cards 20%
// narrower than the column minus their 18px indent, a sticky tab bar, tables at 17px with 8px 6px cells, and the diff
// at 13.5px with 1px 8px cells (.diff table, .diff td).
test('the theme «revisione» is asked by name, never drawn, and brings the look of the approved review page', async () => {
  const diff = { text: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,1 +1,1 @@\n-a\n+b\n', notes: { 'x.js:1': 'Una nota.' } };
  // The diff sits in a card of its own: in this theme a card with a diff is the files page, without a frame.
  const input = doc([card({ table: { headers: ['A', 'B'], rows: [['1', '2']] }, fields: [{ label: 'Oggi', paragraphs: ['Un campo.', 'Un altro campo.'] }], clarification: 'Un chiarimento.' }), card({ id: 'b', diff })], { tabs: true, theme: 'revisione', state: { comments: [{ card: 'a', text: 'Un commento.', response: 'Una risposta.' }] } });
  const html = await render(input);
  assert.match(html, /data-mb-family="revisione"/);
  const look = (page, selector) => { const { document } = boot(page); return computed(styleOf(page), document.querySelector(selector)); };
  assert.equal(look(html, 'html')['--title'], '#4ed1de');
  const cardLook = look(html, 'article.card');
  assert.equal(cardLook.width, 'calc((100% - 18px) * .8)');
  assert.equal(look(html, 'nav.mb-tabs').position, 'sticky');
  assert.equal(look(html, '.mb-table')['font-size'], '17px');
  assert.equal(look(html, '.mb-table td').padding, '8px 6px');
  assert.equal(look(html, '.mb-diff-lines')['font-size'], '13.5px');
  assert.equal(look(html, '.mb-diff-lines td').padding, '1px 8px');
  const { document, window } = boot(html);
  document.querySelector('[data-mb-comment]').click();
  for (const width of [1024, 390]) {
    const styles = selector => computed(styleOf(html), document.querySelector(selector), width);
    assert.equal(styles('article.card').width, width === 390 ? '100%' : 'calc((100% - 18px) * .8)');
    assert.equal(styles('.mb-diff-lines')['font-size'], '13.5px');
    for (const selector of ['.mb-num', '.mb-code']) assert.equal(styles(selector).padding, '1px 8px', selector);
    assert.equal(styles('.mb-cmt').padding, '0 6px');
    for (const selector of ['.mb-note-row td', '.mb-comment-row td']) assert.equal(styles(selector).padding, '0', selector);
    assert.equal(styles('.mb-fields td').padding, width === 390 ? '0 0 10px' : '10px 0');
    assert.equal(styles('.mb-fields td p').margin, '0 0 1.2em');
    assert.equal(styles('.context p').margin, '12px 0');
    const text = document.createElement('p');
    document.querySelector('.followup').append(text);
    assert.equal(computed(styleOf(html), text, width).margin, '8px 0');
  }
  const [observer] = window.resizeObservers;
  assert.equal(observer.target, document.querySelector('nav.mb-tabs'));
  for (const height of [59, 98, 176, 59]) {
    observer.target.offsetHeight = height;
    observer.callback();
    const measured = document.documentElement.style.getPropertyValue('--mb-tabs-height');
    const margin = cardLook['scroll-margin-top'].replace(/var\(--mb-tabs-height,[^)]*\)/, measured);
    const [, barHeight, gap] = /^calc\(([\d.]+)px \+ ([\d.]+)px\)$/.exec(margin);
    assert(Number(barHeight) + Number(gap) >= height + 24, 'a wrapped or resized tab bar leaves the title visible');
  }
  assert.equal(boot(await render(doc([card()], { tabs: true, theme: 'B' }))).window.resizeObservers.length, 0);
  assert.equal(boot(await render(doc([card()], { theme: 'revisione' }))).window.resizeObservers.length, 0);
  // A later render of the same page without "theme" keeps it, with its rules.
  const again = await render(doc([card()]), { previous: html });
  assert.match(again, /data-mb-family="revisione"/);
  assert.equal(look(again, 'html')['--title'], '#4ed1de');
  const { renderRecord } = await import('../lib/document.mjs');
  const fromRecord = await render(doc([card()]), { previous: renderRecord(again) });
  assert.equal(look(fromRecord, 'html')['--title'], '#4ed1de');
  const replaced = await render(doc([card()], { theme: 'F' }), { previous: again });
  assert.match(replaced, /data-mb-family="F"/);
  assert.equal(look(replaced, 'html')['--title'], '#e1a3e4');
  await assert.rejects(render({ ...doc([card()]), theme: 'nessuno' }), /expected B, F, E2, G2, D3, revisione/);
  const { FAMILIES } = await import('../lib/document.mjs');
  assert.equal(FAMILIES.includes('revisione'), false);
});

// The approved review page of mattiabestiaccia/postit#6 (brus/lavori/pr-revisione/esempio/postit-6-feedback.html, the
// binding reference of the theme chosen by Mattia on 22 novembre 2026), rendered from its own data
// (fixtures/revisione-postit-6.json). Every expected value below is copied from that page, not from the renderer.
const REFERENCE = {
  marks: ['vera e già unita', '«Comando o argomenti non validi»', 'lo stesso aiuto', 'ancora errore', 'questo e solo questo', 'nessun effetto collaterale', 'superati senza rilievi', 'uscita 0', 'stesso output', 'fallirebbe', 'prima sul commit base e poi sul commit nuovo', 'lo stesso testo', 'non crea la cartella dati', 'senza una CI configurata', 'rischio basso, nessun rilievo, 7 prove su 7'],
  paglierino: 'rgba(236,214,120,.30)', mark: { 'border-radius': '3px', padding: '0 .15em' },
  pageMargin: 'clamp(14px, 1.5vw, 24px)', pageWidth: '907px',
  header: { padding: '8px clamp(8px, 1vw, 16px) 24px' },
  h1: { 'font-size': 'clamp(31px, 4vw, 46px)', margin: '10px 0 10px' }, number: { color: 'var(--muted)', 'font-weight': '400' },
  lineNote: { margin: '6px 8px 10px 80px', 'box-shadow': '0 0 0 1.5px #e8c35acc, 0 0 14px #e8c35a55' },
};
const flat = value => String(value ?? '').replace(/\s*,\s*/g, ',').trim();
const box = value => { const p = flat(value).match(/(?:[^\s(]+|\([^()]*(?:\([^()]*\)[^()]*)*\))+/g); return [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]]; };

test('the review page of postit#6 in the theme «revisione» matches the approved page: highlights, tabs, header and files', async () => {
  const input = JSON.parse(await readFile(new URL('./fixtures/revisione-postit-6.json', import.meta.url), 'utf8'));
  const html = await render(input);
  const { document } = boot(html), css = styleOf(html), look = (el, width = 1024) => computed(css, el, width);
  // (1) ==text== is a highlight in the straw yellow of the review page; no closed pair stays literal.
  assert.deepEqual(document.querySelectorAll('mark').map(m => m.textContent), REFERENCE.marks);
  assert.equal(look(document.documentElement)['--highlight'], REFERENCE.paglierino);
  for (const [name, value] of Object.entries(REFERENCE.mark)) assert.equal(look(document.querySelector('mark'))[name], value, name);
  for (const sentence of document.querySelectorAll('.sentence')) assert.doesNotMatch(sentence.textContent, /==[^\s=][^=]*[^\s=]==/);
  // (2) The tab names the section: no heading repeats it, the section keeps the name for assistive technology.
  const tabs = document.querySelectorAll('nav.mb-tabs a');
  assert.equal(tabs.length, input.sections.length);
  assert.equal(document.querySelectorAll('section h2').length, 0);
  for (const section of input.sections) assert.equal(document.getElementById(section.id).getAttribute('aria-label'), section.title);
  // (3) The files sit in the column without a card around them, under one button; the reviewer note glows under its line.
  const files = document.getElementById('carta-diff');
  const frame = look(files);
  assert.deepEqual([frame.width, frame.padding, frame.border, frame.background, frame['box-shadow']], ['100%', '0', '0', 'none', 'none']);
  const [toggleAll] = document.querySelectorAll('[data-mb-diff-all]'), details = files.querySelectorAll('details.mb-diff-file');
  assert.equal(document.querySelectorAll('[data-mb-diff-all]').length, 1);
  assert.equal(details.length, 2);
  assert.equal(toggleAll.closest('.mb-diff-tools').nextElementSibling, details[0], 'the button sits above the files');
  assert.equal(toggleAll.textContent, 'Chiudi tutti');
  for (const file of details) assert.equal(look(file).width, undefined, 'a file spans the column');
  const noteRow = document.querySelector('tr[data-mb-line="src/cli.ts:46"]').nextElementSibling;
  assert(noteRow.classList.contains('mb-note-row'));
  const note = look(noteRow.querySelector('.mb-line-note'));
  for (const [name, value] of Object.entries(REFERENCE.lineNote)) assert.equal(flat(note[name]), flat(value), name);
  toggleAll.click();
  assert.deepEqual(details.map(d => d.hasAttribute('open')), [false, false]);
  assert.equal(toggleAll.textContent, 'Apri tutti');
  toggleAll.click();
  assert.deepEqual(details.map(d => d.hasAttribute('open')), [true, true]);
  assert.equal(toggleAll.textContent, 'Chiudi tutti');
  details[1].removeAttribute('open');
  document.dispatch(details[1], 'toggle');
  assert.equal(toggleAll.textContent, 'Apri tutti', 'the button follows a file closed by its own name');
  // 🔊 stays beside «?» on the files page too, with separate hit areas.
  const voice = files.querySelector('.voice'), help = files.querySelector('[data-mb-help]');
  for (const width of [1024, 600, 390]) {
    const px = v => parseFloat(v) || 0, v = look(voice, width), h = look(help, width), c = look(files, width);
    assert(px(c['padding-right'] || c.padding) + px(v['margin-right']) > px(h.right) + px(h.width), 'files page at ' + width + ': voice and help do not overlap');
  }
  // (4) Header: the PR number muted and plain in the title; title, header padding and full-width tab bar as on the page.
  const h1 = document.querySelector('h1');
  assert.equal(h1.textContent, input.title);
  assert.equal(h1.querySelector('.mb-number').textContent, '#6');
  for (const [name, value] of Object.entries(REFERENCE.number)) assert.equal(look(h1.querySelector('.mb-number'))[name], value, name);
  assert.equal(flat(look(h1)['font-size']), flat(REFERENCE.h1['font-size']));
  assert.deepEqual(box(look(h1).margin), box(REFERENCE.h1.margin));
  assert.deepEqual(box(look(document.querySelector('header')).padding), box(REFERENCE.header.padding));
  const main = look(document.querySelector('main')), nav = look(document.querySelector('nav.mb-tabs'));
  assert.equal(flat(main['--mb-page-margin']), flat(REFERENCE.pageMargin));
  assert.equal(nav.position, 'sticky');
  assert.deepEqual(box(nav.padding), ['10px', 'var(--mb-page-margin)', '10px', 'var(--mb-page-margin)']);
  assert.deepEqual(box(nav.margin).filter((_, i) => i % 2), ['calc(-1 * var(--mb-page-margin))', 'calc(-1 * var(--mb-page-margin))'].map(flat), 'the bar spans the page margin');
  assert.equal(nav['justify-content'], 'space-between');
  assert.equal(look(document.querySelector('nav.mb-tabs'), 600)['justify-content'], undefined);
  assert.equal(look(document.getElementById('sintesi'))['max-width'], REFERENCE.pageWidth);
  // No usage guide, as on the approved page (S3); the voice stays with the help on every card.
  assert(!document.getElementById('usage-guide'), 'no usage guide in the theme «revisione»');
  assert.doesNotMatch(skeleton(html), /class="guide"|Come usare questa pagina/);
  const { guide, ...withoutGuide } = input;
  assert(guide, 'the fixture carries a guide: the field stays accepted and produces no markup');
  assert.doesNotMatch(skeleton(await render(withoutGuide)), /usage-guide/, 'the theme «revisione» does not require a guide');
  await assert.rejects(render({ ...withoutGuide, theme: 'B' }), /usage guide are required/, 'the other themes still require it');
  const cards = input.sections.flatMap(s => s.cards);
  assert.equal(document.querySelectorAll('article.card .voice').length, cards.length);
  assert.equal(document.querySelectorAll('article.card [data-mb-help]').length, cards.filter(c => c.help).length);
  // Only the theme «revisione» changes: the same data in a drawn family keeps headings, the framed diff card and the title.
  const other = await render({ ...input, theme: 'B' });
  assert.equal((other.match(/<h2>/g) || []).length, input.sections.length);
  assert.match(skeleton(other), /<details class="guide" id="usage-guide"><summary>Come usare questa pagina<\/summary>/, 'the other themes keep the guide');
  assert.doesNotMatch(skeleton(other), /data-mb-files|data-mb-diff-all|mb-number/);
  // Without tabs the theme keeps the section headings.
  assert.equal(((await render({ ...input, tabs: false })).match(/<h2>/g) || []).length, input.sections.length);
});

test('a transcript opens on demand: closed, preformatted, escaped, after the table and before the notes', async () => {
  const transcript = { summary: 'Trascrizione: `-h` prima e dopo', text: '$ postit -h\n  <aiuto> == ok\n[exit 0]' };
  const body = cardHtml(await render(doc([card({ table: { headers: ['A'], rows: [['1']] }, transcript, notes: ['Nota.'] })])));
  assert.match(body, /<\/table><details class="mb-transcript"><summary>Trascrizione: <code>-h<\/code> prima e dopo<\/summary><pre>\$ postit -h\n  &lt;aiuto&gt; == ok\n\[exit 0\]<\/pre><\/details><div class="mb-notes">/);
  assert.doesNotMatch(body, /<details class="mb-transcript" open/);
  for (const bad of ['x', { summary: '', text: 'a' }, { summary: 'a', text: ' ' }, ['a']])
    await assert.rejects(render(doc([card({ transcript: bad })])), /Card a: transcript must be/);
});
