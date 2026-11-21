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
