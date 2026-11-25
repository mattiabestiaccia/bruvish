import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
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
  // ==text== is a highlight (the straw yellow of the approved review page); it may hold code, bold and italic.
  assert.equal(inline('stampa ==lo stesso aiuto==, uscita **0**'), 'stampa <mark>lo stesso aiuto</mark>, uscita <strong>0</strong>');
  assert.equal(inline('==**basso**, `-h` e *ok*=='), '<mark><strong>basso</strong>, <code>-h</code> e <em>ok</em></mark>');
  assert.equal(inline('**molto ==forte==**'), '<strong>molto <mark>forte</mark></strong>');
  assert.equal(inline('`a ==b==`'), '<code>a ==b==</code>');
  assert.equal(inline('==<b>=='), '<mark>&lt;b&gt;</mark>');
  // Comparisons, banners and unmatched or spaced marks stay literal.
  for (const literal of ['-h == --help', 'x === y', '=== PRIMA ===', '== a ==', 'a==', '==a\nb=='])
    assert.equal(inline(literal), literal);
});

test('a string with several sentences is split at sentence ends, not at abbreviations, numbers, paths or marks', () => {
  const cases = {
    'Uno. Due! Tre? Quattro… Cinque.': ['Uno.', 'Due!', 'Tre?', 'Quattro…', 'Cinque.'],
    'Il file `settings.json`. Poi va.': ['Il file `settings.json`.', 'Poi va.'],
    'Prima ==evidenziata==. ==Seconda== frase.': ['Prima ==evidenziata==.', '==Seconda== frase.'],
    'Una ==frase intera.== Poi va.': ['Una ==frase intera.==', 'Poi va.'],
    'Uno ==a. Due== resta.': ['Uno ==a. Due== resta.'],
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
    'Premi Tab. Poi scegli Set. Ok.': ['Premi Tab.', 'Poi scegli Set.', 'Ok.'],
    'Torna ad ago. Poi riparti.': ['Torna ad ago.', 'Poi riparti.'],
    'Vedi pag. 3 e art. 5 del testo. Fine.': ['Vedi pag. 3 e art. 5 del testo.', 'Fine.'],
    'Vale dal 3 ago. 2026. Poi scade.': ['Vale dal 3 ago. 2026.', 'Poi scade.'],
    'Due strade: 1. Tenere la regola. 2. Toglierla.': ['Due strade:', '1. Tenere la regola.', '2. Toglierla.'],
    'Prima; 2. Seconda via. 3. Terza.': ['Prima;', '2. Seconda via.', '3. Terza.'],
    // A number after a colon or a semicolon without the next number later is a count that ends its sentence.
    'Errori: 0. Avvisi: 2.': ['Errori: 0.', 'Avvisi: 2.'],
    'Regole trovate: 33. Ne tolgo 2.': ['Regole trovate: 33.', 'Ne tolgo 2.'],
    'Totale: 3. Poi chiudo.': ['Totale: 3.', 'Poi chiudo.'],
    'Voti; 12. Contrari 3.': ['Voti; 12.', 'Contrari 3.'],
    'Errori: 1. Avvisi: 2. Controllo finito.': ['Errori: 1.', 'Avvisi: 2.', 'Controllo finito.'],
    'Voti: 12. Contrari: 13. Astenuti: 0.': ['Voti: 12.', 'Contrari: 13.', 'Astenuti: 0.'],
    'Passati: 3. Falliti: 4. Rilancio i test.': ['Passati: 3.', 'Falliti: 4.', 'Rilancio i test.'],
    '**Scelte: 1.** Prima. 2. Seconda.': ['**Scelte: 1.**', 'Prima.', '2. Seconda.'],
    'Ne restano 3. Poi basta.': ['Ne restano 3.', 'Poi basta.'],
    '**Scelte: 1. Una.** Fine.': ['**Scelte: 1. Una.**', 'Fine.'],
    // Known limit: a sentence ending with a single letter stays joined to the next one.
    'Premi il tasto A. Poi esci.': ['Premi il tasto A. Poi esci.'],
    // Known limit: a string that opens with a number and a point keeps it joined to the next sentence.
    '33. Poi basta.': ['33. Poi basta.'],
    // Known limits of inline lists: a number abbreviation that looks like the next item, and items split by semicolons.
    'Errori: 1. Vedi pag. 2. Fine.': ['Errori:', '1. Vedi pag. 2.', 'Fine.'],
    'Due strade: 1. Tenere la regola; 2. Toglierla.': ['Due strade: 1.', 'Tenere la regola; 2.', 'Toglierla.'],
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
  for (const fields of ['Oggi', [{ paragraphs: ['x'] }], [{ label: ' ', paragraphs: ['x'] }], [{ label: 'Oggi' }], [null], ...[[], '', ' ', null, [[]]].map(paragraphs => [{ label: 'Oggi', paragraphs }])])
    await assert.rejects(renderDocument(doc([{ id: 'a', title: 'A', fields }])), /Card a: fields must be an array of \{ "label": "Oggi", "paragraphs": \["Una frase\."\] \}/);
});

test('a sentence of another shape stops the render instead of vanishing; intro, guide and clarification are one paragraph each', async () => {
  for (const card of [{ clarification: [['Uno.'], ['Due.']] }, { paragraphs: [[['Annidata.']]] }, { paragraphs: [[null]] }, { paragraphs: [[{ highlight: true }]] }, { fields: [{ label: 'Oggi', paragraphs: [[3]] }] }])
    await assert.rejects(renderDocument(doc([{ id: 'a', title: 'A', ...card }])), /A sentence is a string or \{ "text": "Una frase\.", "highlight": true \}/);
  await assert.rejects(renderDocument(doc([{ id: 'a', title: 'A' }], { guide: ' ' })), /usage guide are required/);
  const html = await renderDocument(doc([{ id: 'a', title: 'A', clarification: ['Uno.', 'Due.'] }], { intro: ['Prima.', 'Seconda.'], guide: ['Leggi.', 'Rispondi.'] }));
  for (const part of [html.match(/<header>[\s\S]*?<\/header>/)[0], html.match(/<details class="guide"[\s\S]*?<\/details>/)[0], cardHtml(html, 'a').match(/<details class="context"[\s\S]*?<\/details>/)[0]]) {
    assert.equal((part.match(/<p>/g) || []).length, 1, part);
    assert.equal(sentences(part).length, 2, part);
  }
});

test('the reason for the recommended option sits right under the answers, in the card style', async () => {
  const question = { label: 'Cosa ne *faccio*?', options: [{ value: 'a', label: 'Togliere `allow`', recommended: true }, { value: 'b', label: 'Lasciare' }], reason: ['Un push su `main` non si annulla. **Nessuno** lo usa.'] };
  const form = cardHtml(await renderDocument(doc([{ id: 'q', title: 'Q', status: 'waiting', paragraphs: [['Testo.']], question }])), 'q').match(/<form[\s\S]*?<\/form>/)[0];
  assert.match(form, /<legend>Cosa ne <em>faccio<\/em>\?<\/legend>/);
  assert.match(form, /<span>Togliere <code>allow<\/code><\/span>/);
  const reason = form.match(/<table class="mb-fields mb-reason">[\s\S]*?<\/table>/)[0];
  assert.match(reason, /<th scope="row">Motivazione<\/th>/);
  assert.match(reason, /<span class="sentence">Un push su <code>main<\/code> non si annulla\.<\/span><span class="sentence"><strong>Nessuno<\/strong> lo usa\.<\/span>/);
  assert(form.lastIndexOf('</label>') < form.indexOf('mb-reason') && form.indexOf('mb-reason') < form.indexOf('class="queue-status"'), 'answers, reason, status region');
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

// The stylesheet as rules: comments dropped, each rule a selector list and its declarations, with the media query it sits in.
function cssRules(source) {
  const rules = [];
  const walk = (text, media) => {
    for (let i = 0; i < text.length;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      const inner = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(inner, head.slice(6).replace(/\s+/g, ''));
      else if (!head.startsWith('@')) rules.push({ media, selectors: head.split(',').map(x => x.trim()), declarations: Object.fromEntries(inner.split(';').map(d => d.split(':')).filter(d => d.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()])) });
      i = j;
    }
  };
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return rules;
}
const rules = cssRules(css);
const declared = (selector, property, media = null) => rules.filter(r => r.media === media && r.selectors.includes(selector) && property in r.declarations).map(r => r.declarations[property]).at(-1);
const ems = value => Number(/^([\d.]+)em$/.exec(value.split(/\s+/)[2] ?? value)[1]);

test('inline marks use the vaporbrus dark palette and spacing grows from lines to sentences to paragraphs, in cells too', () => {
  // vaporbrus dark palette (agenti-comune template rules): bold yellow, italic lilac, inline code peach.
  assert.deepEqual(['strong', 'em', 'code'].map(tag => declared(tag, 'color')), ['#e5c07b', '#e9d5ff', '#ffb38a']);
  const lineGap = Number(/\/([\d.]+)\s/.exec(declared('body', 'font'))[1]) - 1;
  const sentenceGap = ems(declared('.sentence+.sentence', 'margin-top'));
  const paragraphGap = ems(declared('p', 'margin'));
  const cellParagraphGap = ems(declared('.mb-fields td p', 'margin'));
  assert(lineGap < sentenceGap && sentenceGap < paragraphGap, 'body: ' + [lineGap, sentenceGap, paragraphGap]);
  assert(sentenceGap < cellParagraphGap, 'cells: ' + [sentenceGap, cellParagraphGap]);
  assert.deepEqual(['width', 'white-space'].map(p => declared('.mb-fields th', p)), ['1%', 'nowrap'], 'the label column fits its text');
  assert.deepEqual(['.mb-fields th', '.mb-fields td'].map(s => declared(s, 'display', '(max-width:600px)')), ['block', 'block'], 'phones stack label above content');
});

// A small DOM built from the rendered page, enough to run artifact.js: elements, text, and selectors made of
// tags, classes and attributes joined by descendant or child combinators, with :scope.
function parseHtml(html) {
  const decode = text => text.replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e]);
  const make = (tagName, attributes = {}) => ({ tagName, attributes, children: [], parent: null, listeners: {},
    get classes() { return (this.attributes.class || '').split(/\s+/).filter(Boolean); },
    get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); },
    get elements() { return this.children.filter(c => typeof c !== 'string'); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    matches(selector) { return matchesList(this, selector, null); },
    closest(selector) { for (let el = this; el; el = el.parent) if (el.tagName && el.matches(selector)) return el; return null; },
    querySelectorAll(selector) { const found = [], visit = el => el.elements.forEach(c => { if (matchesList(c, selector, this)) found.push(c); visit(c); }); visit(this); return found; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; } });
  const root = make(''), stack = [root];
  for (const [, text, close, tag, attrs] of html.matchAll(/([^<]*)(?:<(\/?)([a-z0-9]+)([^>]*)>|$)/g)) {
    if (text) stack.at(-1).children.push(decode(text));
    if (!tag) continue;
    if (close) { stack.pop(); continue; }
    const el = make(tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, decode(v ?? '')])));
    el.parent = stack.at(-1); el.parent.children.push(el);
    if (!['input', 'meta', 'br', 'img'].includes(tag)) stack.push(el);
  }
  return root;
}
function matchesList(el, list, scope) {
  return list.split(',').some(selector => {
    const tokens = selector.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const compound = (node, token) => {
      if (token === ':scope') return node === scope;
      const m = /^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+\])*)$/.exec(token);
      if (!m) throw new Error('selector not supported by the test DOM: ' + token);
      return !!node.tagName && (!m[1] || node.tagName === m[1]) && [...m[2].matchAll(/\.([\w-]+)/g)].every(c => node.classes.includes(c[1])) && [...m[2].matchAll(/\[([\w-]+)\]/g)].every(a => a[1] in node.attributes);
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

test('the voice reads the title, the body sentences one by one, then each field as label and its sentences', async () => {
  const card = { id: 'a', title: 'Una `scheda`', status: 'waiting', paragraphs: ['Prima. Seconda.'], fields: [{ label: 'Oggi', paragraphs: ['Frase uno. Frase due.'] }], clarification: 'Dettaglio nascosto.', question: { options: [{ value: 'x', label: 'X', recommended: true }], reason: 'Perché sì.' } };
  const root = parseHtml(cardHtml(await renderDocument(doc([card])), 'a'));
  const spoken = [];
  const context = { document: { documentElement: { dataset: {} }, readyState: 'complete', querySelectorAll: selector => root.querySelectorAll(selector), addEventListener() { } }, HTMLInputElement: class { }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { speaking: false, speak: utterance => spoken.push(utterance), cancel() { } } };
  context.window = context;
  context.addEventListener = () => { };
  vm.runInNewContext(artifactJs, context);
  root.querySelector('[data-mb-voice]').listeners.click.forEach(fn => fn({}));
  assert.deepEqual(spoken.map(u => [u.text, u.lang]), [['Una scheda Prima. Seconda. Oggi: Frase uno. Frase due.', 'it-IT']]);
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

test('a bold sentence that ends with a period and a closing mark renders bold, at the start of a value or after another sentence', async () => {
  const lead = '**Canale fra pannello ed esecutore (sezione 4).**';
  assert.equal(inline(lead), '<strong>Canale fra pannello ed esecutore (sezione 4).</strong>');
  for (const text of [lead + ' Oggi la vista sta in `pagina.html`, che gli agenti leggono.', 'Una premessa. ' + lead + ' Oggi la vista sta in `pagina.html`.', lead + '\nOggi: `a.b` e `c`.']) {
    const parts = splitSentences(text);
    assert(parts.includes(lead), 'the bold sentence is one sentence: ' + JSON.stringify(parts));
    assert.equal(inline(lead), '<strong>Canale fra pannello ed esecutore (sezione 4).</strong>');
    assert(!parts.map(inline).join('').replace(/<code>[\s\S]*?<\/code>/g, '').includes('**'), 'no literal asterisks: ' + JSON.stringify(parts));
  }
  const body = cardHtml(await renderDocument(doc([{ id: 'campo', title: 'Campo', fields: [{ label: 'Che cosa dicono i riferimenti (rapporto dello scout, sezioni 4, 5.2 e 8)', paragraphs: [lead + ' Oggi la vista sta in `pagina.html`, che gli agenti nella sandbox leggono.'] }] }])), 'campo');
  assert.match(body, /<td><p><span class="sentence"><strong>Canale fra pannello ed esecutore \(sezione 4\)\.<\/strong><\/span><span class="sentence">Oggi la vista sta in <code>pagina\.html<\/code>/);
  // The marks are the writer's: a closing «**» put inside a code span (`.**`) is code, never a closing mark.
  assert.equal(inline('**Canale (sezione 4)`.**`'), '**Canale (sezione 4)<code>.**</code>');
});
