// The theme «vibe»: the scaffold of the round interview approved by Mattia on 25 novembre 2026 («B2 arricchito»,
// laboratorio-stile/lavish/consolidamento/vibe-B2-arricchito.html). Rounds as tabs, the intent always visible on the
// right and rewritten while the reader answers, who speaks in a table with the question as a row, the reason of the
// recommended answer on hover or long press, no note field. Asked by name only: every other page renders as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { renderDocument, renderRecord, familyFor, FAMILIES, NAMED_THEMES } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const asset = name => readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
const [fontsCss, baseCss, baseJs, blocksCss, blocksJs, vibeCss, vibeJs] = await Promise.all(['fonts.css', 'artifact.css', 'artifact.js', 'artifact-blocks.css', 'artifact-blocks.js', 'artifact-vibe.css', 'artifact-vibe.js'].map(n => asset(n).catch(() => '')));
const json = async url => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const example = () => json('../examples/vibe-b2.json');
const render = (input, options = {}) => renderDocument(input, { id: 'fixture', ...options });
const sha = text => createHash('sha256').update(text).digest('hex');
const skeleton = html => html.replace(/<style>[\s\S]*?<\/style><script>[\s\S]*?<\/script>/, '<style/><script/>');
const styleOf = html => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const scriptOf = html => /<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1];
const bodyOf = html => html.slice(html.indexOf('<body>'), html.indexOf('<script type="application/json"'));
const cardHtml = (html, id) => html.match(new RegExp('<article class="card" id="' + id + '"[\\s\\S]*?</article>'))[0];

// A small vibe page: one open round with a question card, one closed round, an intent.
const question = (extra = {}) => ({
  label: 'Su che cosa vuoi decidere?', differ: 'quanto è largo l\'oggetto.', reason: 'Sono le tre di novembre.',
  options: [{ value: 'tre', label: 'Le tre', recommended: true, intent: 'Tre decisioni, entro due settimane.' }, { value: 'una', label: 'Una sola', intent: 'Una sola decisione.' }],
  ...extra,
});
const vibe = (extra = {}) => ({
  title: 'Vibe · Prova', guide: 'Rispondi.', theme: 'vibe',
  sections: [
    { id: 'giro-1', title: 'Giro 1 · il traguardo', open: true, cards: [
      { id: 'g1-ripasso', genre: 'ripasso', title: 'Ho capito così', speakers: [{ who: 'Tuo', text: 'Una frase tua.' }, { text: 'Il seguito.' }, { who: 'Verificato', text: 'Un fatto.' }] },
      { id: 'g1-q', genre: 'domanda', title: 'Quali decisioni', speakers: [{ who: 'Proposta', text: 'Ogni rapporto serve a una decisione.' }], question: question() },
      { id: 'g1-ipo', genre: 'ipotesi', title: 'Il perimetro', speakers: [{ who: 'Ipotesi', text: 'Lo scegli dopo.' }] },
    ] },
    { id: 'giro-0', title: 'Giro 0 · il perché', cards: [{ id: 'g0-perche', genre: 'chiuso', title: 'Perché', outcome: 'risposta nella nota', speakers: [{ who: 'Tuo', text: 'Il perché.' }] }] },
  ],
  intent: {
    summary: 'Ogni riga cambia con la tua risposta.', voice: 'Il traguardo, in breve.', output: 'Uscita: `traguardo.md`',
    rows: [
      { key: 'Perché', state: 'confirmed', round: 'giro 0', text: 'Rifare la revisione.' },
      { key: 'Decisioni', state: 'open', card: 'g1-q' },
      { key: 'Perimetro', state: 'hypothesis', card: 'g1-ipo', note: 'si sceglie al passo 1', text: 'Da spuntare al passo 1.' },
    ],
    question: { label: 'Dice ciò che vuoi?', options: [{ value: 'si', label: 'Sì', recommended: true }, { value: 'quasi', label: 'Quasi' }] },
    grey: ['Una zona grigia.'],
  },
  ...extra,
});

function boot(html, options) {
  const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
  const window = createWindow(document, options);
  const timers = [];
  Object.assign(window, { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; } });
  vm.runInNewContext(scriptOf(html), window);
  return { document, window, timers };
}
const selectorOf = (card, value) => '[data-mb-question="' + card + '"] input[value="' + value + '"]';

