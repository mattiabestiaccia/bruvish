import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { renderDocument, renderRecord, familyFor, FAMILIES } from '../lib/document.mjs';
const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname;
const css = await readFile(new URL('../assets/artifact.css', import.meta.url), 'utf8');
const artifactJs = await readFile(new URL('../assets/artifact.js', import.meta.url), 'utf8');
const card = (id, extra = {}) => ({ id, title: 'Carta ' + id, status: 'info', paragraphs: [['Una frase.']], ...extra });
const doc = (cards, extra = {}) => ({ title: 'Prova', guide: 'Leggi.', sections: [{ id: 's', title: 'Sezione', cards }], ...extra });
const novelties = html => Object.fromEntries([...html.matchAll(/<article class="card" id="([^"]+)"[^>]*?(?: data-mb-new="(\w+)")?>/g)].map(m => [m[1], m[2] || '']));
const familyOf = html => /data-mb-family="(\w+)"/.exec(html)?.[1];

// Values from laboratorio-stile/lavish/DESIGN.md and riferimenti/famiglia-temi.json (contrasto pieno).
const expected = {
  B: { card: 'rgba(36,31,52,0.5)', line: '#4a4462', ink: '#e6e0f2', muted: '#b4adc9', title: '#c7abfa' },
  F: { card: 'rgba(22,36,54,0.5)', line: '#364a64', ink: '#d9e5f4', muted: '#a1b4cc', title: '#e1a3e4' },
  E2: { card: 'rgba(14,41,30,0.5)', line: '#2d5242', ink: '#d5e9df', muted: '#9bbaab', title: '#f3a972' },
  G2: { card: 'rgba(5,40,44,0.5)', line: '#245156', ink: '#d1e9eb', muted: '#95babe', title: '#4ed1de' },
  D3: { card: 'rgba(38,30,51,0.5)', line: '#4d4360', ink: '#e3e2f5', muted: '#a5b1cb', title: '#49cbbd' }
};

test('the five theme families carry the DESIGN.md values; B is also the default for hand-written pages', () => {
  assert.deepEqual(FAMILIES, Object.keys(expected));
  for (const [family, vars] of Object.entries(expected)) {
    const block = (family === 'B' ? css.match(/:root\{([^}]*)\}/) : css.match(new RegExp(':root\\[data-mb-family=' + family + '\\]\\{([^}]*)\\}')))[1];
    for (const [name, value] of Object.entries(vars)) assert(block.includes('--' + name + ':' + value), family + ' --' + name);
  }
});

test('state is a still glow in fixed colours: neutral border, no coloured left border, titles never coloured by state', () => {
  assert.doesNotMatch(css, /border-left/, 'no left border at all');
  for (const [name, value] of Object.entries({ red: '#fe8b83', yellow: '#d6ab32', green: '#63ca84', blue: '#6bb5ff' })) assert(css.includes('--mb-' + name + ':' + value));
  const cardRule = css.match(/\.card\{([^}]*)\}/)[1];
  assert.match(cardRule, /border:1px solid var\(--line\)/);
  assert.match(cardRule, /box-shadow:0 0 0 1px color-mix\(in srgb,var\(--mb-state-color\) 55%,transparent\)/);
  assert.doesNotMatch(css, /data-mb-state=\w+\][^{]*h3\{/, 'no state-coloured titles');
  assert.doesNotMatch(css, /box-shadow:[^;}]*rgba\(0,\s*0,\s*0/, 'no dark shadows');
  for (const state of ['waiting', 'answered', 'blocked']) assert.match(css, new RegExp('\\.card\\[data-mb-state=' + state + '\\]\\{--mb-state-color:var\\(--mb-\\w+\\)\\}'));
});

