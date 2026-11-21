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
  assert.match(body, /<div class="mb-card-head"><h3>Una carta<\/h3><button class="mb-help-toggle" type="button" data-mb-help aria-expanded="false" aria-controls="mb-help-a" aria-label="A cosa serve questa carta">\?<\/button><\/div><div class="mb-help" id="mb-help-a" hidden><p><span class="sentence">Serve a <strong>decidere<\/strong>.<\/span><span class="sentence">Poi chiudi.<\/span><\/p><\/div><p>/);
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

test('the header carries a badge with a closed set of inline icons, a subtitle and meta items; pills follow under it', async () => {
  const header = { badge: { text: 'Aperta', tone: 'verde', icon: 'pr-open' }, subtitle: 'Unisce `fase2` in `carry`', meta: ['repo **bruvish**', 'oggi <b>'] };
  const html = await render(doc([card()], { header, intro: 'Una frase.', pills: [{ text: 'rischio **basso**', tone: 'verde' }, { text: 'tocca la sandbox', tone: 'decidi' }] }));
  const head = /<header>[\s\S]*?<\/header>/.exec(html)[0];
  assert.match(head, /^<header><div class="mb-header-meta"><span class="mb-badge" data-tone="verde"><svg class="mb-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1\.5 3\.25[^"]*"><\/path><\/svg>Aperta<\/span><span class="mb-meta-item">repo <strong>bruvish<\/strong><\/span><span class="mb-meta-item">oggi &lt;b&gt;<\/span><\/div><h1>Prova<\/h1><p class="mb-subtitle">Unisce <code>fase2<\/code> in <code>carry<\/code><\/p><p><span class="sentence">Una frase\.<\/span><\/p><div class="mb-pills"><span class="mb-pill" data-tone="verde">rischio <strong>basso<\/strong><\/span><span class="mb-pill" data-tone="decidi">tocca la sandbox<\/span><\/div><\/header>$/);
  for (const icon of ['pr-open', 'pr-merged', 'pr-closed', 'pr-draft', 'check', 'x', 'dot']) {
    const page = await render(doc([card()], { header: { badge: { text: 'Stato', tone: 'viola', icon } } }));
    assert.match(page, /<span class="mb-badge" data-tone="viola"><svg class="mb-icon" viewBox="0 0 16 16"[^>]*><path fill="currentColor" d="M[0-9][^"]+"><\/path><\/svg>Stato<\/span>/, icon);
  }
  assert.match(await render(doc([card()], { header: { badge: { text: 'Senza icona', tone: 'blu' } } })), /<span class="mb-badge" data-tone="blu">Senza icona<\/span>/);
  await assert.rejects(render(doc([card()], { header: { badge: { text: 'x', tone: 'blu', icon: 'rocket' } } })), /header\.badge\.icon must be one of pr-open, pr-merged, pr-closed, pr-draft, check, x, dot/);
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
  assert.deepEqual({ ...prompt.data }, { file: 'src/a.js', line: 2, side: 'RIGHT', text: 'Meglio una costante.' });
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
  assert.match(html, /<nav class="mb-tabs" aria-label="Schede"><a href="#sintesi" data-mb-tab="sintesi">Sintesi<\/a><a href="#file" data-mb-tab="file">File modificati<span class="mb-count">3<\/span><\/a><\/nav><section id="sintesi">/);
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