test('pages that do not ask for the theme «vibe» render exactly as before, with the same assets', async () => {
  // Skeleton hashes computed on carry (c31e865) before the theme existed; vibe-tipo-oggi is the example of today's type
  // vibe in agenti-comune (artefatti/vibe/esempio.json): pages made with today's type do not ask for the theme.
  const before = {
    '../examples/dummy.json': '8c899f6300efd2e1b560bc1e4d5270fae7bb2d95cefb32caa353a58c06698f99',
    '../examples/carte-complete.json': '14a5287082fb19399da30e8d483253b8b64ae47afb77eee5cdf649181ae6258e',
    '../examples/revisione-completa.json': '8bd2d92bb620d04bba5e064aaafbb787d04864e9e255a688f030c69f8bf4768b',
    './fixtures/revisione-postit-6.json': '4bc34861f93bdde144f8e06d9b331b40bf4deac98b9e5e065a986b23cf7c6d88',
    './fixtures/vibe-tipo-oggi.json': 'e1aff100278e2fe57619ac16f96a119d8c0de8627b560f299d00677afb16a0cf',
  };
  for (const [file, hash] of Object.entries(before)) {
    const html = await render(await json(file));
    assert.equal(sha(skeleton(html)), hash, file);
    assert.doesNotMatch(html, /mb-vibe|data-mb-family="vibe"/, file);
    const blocks = !/dummy|carte-complete|vibe-tipo-oggi/.test(file);
    assert.equal(styleOf(html), [fontsCss, baseCss, ...(blocks ? [blocksCss] : [])].join('\n'), file + ': stylesheet');
    assert.equal(scriptOf(html), [baseJs, ...(blocks ? [blocksJs] : [])].join('\n'), file + ': script');
  }
});

test('the theme «vibe» is asked by name, never drawn, kept by a later render, and brings its own assets', async () => {
  assert.equal(FAMILIES.includes('vibe'), false);
  assert(NAMED_THEMES.includes('vibe'));
  for (let i = 0; i < 200; i++) assert.notEqual(familyFor('seed-' + i), 'vibe');
  const html = await render(vibe());
  assert.match(html, /<html lang="it" data-mb-theme="dark" data-mb-family="vibe"/);
  assert.equal(styleOf(html), [fontsCss, baseCss, blocksCss, vibeCss].join('\n'));
  assert.equal(scriptOf(html), [baseJs, blocksJs, vibeJs].join('\n'));
  assert.equal(renderRecord(html).theme, 'vibe');
  // A later render of the same page keeps the theme, like «revisione».
  const again = await render(vibe({ theme: undefined }), { previous: html });
  assert.match(again, /data-mb-family="vibe"/);
  // The vibe fields exist only in the theme: elsewhere they stop the render with the shape expected.
  for (const [where, page] of [
    ['speakers', { title: 'P', guide: 'G', sections: [{ id: 's', title: 'S', cards: [{ id: 'a', title: 'A', speakers: [{ who: 'Tuo', text: 'x' }] }] }] }],
    ['genre', { title: 'P', guide: 'G', sections: [{ id: 's', title: 'S', cards: [{ id: 'a', title: 'A', genre: 'ripasso' }] }] }],
    ['outcome', { title: 'P', guide: 'G', sections: [{ id: 's', title: 'S', cards: [{ id: 'a', title: 'A', outcome: 'x' }] }] }],
    ['intent', { title: 'P', guide: 'G', intent: { rows: [] }, sections: [] }],
    ['open', { title: 'P', guide: 'G', sections: [{ id: 's', title: 'S', open: true, cards: [] }] }],
  ])
    await assert.rejects(render(page), new RegExp(where + '[^]*theme "vibe"'), where);
  await assert.rejects(render(vibe({ intent: undefined })), /theme "vibe" needs an intent/);
  await assert.rejects(render(vibe({ tabs: true })), /tabs/);
  await assert.rejects(render(vibe({ guide: undefined })), /usage guide/);
});

