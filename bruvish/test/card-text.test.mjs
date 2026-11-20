import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderDocument, cardFingerprint, inline, splitSentences } from '../lib/document.mjs';
const css = await readFile(new URL('../assets/artifact.css', import.meta.url), 'utf8');
const artifactJs = await readFile(new URL('../assets/artifact.js', import.meta.url), 'utf8');
const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname;
const example = new URL('../examples/carte-complete.json', import.meta.url).pathname;
const doc = (cards, extra = {}) => ({ title: 'Prova', guide: 'Leggi.', sections: [{ id: 's', title: 'Sezione', cards }], ...extra });
const cardHtml = (html, id) => html.match(new RegExp('<article class="card" id="' + id + '"[\\s\\S]*?</article>'))[0];
const sentences = html => [...html.matchAll(/<span class="sentence">([\s\S]*?)<\/span>/g)].map(m => m[1]);

test('inline marks become fixed tags and everything else stays escaped', () => {
  assert.equal(inline('Usa `gh pr view`, **sempre** e *subito*.'), 'Usa <code>gh pr view</code>, <strong>sempre</strong> e <em>subito</em>.');
  assert.equal(inline('**Grassetto con `codice` e *corsivo* fine**'), '<strong>Grassetto con <code>codice</code> e <em>corsivo</em> fine</strong>');
  assert.equal(inline('Un `<b>tag</b>` resta testo'), 'Un <code>&lt;b&gt;tag&lt;/b&gt;</code> resta testo');
  assert.equal(inline('<script>alert(1)</script> **<img src=x onerror=alert(1)>**'), '&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
  assert.equal(inline('"virgolette" & \'apici\''), '&quot;virgolette&quot; &amp; &#39;apici&#39;');
  // A code span is literal: no marks inside, and a star inside code never closes an outer mark.
  assert.equal(inline('`mcp__x__*` e `**non grassetto**`'), '<code>mcp__x__*</code> e <code>**non grassetto**</code>');
  assert.equal(inline('*vedi `a*b`*'), '<em>vedi <code>a*b</code></em>');
  // Unmatched or spaced marks stay literal: globs, products, lone backticks.
  for (const literal of ['2 * 3 * 4', '~/.pi/* e ~/.codex*', 'un ` solo', '``', '** e * x*', 'snake_case_name'])
    assert.equal(inline(literal), literal.replace(/&/g, '&amp;'));
});

test('a string with several sentences is split at sentence ends, not at abbreviations, numbers, paths or marks', () => {
  const cases = {
    'Uno. Due! Tre? Quattro… Cinque.': ['Uno.', 'Due!', 'Tre?', 'Quattro…', 'Cinque.'],
    'Il file `settings.json`. Poi va.': ['Il file `settings.json`.', 'Poi va.'],
    'Versione 0.1.97 pronta. 33 regole restano.': ['Versione 0.1.97 pronta.', '33 regole restano.'],
    'Vedi es. Claude o cfr. S42. Poi basta.': ['Vedi es. Claude o cfr. S42.', 'Poi basta.'],
    'Il dott. Rossi e M. Verdi firmano per la S.p.A. Fine.': ['Il dott. Rossi e M. Verdi firmano per la S.p.A. Fine.'],
    '1. Primo punto. Secondo.': ['1. Primo punto.', 'Secondo.'],
    'Il 20 nov. 2026 parte.': ['Il 20 nov. 2026 parte.'],
    'Chi è? Se è un familiare lo metto.': ['Chi è?', 'Se è un familiare lo metto.'],
    '«Va bene.» Poi via.': ['«Va bene.»', 'Poi via.'],
    'Lo dice «chi?» e tace.': ['Lo dice «chi?» e tace.'],
    '`disableRemoteControl` passa a `false`. `gh` resta.': ['`disableRemoteControl` passa a `false`.', '`gh` resta.'],
    '**Uno. Due.** Tre.': ['**Uno. Due.**', 'Tre.'],
    '`a. B` resta.': ['`a. B` resta.'],
    'Uno.\nDue.': ['Uno.', 'Due.'],
    'Effetto pratico: quel push non parte più da solo: lo valuta il classificatore.': ['Effetto pratico: quel push non parte più da solo: lo valuta il classificatore.'],
    'Senza punto finale': ['Senza punto finale'],
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(splitSentences(text), expected, text);
  // A non-breaking space after the point keeps the two parts on one line.
  assert.deepEqual(splitSentences('Rif.\u00a0Bianchi arriva. Fine.'), ['Rif.\u00a0Bianchi arriva.', 'Fine.']);
});

test('every rendered sentence is one line: multi-sentence strings are split everywhere the agent writes text', async () => {
  const card = { id: 'a', title: 'Carta', status: 'waiting', paragraphs: ['Prima. Seconda.', [{ text: 'Evidenziata. Anche questa.', highlight: true }]], clarification: ['Chiarisco. Poi aggiungo.'], fields: [{ label: 'Oggi', paragraphs: 'Una. Due.' }], question: { options: [{ value: 'x', label: 'X. Y', recommended: true }], reason: 'Motivo uno. Motivo due.' } };
  const html = await renderDocument(doc([card], { intro: 'Intro uno. Intro due.', guide: 'Guida uno. Guida due.', state: { revision: 1, answers: {}, comments: [{ id: 'c', card: 'a', text: 'Domanda mia. Seconda.', response: 'Risposta uno. Risposta due.' }] } }));
  const body = cardHtml(html, 'a');
  assert.match(body, /<p><span class="sentence">Prima\.<\/span><span class="sentence">Seconda\.<\/span><\/p>/);
  assert.match(body, /<span class="sentence"><mark>Evidenziata\.<\/mark><\/span><span class="sentence"><mark>Anche questa\.<\/mark><\/span>/);
  for (const pair of [['Chiarisco.', 'Poi aggiungo.'], ['Una.', 'Due.'], ['Motivo uno.', 'Motivo due.'], ['Risposta uno.', 'Risposta due.']]) assert(sentences(body).join('|').includes(pair.join('|')), pair.join(' '));
  for (const pair of [['Intro uno.', 'Intro due.'], ['Guida uno.', 'Guida due.']]) assert(sentences(html).join('|').includes(pair.join('|')), pair.join(' '));
  // Labels and the reader's own comment are never split: the comment stays verbatim and unformatted.
  assert.match(body, /<span>X\. Y<\/span>/);
  assert.match(body, /<span class="sentence">Domanda mia\. Seconda\.<\/span>/);
});

test('card fields render as a two-column table with labels from the JSON, after the body paragraphs', async () => {
  const card = { id: 'push', title: 'Push su `main`', status: 'waiting', paragraphs: [['Una premessa.']], fields: [{ label: 'Oggi', paragraphs: ['Due regole allow nella base.'] }, { label: 'Proposta', paragraphs: [['Togliere le due regole.', 'Non diventa un divieto.']] }, { label: 'Effetto *pratico*', paragraphs: ['Il push non parte da solo.', 'Il push forzato resta vietato.'] }], question: { options: [{ value: 'a', label: 'A', recommended: true }] } };
  const body = cardHtml(await renderDocument(doc([card])), 'push');
  const table = body.match(/<table class="mb-fields">[\s\S]*?<\/table>/)[0];
  const rows = [...table.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><\/tr>/g)];
  assert.deepEqual(rows.map(r => r[1]), ['Oggi', 'Proposta', 'Effetto <em>pratico</em>']);
  assert.equal(rows[1][2], '<p><span class="sentence">Togliere le due regole.</span><span class="sentence">Non diventa un divieto.</span></p>');
  assert.equal((rows[2][2].match(/<p>/g) || []).length, 2, 'an array of strings is a list of paragraphs, as in the card body');
  assert(body.indexOf('Una premessa.') < body.indexOf('<table class="mb-fields">') && body.indexOf('<table class="mb-fields">') < body.indexOf('<form'), 'body, then fields, then question');
  assert.match(body, /<h3>Push su <code>main<\/code><\/h3>/);
  assert.doesNotMatch(cardHtml(await renderDocument(doc([{ ...card, fields: [] }])), 'push'), /mb-fields/, 'an empty list draws no table');
});

test('malformed fields are refused with an error that shows the expected shape', async () => {
  for (const fields of ['Oggi', [{ paragraphs: ['x'] }], [{ label: ' ', paragraphs: ['x'] }], [{ label: 'Oggi' }], [null]])
    await assert.rejects(renderDocument(doc([{ id: 'a', title: 'A', fields }])), /Card a: fields must be an array of \{ "label": "Oggi", "paragraphs": \["Una frase\."\] \}/);
});

test('the reason for the recommended option sits right under the answers, before the hint, in the card style', async () => {
  const question = { label: 'Cosa ne *faccio*?', options: [{ value: 'a', label: 'Togliere `allow`', recommended: true }, { value: 'b', label: 'Lasciare' }], reason: ['Un push su `main` non si annulla. **Nessuno** lo usa.'] };
  const form = cardHtml(await renderDocument(doc([{ id: 'q', title: 'Q', status: 'waiting', paragraphs: [['Testo.']], question }])), 'q').match(/<form[\s\S]*?<\/form>/)[0];
  assert.match(form, /<legend>Cosa ne <em>faccio<\/em>\?<\/legend>/);
  assert.match(form, /<span>Togliere <code>allow<\/code><\/span>/);
  const reason = form.match(/<table class="mb-fields mb-reason">[\s\S]*?<\/table>/)[0];
  assert.match(reason, /<th scope="row">Motivazione<\/th>/);
  assert.match(reason, /<span class="sentence">Un push su <code>main<\/code> non si annulla\.<\/span><span class="sentence"><strong>Nessuno<\/strong> lo usa\.<\/span>/);
  assert(form.lastIndexOf('</label>') < form.indexOf('mb-reason') && form.indexOf('mb-reason') < form.indexOf('class="mb-hint"'), 'answers, reason, hint');
  await assert.rejects(renderDocument(doc([{ id: 'q', title: 'Q', question: { options: [{ value: 'a', label: 'A' }], reason: 'Perché sì.' } }])), /Card q: question\.reason explains the recommended option; mark that option with "recommended": true/);
  await assert.rejects(renderDocument(doc([{ id: 'q', title: 'Q', question: { options: [{ value: 'a', label: 'A', recommended: true }], reason: ' ' } }])), /Card q: question\.reason is empty/);
  assert.doesNotMatch(cardHtml(await renderDocument(doc([{ id: 'q', title: 'Q', question: { options: [{ value: 'a', label: 'A', recommended: true }] } }])), 'q'), /mb-reason/, 'no reason, no table');
});

test('comments and responses are a two-column table; only the agent response is formatted', async () => {
  const state = { revision: 1, answers: {}, comments: [{ id: 'c1', card: 'a', text: 'Perché **questo**? <b>x</b>', response: 'Perché `gh` lo fa. *Sempre*.' }, { id: 'c2', card: 'a', text: 'Ancora aperto.' }] };
  const follow = cardHtml(await renderDocument(doc([{ id: 'a', title: 'A', paragraphs: [['Testo.']] }], { state })), 'a').match(/<details class="followup">[\s\S]*?<\/details>/)[0];
  const tables = [...follow.matchAll(/<table class="mb-fields mb-comment">([\s\S]*?)<\/table>/g)].map(m => m[1]);
  assert.equal(tables.length, 2);
  assert.match(tables[0], /<th scope="row">Commento<\/th><td><p><span class="sentence">Perché \*\*questo\*\*\? &lt;b&gt;x&lt;\/b&gt;<\/span><\/p><\/td>/);
  assert.match(tables[0], /<th scope="row">Risposta<\/th><td><p><span class="sentence">Perché <code>gh<\/code> lo fa\.<\/span><span class="sentence"><em>Sempre<\/em>\.<\/span><\/p><\/td>/);
  assert.doesNotMatch(tables[1], /Risposta/, 'an unanswered comment has no response row');
});

test('metadata and clarification carry inline marks; nothing in the page opens raw HTML from the input', async () => {
  const attack = '<img src=x onerror=alert(1)>';
  const html = await renderDocument(doc([{ id: 'a', title: attack + ' `t`', status: 'waiting', metadata: 'Fonte: `inventario.md` ' + attack, clarification: ['**Nota** ' + attack], paragraphs: [[attack + ' *it*']], fields: [{ label: attack, paragraphs: [attack] }], question: { label: attack, options: [{ value: 'v"><script>', label: attack, recommended: true }], reason: attack } }], { state: { revision: 1, answers: {}, comments: [{ id: 'c', card: 'a', text: attack, response: attack }] } }));
  const body = cardHtml(html, 'a');
  assert.doesNotMatch(body, /<img|<script|onerror=alert\(1\)>/);
  assert.match(body, /<div class="meta">Fonte: <code>inventario\.md<\/code> &lt;img/);
  assert.match(body, /<strong>Nota<\/strong> &lt;img/);
  assert.match(body, /value="v&quot;&gt;&lt;script&gt;"/);
});

test('fields are part of the card fingerprint; cards without fields keep the fingerprint of earlier versions', async () => {
  const card = { id: 'q', title: 'Una `domanda`', status: 'waiting', paragraphs: [['Prima frase.', 'Seconda frase.']], metadata: 'Fonte', question: { label: 'Scegli', options: [{ value: 'a', label: 'A', recommended: true }, { value: 'b', label: 'B' }] } };
  const comments = [{ id: 'c', card: 'q', text: 'Perché?', response: 'Perché sì.' }];
  assert.equal(cardFingerprint(card, comments), '28e7bf5dea04b879', 'computed with the renderer before fields existed');
  const withFields = { ...card, fields: [{ label: 'Oggi', paragraphs: ['Uno.'] }] };
  assert.notEqual(cardFingerprint(withFields), cardFingerprint(card));
  assert.notEqual(cardFingerprint({ ...withFields, fields: [{ label: 'Oggi', paragraphs: ['Due.'] }] }), cardFingerprint(withFields));
  assert.notEqual(cardFingerprint({ ...card, question: { ...card.question, reason: 'Perché.' } }), cardFingerprint(card), 'the reason is part of the question');
  const previous = await renderDocument(doc([card]));
  const next = await renderDocument(doc([withFields]), { previous });
  assert.match(next, /<article class="card" id="q"[^>]* data-mb-new="changed"/);
});

test('inline marks use the vaporbrus dark palette and spacing grows from lines to sentences to paragraphs, in cells too', () => {
  assert.match(css, /strong\{color:#e5c07b;/);
  assert.match(css, /em\{color:#e9d5ff;/);
  assert.match(css, /code\{color:#ffb38a;/);
  const em = (rule, prop) => Number(new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*' + prop + ':([\\d.]+)em').exec(css)[1]);
  const lineGap = 1.45 - 1, sentenceGap = em('.sentence+.sentence', 'margin-top'), paragraphGap = Number(/(?:^|\})p\{margin:0 0 ([\d.]+)em/m.exec(css)[1]), cellParagraphGap = Number(/\.mb-fields td p\{margin:0 0 ([\d.]+)em/.exec(css)[1]);
  assert.match(css, /body\{[^}]*font:19px\/1\.45 /);
  assert(lineGap < sentenceGap && sentenceGap < paragraphGap, 'body: ' + [lineGap, sentenceGap, paragraphGap]);
  assert(sentenceGap < cellParagraphGap, 'cells: ' + [sentenceGap, cellParagraphGap]);
  assert.match(css, /\.mb-fields th\{width:1%;white-space:nowrap;vertical-align:top;color:var\(--title\)/);
  assert.match(css, /@media\(max-width:600px\)\{\.mb-fields th,\.mb-fields td\{display:block/, 'phones stack label above content');
});

test('the voice reads the field table, label then sentences', () => {
  assert.match(artifactJs, /:scope>p, :scope>\.mb-fields tr/);
  assert.match(artifactJs, /querySelector\('th'\)\.textContent \+ ': '/);
});

test('the example with every card novelty renders through the CLI', async () => {
  const input = JSON.parse(await readFile(example, 'utf8'));
  const cards = input.sections.flatMap(s => s.cards);
  assert(cards.some(c => c.fields?.length) && cards.some(c => c.question?.reason) && input.state.comments.some(c => c.response));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-cards-'));
  try {
    const output = path.join(dir, 'page.html');
    const r = spawnSync(process.execPath, [cli, 'render', example, '--output', output], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = await readFile(output, 'utf8');
    for (const needle of ['class="mb-fields"', 'mb-reason', 'mb-comment', '<code>', '<strong>', '<em>']) assert(html.includes(needle), needle);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