test('typography and measures: body 19px, nothing under 16px in pages, column min(907px, 100% - 40px)', () => {
  assert.match(css, /body\{[^}]*font:19px\/1\.45 /);
  assert.match(css, /main\{width:min\(907px,100% - 40px\)/);
  const sizes = [...css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  assert(sizes.length && sizes.every(size => size >= 16), 'font sizes ' + sizes);
  assert.match(css, /h1,h2,h3,legend\{[^}]*font-variant-caps:small-caps/);
});

test('novelty pulses on a separate layer for 2 s in the state colour and is off with reduced motion', () => {
  assert.match(css, /\.card\[data-mb-new\]::after\{[^}]*animation:mb-novelty 2s ease-in-out infinite/);
  assert.match(css, /@keyframes mb-novelty\{[^@]*var\(--mb-state-color\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.card\[data-mb-new\]::after\{animation:none;display:none\}\}/);
});

test('the theme is drawn from the artifact identity and kept across revisions of the same output', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-mb-theme-'));
  try {
    const input = path.join(dir, 'input.json');
    await writeFile(input, JSON.stringify(doc([card('a')])));
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const output = path.join(dir, 'page-' + i + '.html');
      const first = spawnSync(process.execPath, [cli, 'render', input, '--output', output], { encoding: 'utf8' });
      assert.equal(first.status, 0, first.stderr);
      const family = familyOf(await readFile(output, 'utf8'));
      assert.equal(family, familyFor(path.resolve(output)));
      seen.add(family);
      await writeFile(input, JSON.stringify(doc([card('a', { title: 'Cambiata ' + i }), card('b')], { title: 'Titolo nuovo ' + i })));
      assert.equal(spawnSync(process.execPath, [cli, 'render', input, '--output', output]).status, 0);
      assert.equal(familyOf(await readFile(output, 'utf8')), family, 'theme fixed across revisions');
      await writeFile(input, JSON.stringify(doc([card('a')])));
    }
    assert(seen.size >= 3, 'different artifacts draw different themes: ' + [...seen]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A theme recorded in the previous page wins over the identity; an explicit theme wins over both.
  const previous = await renderDocument(doc([card('a')], { theme: 'E2' }));
  assert.equal(familyOf(await renderDocument(doc([card('a')]), { id: 'altro', previous })), 'E2');
  assert.equal(familyOf(await renderDocument(doc([card('a')], { theme: 'D3' }), { previous })), 'D3');
  await assert.rejects(renderDocument(doc([card('a')], { theme: 'Z' })), /Unknown theme family/);
});

test('novelty: cards new or changed since the previous revision, stable on identical re-render, not caused by answers', async () => {
  const first = await renderDocument(doc([card('a'), card('b'), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } })]));
  assert.deepEqual(novelties(first), { a: '', b: '', c: '' }, 'a first revision has nothing to compare with');
  const record = renderRecord(first);
  assert.equal(record.version, 1);
  assert.deepEqual(Object.keys(record.cards), ['a', 'b', 'c']);
  const second = await renderDocument(doc([card('a'), card('b', { paragraphs: [['Testo nuovo.']] }), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } }), card('d')]), { previous: first });
  assert.deepEqual(novelties(second), { a: '', b: 'changed', c: '', d: 'new' });
  const again = await renderDocument(doc([card('a'), card('b', { paragraphs: [['Testo nuovo.']] }), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } }), card('d')]), { previous: second });
  assert.deepEqual(novelties(again), novelties(second), 'an identical re-render keeps the same novelties');
  // Key order is irrelevant; the reader's own answer does not mark a card as changed, and a new state
  // revision (a new round) compares with the page it replaces, so last round's pulses stop.
  const reordered = { paragraphs: [['Una frase.']], status: 'info', title: 'Carta a', id: 'a' };
  const answered = await renderDocument(doc([reordered, card('b', { paragraphs: [['Testo nuovo.']] }), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } }), card('d')], { state: { revision: 1, answers: { c: { choice: 'x' } }, comments: [] } }), { previous: again });
  assert.deepEqual(novelties(answered), { a: '', b: '', c: '', d: '' });
  assert.match(answered, /id="c" data-mb-state="answered"/);
  // A new agent response to a comment is a change the reader should see.
  const commented = await renderDocument(doc([reordered, card('b', { paragraphs: [['Testo nuovo.']] }), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } }), card('d')], { state: { revision: 2, answers: { c: { choice: 'x' } }, comments: [{ id: 'k', card: 'a', text: 'Perché?', response: 'Ecco.' }] } }), { previous: answered });
  assert.deepEqual(novelties(commented), { a: 'changed', b: '', c: '', d: '' });
  // The reader's own comment, still without a response, is not a change from the agent.
  const asked = await renderDocument(doc([reordered, card('b', { paragraphs: [['Testo nuovo.']] }), card('c', { status: 'waiting', question: { options: [{ value: 'x', label: 'X' }] } }), card('d')], { state: { revision: 3, answers: { c: { choice: 'x' } }, comments: [{ id: 'k', card: 'a', text: 'Perché?', response: 'Ecco.' }, { id: 'm', card: 'b', text: 'E questo?' }] } }), { previous: commented });
  assert.deepEqual(novelties(asked), { a: '', b: '', c: '', d: '' });
  assert.equal(renderRecord('<p>not a page</p>'), null);
  assert.equal(renderRecord('<script type="application/json" id="mb-render">{broken</script>'), null);
});