test('the scaffold: header, the bar of the rounds with the open one current, the rounds column and the intent on the right', async () => {
  const html = await render(vibe());
  const body = bodyOf(html);
  // Order in <main>: header, guide, the round bar, then the grid with the rounds and the intent.
  assert.match(body, /<main data-mb-vibe>[\s\S]*?<\/header><details class="guide" id="usage-guide">[\s\S]*?<\/details><nav class="mb-vibe-tabs" aria-label="Giri"><a href="#intent" class="mb-vibe-tab mb-vibe-phone" data-mb-round="intent" data-lavish-action>Intent <small>in costruzione<\/small><\/a><a href="#giro-1" class="mb-vibe-tab" data-mb-round="giro-1" data-lavish-action aria-current="page">Giro 1 <small data-mb-round-count>1 aperta<\/small><\/a><a href="#giro-0" class="mb-vibe-tab" data-mb-round="giro-0" data-lavish-action>Giro 0 <small>chiuso<\/small><\/a><\/nav><div class="mb-vibe" data-mb-vibe-open="giro-1"><div class="mb-vibe-rounds"><section id="giro-1" class="mb-vibe-round"><h2>Giro 1 · il traguardo<\/h2>/);
  assert.match(body, /<\/section><section id="giro-0" class="mb-vibe-round" data-mb-closed><h2>Giro 0 · il perché<\/h2><div class="mb-vibe-closed-list"><div class="mb-vibe-closed-item"><span>Perché<\/span><span class="mb-vibe-closed-answer">risposta nella nota<\/span><\/div><\/div><article class="card" id="g0-perche"/);
  assert.match(body, /<\/section><\/div><aside class="mb-vibe-intent" id="intent" aria-label="Intent">/);
  // Without an "open" round the first is the open one.
  const first = await render(vibe({ sections: vibe().sections.map(s => ({ ...s, open: undefined })) }));
  assert.match(first, /data-mb-vibe-open="giro-1"/);
  const open0 = vibe(); open0.sections[0].open = undefined; open0.sections[1].open = true;
  assert.match(await render(open0), /<a href="#giro-0" class="mb-vibe-tab" data-mb-round="giro-0" data-lavish-action aria-current="page">/);
  const twice = vibe(); twice.sections[1].open = true;
  await assert.rejects(render(twice), /only one section may be open/);
});

