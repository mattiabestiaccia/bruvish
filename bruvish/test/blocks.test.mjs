// Building blocks of the renderer beyond the interview cards (tabs, header, pills, tones, labels, help, tables,
// notes, diffs with line comments, free text in answers, events). Every field is optional: a page without them
// renders exactly as before, with the same assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderDocument, cardFingerprint } from '../lib/document.mjs';
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
  // The minimap reads --mb-state-color; an answered card keeps the green of its state.
  for (const [tone, color] of [['blu', 'var(--mb-blue)'], ['verde', 'var(--mb-green)'], ['giallo', 'var(--mb-yellow)'], ['rosso', 'var(--mb-red)'], ['decidi', '#e8c35a']])
    assert.match(blocksCss, new RegExp('\\.card\\[data-mb-tone=' + tone + '\\]:not\\(\\[data-mb-state=answered\\]\\)\\{--mb-state-color:' + color.replace(/[()]/g, '\\$&') + '\\}'), tone);
  assert.match(blocksCss, /\.card\[data-mb-tone\]\{[^}]*background:linear-gradient\(color-mix\(in srgb,var\(--mb-state-color\) 7%,transparent\)/, 'light tint of the card background');
  assert.match(blocksCss, /\.card\[data-mb-tone=decidi\]:not\(\[data-mb-state=answered\]\)\{[^}]*box-shadow:[^}]*#e8c35a/, 'decidi glows the most');
  await assert.rejects(render(doc([card({ tone: 'fucsia' })])), /Card a: tone must be one of blu, verde, giallo, rosso, decidi, viola/);
});

test('the new card fields enter the fingerprint only when present', () => {
  const plain = card({ status: 'waiting' });
  assert.equal(cardFingerprint({ ...plain, tone: undefined }), cardFingerprint(plain));
  for (const extra of [{ tone: 'rosso' }])
    assert.notEqual(cardFingerprint({ ...plain, ...extra }), cardFingerprint(plain), Object.keys(extra)[0]);
});

test('labels sit right after the card title, on the same line, with inline marks and a tone', async () => {
  const html = await render(doc([card({ labels: [{ text: '**Bloccante** <b>', tone: 'rosso' }, { text: 'tipo `doc`', tone: 'blu' }] })]));
  assert.match(cardHtml(html), /<div class="mb-card-head"><h3>Una carta<\/h3><span class="mb-labels"><span class="mb-label" data-tone="rosso"><strong>Bloccante<\/strong> &lt;b&gt;<\/span><span class="mb-label" data-tone="blu">tipo <code>doc<\/code><\/span><\/span><\/div><p>/);
  assert.match(blocksCss, /\.mb-card-head\{[^}]*display:flex/);
  assert.match(blocksCss, /\.mb-card-head h3\{[^}]*margin:0/);
  for (const labels of ['x', [{ text: '', tone: 'blu' }], [{ text: 'a', tone: 'nero' }], [{ tone: 'blu' }]])
    await assert.rejects(render(doc([card({ labels })])), /Card a: labels/);
});

test('help opens with a click on «?» in the flow of the card, closes with another click, never on hover, and is not read aloud', async () => {
  const html = await render(doc([card({ help: 'Serve a **decidere**. Poi chiudi.' })]));
  const body = cardHtml(html);
  assert.match(body, /<div class="mb-card-head"><h3>Una carta<\/h3><button class="mb-help-toggle" type="button" data-mb-help aria-expanded="false" aria-controls="mb-help-a" aria-label="A cosa serve questa carta">\?<\/button><\/div><div class="mb-help" id="mb-help-a" hidden><p><span class="sentence">Serve a <strong>decidere<\/strong>.<\/span><span class="sentence">Poi chiudi.<\/span><\/p><\/div><p>/);
  assert.match(blocksCss, /\.mb-help\{[^}]*background:#0b1114/, 'opaque dark panel');
  assert.doesNotMatch(blocksCss, /\.mb-help\{[^}]*position:(absolute|fixed)/, 'in the flow, not over the card');
  assert.doesNotMatch(blocksJs, /mouseover|mouseenter|:hover[^{]*\.mb-help\b/, 'never on hover');
  const { document, window } = boot(html);
  const button = document.querySelector('[data-mb-help]'), panel = document.getElementById('mb-help-a');
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
  assert.match(blocksCss, /\.mb-badge\{[^}]*color:#fff/);
  const license = await readFile(new URL('../licenses/Octicons-MIT.txt', import.meta.url), 'utf8');
  assert.match(license, /MIT License[\s\S]*GitHub/);
});

test('a card table has headers and rows; « · » puts two items on two lines; a { text, tone } cell is a level', async () => {
  const table = { headers: ['File', 'Rischio', 'Nota'], rows: [['`a.js` · `b.js`', { text: 'alto', tone: 'rosso' }, '**sì** <i>'], ['c', { text: 'basso', tone: 'verde' }, '']] };
  const body = cardHtml(await render(doc([card({ fields: [{ label: 'Oggi', paragraphs: ['Uno.'] }], table })])));
  assert.match(body, /<\/table><table class="mb-table"><thead><tr><th scope="col">File<\/th><th scope="col">Rischio<\/th><th scope="col">Nota<\/th><\/tr><\/thead><tbody><tr><td><code>a\.js<\/code><br><code>b\.js<\/code><\/td><td><span class="mb-level" data-tone="rosso">alto<\/span><\/td><td><strong>sì<\/strong> &lt;i&gt;<\/td><\/tr><tr><td>c<\/td><td><span class="mb-level" data-tone="verde">basso<\/span><\/td><td><\/td><\/tr><\/tbody><\/table>/, 'after the fields');
  assert.match(cardHtml(await render(doc([card({ table: { rows: [['x']] } })]))), /<table class="mb-table"><tbody><tr><td>x<\/td><\/tr><\/tbody><\/table>/, 'headers are optional');
  // Levels: semantic colour halfway between a soft tint and a full fill (.livello of revisione.css).
  assert.match(blocksCss, /\.mb-level\[data-tone=rosso\]\{[^}]*background:rgba\(218,54,51,\.55\)/);
  for (const bad of [[], { rows: 'x' }, { headers: ['a'], rows: [['x', 'y']] }, { rows: [[1]] }, { rows: [[{ text: 'x', tone: 'nero' }]] }])
    await assert.rejects(render(doc([card({ table: bad })])), /Card a: table/);
});