test('the CLI compares with the page it overwrites', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-mb-novelty-'));
  try {
    const input = path.join(dir, 'input.json'), output = path.join(dir, 'page.html');
    await writeFile(input, JSON.stringify(doc([card('a'), card('b')])));
    assert.equal(spawnSync(process.execPath, [cli, 'render', input, '--output', output]).status, 0);
    await writeFile(input, JSON.stringify(doc([card('a'), card('b', { title: 'Nuovo titolo' }), card('c')])));
    assert.equal(spawnSync(process.execPath, [cli, 'render', input, '--output', output]).status, 0);
    assert.deepEqual(novelties(await readFile(output, 'utf8')), { a: '', b: 'changed', c: 'new' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function runArtifactJs({ userAgent, storage, preset, pointer = 'fine' }) {
  const attributes = {}, listeners = {}, events = [], buttons = [{ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, fn) { this.click = fn; } }];
  let observer = null;
  const root = { dataset: preset ? { mbMode: preset } : {} };
  const document = { documentElement: root, readyState: 'complete', querySelectorAll: selector => selector === '[data-mb-mode-switch]' ? buttons : [], addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatchEvent: event => events.push(event) };
  const localStorage = storage === 'blocked' ? undefined : { data: { ...storage }, getItem(key) { return this.data[key] ?? null; }, setItem(key, value) { this.data[key] = value; } };
  const context = { document, navigator: { userAgent }, matchMedia: query => ({ matches: query === '(pointer: ' + pointer + ')' }), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, MutationObserver: class { constructor(fn) { observer = fn; } observe() { } } };
  // A sandboxed iframe throws on localStorage access.
  Object.defineProperty(context, 'localStorage', { get() { if (!localStorage) throw new Error('SecurityError'); return localStorage; } });
  vm.runInNewContext(artifactJs, context);
  return { root, buttons, events, localStorage, observer, attributes };
}
const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const electronMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) lavish-private/0.3.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36';
const pixel = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

test('artifacts paint dark before the app supplies its single authoritative mode, ignoring old saved choices', () => {
  for (const userAgent of [chromeMac,pixel,electronMac]) for (const saved of ['dark','transparent','bogus']) {
    const run=runArtifactJs({userAgent,storage:{'lavish-mb:mode':saved},preset:'transparent'});
    assert.equal(run.root.dataset.mbMode,'dark');
    assert.equal(run.localStorage.data['lavish-mb:mode'],saved,'legacy storage is neither read nor rewritten');
    assert.equal(run.buttons[0].click,undefined,'no artifact switch click handler');
  }
  assert.equal(runArtifactJs({userAgent:chromeMac,storage:'blocked'}).root.dataset.mbMode,'dark');
});

test('rendered pages carry no transparency switch, only a dark-first mode bootstrap before body paint', async () => {
  const html = await renderDocument(doc([card('a')]), { id: 'x' });
  assert.match(html, /<html lang="it" data-mb-theme="dark" data-mb-family="(B|F|E2|G2|D3)"/);
  assert(html.indexOf("root.dataset.mbMode = 'dark'") < html.indexOf('<body>'));
  assert.doesNotMatch(html, /data-mb-mode-switch|class="mb-mode"|mb-switch|>Trasparenza</);
  assert.doesNotMatch(html, /mb-theme-standalone|data-mb-theme-button/);
});

test('runtime mode travels from the app to the artifact, never from web storage or an artifact choice', async () => {
  const bridge = await readFile(new URL('../assets/bridge.js', import.meta.url), 'utf8');
  const addon = await readFile(new URL('../assets/chrome-addon.js', import.meta.url), 'utf8');
  assert.match(bridge, /m\.type === 'lavish-mb:mode' && \['dark', 'transparent'\]\.includes\(m\.mode\)/);
  assert.match(bridge, /macApp && m\.mode === 'transparent' \? 'transparent' : 'dark'/);
  assert.match(bridge, /getPropertyValue\('--mb-state-color'\)/);
  assert.match(addon, /root\.dataset\.mbAppMode === 'transparent'/);
  assert.doesNotMatch(addon, /MODE_KEY|localStorage\.(?:getItem|setItem)\([^)]*(?:mode|MODE_KEY)/);
});

test('interview questions explain the two-tap answer and carry no free text field', async () => {
  const html = await renderDocument(doc([card('q', { status: 'waiting', question: { options: [{ value: 'si', label: 'Sì' }, { value: 'no', label: 'No' }] } })]));
  const form = html.match(/<form data-mb-question="q">[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(form, /<button|type="submit"|Aggiungi risposte/, 'the two-tap form has no redundant submit control');
  assert.match(form, /class="mb-hint"[^>]*>[^<]*Spazio/);
  assert.match(form, /<span class="queue-status" role="status"><\/span>/);
  assert.match(css, /input:focus-visible[^{}]*\{outline:3px/, 'keyboard focus remains visible');
  assert.match(css, /\.queue-status:empty\{margin:0\}/, 'empty live status has no button-sized gap and stays available to assistive tools');
  assert.doesNotMatch(html, /<textarea|<input(?![^>]*type="radio")/, 'notes go through the annotation tool');
});

test('a recommended interview option is marked for a brighter colour and never preselected; options without the field render as before', async () => {
  const options = [{ value: 'si', label: 'Sì', recommended: true }, { value: 'no', label: 'No' }, { value: 'forse', label: 'Forse', recommended: 'yes' }];
  const labels = html => [...html.matchAll(/<label class="([^"]+)"><input [^>]*value="(\w+)"([^>]*)>/g)].map(m => [m[2], m[1], m[3].includes('checked')]);
  const open = await renderDocument(doc([card('q', { status: 'waiting', question: { options } })]));
  assert.deepEqual(labels(open), [['si', 'option mb-recommended', false], ['no', 'option', false], ['forse', 'option', false]], 'only recommended: true counts, and it is not checked');
  const answered = await renderDocument(doc([card('q', { status: 'waiting', question: { options } })], { state: { revision: 1, answers: { q: { choice: 'no' } }, comments: [] } }));
  assert.deepEqual(labels(answered).map(([value, , checked]) => [value, checked]), [['si', false], ['no', true], ['forse', false]], 'the saved answer stays the only checked option');
});