test('who speaks is a two-column table; a paragraph without a speaker continues the cell above; the question is a row of the same table', async () => {
  const html = await render(vibe());
  const ripasso = cardHtml(html, 'g1-ripasso');
  assert.match(ripasso, /<table class="mb-fields mb-vibe-speakers"><tbody><tr data-mb-who="tuo"><th scope="row">Tuo<\/th><td><p><span class="sentence">Una frase tua\.<\/span><\/p><p><span class="sentence">Il seguito\.<\/span><\/p><\/td><\/tr><tr data-mb-who="verificato"><th scope="row">Verificato<\/th><td><p><span class="sentence">Un fatto\.<\/span><\/p><\/td><\/tr><\/tbody><\/table>/);
  const q = cardHtml(html, 'g1-q');
  assert.match(q, /<table class="mb-fields mb-vibe-speakers"><tbody><tr data-mb-who="proposta">[\s\S]*?<\/tr><tr class="mb-vibe-question" data-mb-who="domanda"><th scope="row">Domanda<\/th><td><p class="mb-vibe-q" id="mb-q-g1-q">Su che cosa vuoi decidere\?<\/p><p class="mb-vibe-differ">Le opzioni differiscono per: quanto è largo l&#39;oggetto\.<\/p><\/td><\/tr><\/tbody><\/table><form data-mb-question="g1-q" class="mb-vibe-answers"><fieldset aria-labelledby="mb-q-g1-q">/);
  // The answers under the table: the recommended first, highlighted, with no label; no note field anywhere.
  assert.match(q, /<label class="option mb-recommended"><input data-mb-field="g1-q:choice" name="choice" type="radio" value="tre" aria-describedby="mb-tip-g1-q"><span>Le tre<\/span>/);
  const form = /<form[\s\S]*<\/form>/.exec(q)[0];
  assert.doesNotMatch(form.replace(/<div class="mb-vibe-tip"[\s\S]*?<\/div>/, ''), /consigliat|textarea|Motivazione/i);
  assert.doesNotMatch(q, /textarea|Motivazione/);
  // The reason is not in the card: a hidden tooltip, shown on hover, focus or long press.
  assert.match(q, /<div class="mb-vibe-tip" id="mb-tip-g1-q" role="tooltip" hidden><b>Perché la consiglio<\/b><p><span class="sentence">Sono le tre di novembre\.<\/span><\/p><p><span class="sentence">Se non rispondi, vale questa\.<\/span><\/p><\/div>/);
  for (const [bad, error] of [
    [[{ text: 'Senza chi.' }], /first entry of speakers needs who/],
    [[{ who: 'Altro', text: 'x' }], /who must be one of Tuo, Proposta, Verificato, Ipotesi, Dubbio/],
    [[{ who: 'Tuo', text: '' }], /speakers/],
    ['x', /speakers/],
  ]) {
    const page = vibe(); page.sections[0].cards[0].speakers = bad;
    await assert.rejects(render(page), error);
  }
  // The recommended answer is the first, and only the first; a note field (question.text) does not exist here.
  for (const [options, error] of [
    [[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', recommended: true }], /the first option is the recommended one/],
    [[{ value: 'a', label: 'A', recommended: true }, { value: 'b', label: 'B', recommended: true }], /the first option is the recommended one/],
  ]) {
    const page = vibe(); page.sections[0].cards[1].question = question({ options });
    await assert.rejects(render(page), error);
  }
  const noted = vibe(); noted.sections[0].cards[1].question = question({ text: { label: 'Nota' } });
  await assert.rejects(render(noted), /no note field/);
  const toned = vibe(); toned.sections[0].cards[0].tone = 'blu';
  await assert.rejects(render(toned), /genre gives the colour/);
});

test('a figure placeholder stays a plain sentence after the speakers; the question then opens a second table after it', async () => {
  const page = vibe(); page.sections[0].cards[1].paragraphs = ['@@FIG-0123456789ab@@'];
  const q = cardHtml(await render(page), 'g1-q');
  assert.match(q, /<\/tbody><\/table><p><span class="sentence">@@FIG-0123456789ab@@<\/span><\/p><table class="mb-fields mb-vibe-speakers"><tbody><tr class="mb-vibe-question"/);
});

test('colour by genre and the «?» in two halves: fixed per genre above, «Cosa notare qui» written for the card below', async () => {
  const html = await render(vibe());
  assert.match(cardHtml(html, 'g1-ripasso'), /^<article class="card" id="g1-ripasso" data-mb-state="info" data-mb-genre="ripasso">/);
  assert.match(cardHtml(html, 'g1-q'), /^<article class="card" id="g1-q" data-mb-state="waiting" data-mb-genre="domanda">/);
  assert.match(cardHtml(html, 'g1-ipo'), /data-mb-genre="ipotesi"/);
  assert.match(cardHtml(html, 'g0-perche'), /data-mb-genre="chiuso"/);
  // Every card has the «?»: the fixed half names the genre; a card help replaces the fixed text.
  assert.match(cardHtml(html, 'g1-ipo'), /<div class="mb-help" id="mb-help-g1-ipo" hidden><b class="mb-help-title">Ipotesi · a cosa serve<\/b><p><span class="sentence">Non è una domanda: è una cosa che do per buona senza la tua conferma\.<\/span>/);
  const page = vibe(); page.sections[0].cards[0].help = 'Un aiuto mio.'; page.sections[0].cards[0].summary = 'Da notare.';
  assert.match(cardHtml(await render(page), 'g1-ripasso'), /<b class="mb-help-title">Ripasso · a cosa serve<\/b><p><span class="sentence">Un aiuto mio\.<\/span><\/p><div class="mb-help-summary"><b class="mb-help-title">Cosa notare qui<\/b><p><span class="sentence">Da notare\.<\/span>/);
  // Defaults: a card with a question is a «domanda» waiting for an answer, any other a «ripasso».
  const bare = vibe(); bare.sections[0].cards = [{ id: 'x', title: 'X', question: question() }, { id: 'y', title: 'Y' }]; bare.intent.rows = [];
  const bareHtml = await render(bare);
  assert.match(cardHtml(bareHtml, 'x'), /data-mb-state="waiting" data-mb-genre="domanda"/);
  assert.match(cardHtml(bareHtml, 'y'), /data-mb-state="info" data-mb-genre="ripasso"/);
  const wrong = vibe(); wrong.sections[0].cards[0].genre = 'altro';
  await assert.rejects(render(wrong), /genre must be one of ripasso, domanda, ipotesi, schizzo, chiuso/);
  // 🔊 and «?» are the buttons Bruvish already has, in the same column.
  assert.match(cardHtml(html, 'g1-q'), /<button class="voice" type="button" data-mb-voice aria-label="Leggi questa scheda">🔊<\/button><div class="mb-card-head"><h3>Quali decisioni<\/h3><button class="mb-help-toggle"/);
});

test('the intent: rows in three states, the open one linked to its card with every possible text rendered, legend, closing question, grey zones', async () => {
  const html = await render(vibe());
  const aside = /<aside class="mb-vibe-intent"[\s\S]*?<\/aside>/.exec(html)[0];
  assert.match(aside, /^<aside class="mb-vibe-intent" id="intent" aria-label="Intent"><div class="mb-vibe-intent-box"><button class="voice" type="button" data-mb-voice data-mb-voice-text="Il traguardo, in breve\." aria-label="Leggi l&#39;intent">🔊<\/button><div class="mb-card-head"><h2>Intent in costruzione<\/h2><button class="mb-help-toggle"[^>]*aria-controls="mb-help-intent"[^>]*>\?<\/button><\/div><div class="mb-help" id="mb-help-intent" hidden><b class="mb-help-title">Intent · a cosa serve<\/b>/);
  assert.match(aside, /<div class="mb-vibe-row" data-mb-row-state="confirmed"><span class="mb-vibe-key"><span class="mb-vibe-dot"><\/span>Perché<\/span><span class="mb-vibe-value"><span class="mb-vibe-text">Rifare la revisione\.<\/span><small class="mb-vibe-where">confermato · giro 0<\/small><\/span><\/div>/);
  assert.match(aside, /<a class="mb-vibe-row" href="#g1-q" data-mb-row-state="open" data-mb-row-card="g1-q" data-mb-row-round="Giro 1"><span class="mb-vibe-key"><span class="mb-vibe-dot"><\/span>Decisioni<\/span><span class="mb-vibe-value"><span class="mb-vibe-text" data-mb-option="tre">Tre decisioni, entro due settimane\.<\/span><span class="mb-vibe-text" data-mb-option="una" hidden>Una sola decisione\.<\/span><small class="mb-vibe-where" data-mb-where="open">in discussione · se non rispondi vale questa · vai alla carta ›<\/small><small class="mb-vibe-where" data-mb-where="queued" hidden>risposta in coda · Giro 1<\/small><small class="mb-vibe-where" data-mb-where="sent" hidden>risposta inviata · Giro 1<\/small><\/span><\/a>/);
  assert.match(aside, /<a class="mb-vibe-row" href="#g1-ipo" data-mb-row-state="hypothesis"><span class="mb-vibe-key"><span class="mb-vibe-dot"><\/span>Perimetro<\/span><span class="mb-vibe-value"><span class="mb-vibe-text">Da spuntare al passo 1\.<\/span><small class="mb-vibe-where">ipotesi · si sceglie al passo 1 · vai alla carta ›<\/small><\/span><\/a>/);
  assert.match(aside, /<p class="mb-vibe-legend"><span class="mb-vibe-dot" data-mb-dot="confirmed"><\/span>confermato · <span class="mb-vibe-dot" data-mb-dot="open"><\/span>in discussione · <span class="mb-vibe-dot" data-mb-dot="hypothesis"><\/span>ipotesi<\/p><p class="mb-vibe-output">Uscita: <code>traguardo\.md<\/code><\/p>/);
  assert.match(aside, /<div class="mb-vibe-close"><p class="mb-vibe-q" id="mb-q-intent">Dice ciò che vuoi\?<\/p><form data-mb-question="intent" class="mb-vibe-answers"><fieldset aria-labelledby="mb-q-intent"><div class="mb-vibe-options mb-vibe-cols-1"><label class="option mb-recommended"><input data-mb-field="intent:choice" name="choice" type="radio" value="si">/);
  assert.match(aside, /<div class="mb-vibe-grey"><b>Zone grigie<\/b><p><span class="sentence">Una zona grigia\.<\/span><\/p><\/div><\/div><\/aside>$/);
  // An answer already in the state confirms its row with the chosen text, in the round of the card.
  const answered = await render(vibe({ state: { revision: 2, answers: { 'g1-q': { choice: 'una' } } } }));
  assert.match(answered, /<a class="mb-vibe-row" href="#g1-q" data-mb-row-state="confirmed"><span class="mb-vibe-key"><span class="mb-vibe-dot"><\/span>Decisioni<\/span><span class="mb-vibe-value"><span class="mb-vibe-text">Una sola decisione\.<\/span><small class="mb-vibe-where">confermato · Giro 1<\/small><\/span><\/a>/);
  // Without "intent", an option gives its label to the row.
  const labelled = vibe(); labelled.sections[0].cards[1].question = question({ options: [{ value: 'a', label: 'Solo A', recommended: true }, { value: 'b', label: 'B' }] });
  assert.match(await render(labelled), /<span class="mb-vibe-text" data-mb-option="a">Solo A<\/span>/);
  for (const [row, error] of [
    [{ key: 'X', state: 'open' }, /open row needs the id of a card with a question/],
    [{ key: 'X', state: 'open', card: 'g1-ripasso' }, /open row needs the id of a card with a question/],
    [{ key: 'X', state: 'confirmed', text: 'x' }, /confirmed row needs text and round/],
    [{ key: 'X', state: 'hypothesis' }, /hypothesis row needs text/],
    [{ key: 'X', state: 'boh', text: 'x' }, /state must be confirmed, open or hypothesis/],
    [{ state: 'confirmed', text: 'x', round: 'giro 0' }, /key/],
    [{ key: 'X', state: 'hypothesis', text: 'x', card: 'nessuna' }, /card must be the id of a card of this page/],
  ]) {
    const page = vibe(); page.intent.rows = [row];
    await assert.rejects(render(page), error, JSON.stringify(row));
  }
  // The intent id is reserved.
  const clash = vibe(); clash.sections[0].cards[0].id = 'intent';
  await assert.rejects(render(clash), /unique stable id: intent/);
});

test('without intent.voice the 🔊 of the intent reads, for an open row, the text the row shows', async () => {
  const input = vibe(); input.intent.voice = undefined;
  const voiceOf = html => /data-mb-voice-text="([^"]*)" aria-label="Leggi l&#39;intent"/.exec(html)[1];
  assert.match(voiceOf(await render(input)), /Decisioni: Tre decisioni, entro due settimane\./);
  const answered = { ...input, state: { revision: 1, answers: { 'g1-q': { choice: 'una' } }, comments: [] } };
  assert.match(voiceOf(await render(answered)), /Decisioni: Una sola decisione\./);
});

test('the counters of the open round count only the cards that wait, as the page script does', async () => {
  const input = vibe(); input.sections[0].cards[1].status = 'blocked';
  const html = await render(input);
  assert.match(html, /data-mb-state="blocked"/);
  assert.match(html, /<small data-mb-round-count>nessuna aperta<\/small>/);
  assert.match(html, /<span data-mb-vibe-status>0 domande in attesa · 0 risposte in coda<\/span>/);
});

test('every text of the theme goes through the escape: no HTML from the JSON reaches the page', async () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const page = vibe({ title: evil, intro: evil });
  page.sections[0].title = 'Giro 1 · ' + evil;
  page.sections[0].cards[0].title = evil;
  page.sections[0].cards[0].speakers = [{ who: 'Tuo', text: evil }, { text: evil }];
  page.sections[0].cards[1].question = question({ label: evil, differ: evil, reason: evil, options: [{ value: 'v"><b', label: evil, recommended: true, intent: evil }, { value: 'w', label: 'W' }] });
  page.sections[1].cards[0].outcome = evil;
  page.intent = { ...page.intent, title: evil, summary: evil, voice: evil, output: evil, grey: [evil], rows: [
    { key: evil, state: 'confirmed', round: evil, text: evil }, { key: evil, state: 'open', card: 'g1-q' }, { key: evil, state: 'hypothesis', note: evil, text: evil, card: 'g1-ipo' }] };
  const body = bodyOf(await render(page));
  assert.doesNotMatch(body, /<img|<b>W|onerror=alert\(1\)>/);
  assert.equal((body.match(/<script/g) || []).length, 0);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
});

// Runs the page and sends the chrome's queued-anchor list, as Lavish does after every queue change.
const queue = (window, ...selectors) => window.post({ type: 'lavish:queuedAnchors', selectors });

test('queuing an answer rewrites its intent row with the text of that option, green and pulsing; removing it brings the row back', async () => {
  const { document, window } = boot(await render(vibe()));
  const row = document.querySelector('[data-mb-row-card="g1-q"]'), card = document.getElementById('g1-q');
  const shown = () => row.querySelectorAll('.mb-vibe-text').filter(t => !t.hidden).map(t => t.textContent);
  const where = () => row.querySelectorAll('.mb-vibe-where').filter(t => !t.hidden).map(t => t.dataset.mbWhere);
  assert.deepEqual(shown(), ['Tre decisioni, entro due settimane.']);
  // Two taps on the second option: the existing two-tap code of artifact.js queues it with its selector.
  const input = document.querySelector(selectorOf('g1-q', 'una'));
  input.checked = true; input.click(); input.click();
  assert.equal(window.queued.at(-1).selector, selectorOf('g1-q', 'una'));
  queue(window, selectorOf('g1-q', 'una'));
  assert.equal(row.dataset.mbRowState, 'queued');
  assert.deepEqual(shown(), ['Una sola decisione.']);
  assert.deepEqual(where(), ['queued']);
  assert(row.classList.contains('mb-vibe-changed'), 'the changed row pulses');
  assert(card.classList.contains('mb-vibe-queued'), 'the card turns green');
  assert.equal(card.dataset.mbState, 'waiting', 'the state written by the agent stays');
  assert.equal(document.querySelector('[data-mb-round-count]').textContent, 'tutte in coda');
  assert.match(document.querySelector('[data-mb-vibe-status]').textContent, /0 domande in attesa · 1 risposta in coda/);
  // Delivered: «inviata»; then the answer leaves the queue from the panel: the row is open again.
  window.post({ type: 'lavish:deliveredAnchors', selectors: [selectorOf('g1-q', 'una')] });
  queue(window);
  assert.equal(row.dataset.mbRowState, 'queued');
  assert.deepEqual(where(), ['sent']);
  const fresh = boot(await render(vibe()));
  queue(fresh.window, selectorOf('g1-q', 'tre'));
  queue(fresh.window);
  const freshRow = fresh.document.querySelector('[data-mb-row-card="g1-q"]');
  assert.equal(freshRow.dataset.mbRowState, 'open');
  assert.deepEqual(freshRow.querySelectorAll('.mb-vibe-text').filter(t => !t.hidden).map(t => t.textContent), ['Tre decisioni, entro due settimane.']);
  assert.equal(fresh.document.getElementById('g1-q').classList.contains('mb-vibe-queued'), false);
  assert.equal(fresh.document.querySelector('[data-mb-round-count]').textContent, '1 aperta');
});

test('one round at a time: the tabs switch rounds; an intent row opens the round of its card and flashes the card', async () => {
  const { document, window } = boot(await render(vibe()));
  const rounds = () => document.querySelectorAll('.mb-vibe-round').filter(s => !s.hidden).map(s => s.id);
  const current = () => document.querySelectorAll('[data-mb-round]').filter(a => a.getAttribute('aria-current') === 'page').map(a => a.dataset.mbRound);
  assert.deepEqual(rounds(), ['giro-1']);
  assert.equal(document.querySelector('.mb-vibe').dataset.mbVibeView, 'round');
  document.querySelector('[data-mb-round="giro-0"]').click();
  assert.deepEqual(rounds(), ['giro-0']);
  assert.deepEqual(current(), ['giro-0']);
  // On a phone the intent is a tab of its own, before the rounds.
  document.querySelector('[data-mb-round="intent"]').click();
  assert.equal(document.querySelector('.mb-vibe').dataset.mbVibeView, 'intent');
  assert.deepEqual(current(), ['intent']);
  // A row linked to a card of a hidden round opens that round, scrolls to the card and flashes it.
  document.querySelector('[data-mb-row-card="g1-q"]').click();
  assert.deepEqual(rounds(), ['giro-1']);
  assert.equal(document.querySelector('.mb-vibe').dataset.mbVibeView, 'round');
  const card = document.getElementById('g1-q');
  assert(card.classList.contains('mb-vibe-flash'));
  assert.equal(card.scrolled, 1);
  // A reveal of the frame into a hidden round opens it first, as the tabs of Bruvish do.
  document.querySelector('[data-mb-round="giro-0"]').click();
  window.post({ type: 'lavish:revealElement', selector: '#g1-ipo' });
  assert.deepEqual(rounds(), ['giro-1']);
  // The hash of a card opens its round at load.
  const deep = boot(await render(vibe()), { hash: '#g0-perche' });
  assert.deepEqual(deep.document.querySelectorAll('.mb-vibe-round').filter(s => !s.hidden).map(s => s.id), ['giro-0']);
});

test('the reason of the recommended answer: on mouse hover, on keyboard focus, on a long press that does not choose', async () => {
  const { document, window, timers } = boot(await render(vibe()));
  const tip = document.getElementById('mb-tip-g1-q');
  const option = document.querySelector(selectorOf('g1-q', 'tre')).closest('label');
  document.dispatch(option, 'pointerenter', { pointerType: 'mouse', bubbles: false });
  assert.equal(tip.hidden, false);
  document.dispatch(option, 'pointerleave', { pointerType: 'mouse', bubbles: false });
  assert.equal(tip.hidden, true);
  document.dispatch(option, 'pointerenter', { pointerType: 'touch', bubbles: false });
  assert.equal(tip.hidden, true, 'a touch does not hover');
  document.dispatch(document.querySelector(selectorOf('g1-q', 'tre')), 'focusin');
  assert.equal(tip.hidden, false);
  document.dispatch(document.querySelector(selectorOf('g1-q', 'tre')), 'focusout');
  assert.equal(tip.hidden, true);
  // Long press: after half a second the reason shows; the click that follows the release neither selects nor arms.
  document.dispatch(option, 'touchstart');
  assert.equal(timers.at(-1).ms, 500);
  timers.at(-1).fn();
  assert.equal(tip.hidden, false);
  const end = document.dispatch(option, 'touchend');
  assert.equal(end.defaultPrevented, true, 'the release after a long press cancels the click');
  const input = document.querySelector(selectorOf('g1-q', 'tre'));
  const click = document.dispatch(input, 'click');
  assert.equal(click.defaultPrevented, true);
  assert.equal(document.querySelector('.mb-armed'), null, 'the long press does not arm the option');
  assert.equal(window.queued.length, 0);
  // A short tap still works as before.
  const tap = document.dispatch(option, 'touchstart');
  void tap;
  document.dispatch(option, 'touchend');
  input.checked = true; input.click();
  assert(input.closest('label').classList.contains('mb-armed'));
  // A tap elsewhere closes the reason.
  timers.at(-1).fn?.();
  document.dispatch(document.querySelector('h1'), 'touchstart');
  assert.equal(tip.hidden, true);
});

test('the example vibe-b2 uses the whole contract and renders through the CLI', async () => {
  const input = await example();
  assert.equal(input.theme, 'vibe');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-vibe-'));
  try {
    const file = path.join(dir, 'input.json'), output = path.join(dir, 'page.html');
    await writeFile(file, JSON.stringify(input));
    const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname;
    const r = spawnSync(process.execPath, [cli, 'render', file, '--output', output], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = await readFile(output, 'utf8');
    assert.match(html, /data-mb-family="vibe"/);
    for (const genre of ['ripasso', 'domanda', 'ipotesi', 'schizzo', 'chiuso']) assert.match(html, new RegExp('data-mb-genre="' + genre + '"'));
    for (const who of ['tuo', 'proposta', 'verificato', 'ipotesi']) assert.match(html, new RegExp('data-mb-who="' + who + '"'));
    for (const state of ['confirmed', 'open', 'hypothesis']) assert.match(html, new RegExp('data-mb-row-state="' + state + '"'));
    assert.equal((html.match(/class="mb-vibe-tip"/g) || []).length, 4);
    assert.match(html, /class="mb-vibe-grey"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
