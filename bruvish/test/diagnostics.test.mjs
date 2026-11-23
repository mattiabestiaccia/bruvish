// Diagnostics of an operation executor: the last problem and the table of the attempts at the top of the section
// «diagnostica», from the structured diagnostics of the page. Pages without diagnostics are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from '../lib/document.mjs';

process.env.TZ = 'Europe/Rome';
// 23 November 2026, 14:05 and 14:20 in Rome.
const T1 = Date.UTC(2026, 10, 23, 13, 5) / 1000, T2 = Date.UTC(2026, 10, 23, 13, 20) / 1000;
const refused = { id: 'a2', ora: T2, operazione: 'unisci', fonte: 'chat', esito: 'rifiutato', motivo: 'La testa della PR è cambiata.', passo: 'Rifai il clic dalla pagina rigenerata.', dettaglio: 'head <abc> != <def>', frase: 'Mergia' };
const done = { id: 'a1', ora: T1, operazione: 'commento', fonte: 'pagina', esito: 'fatto', motivo: 'Commento pubblicato.' };
const diagnostics = { executor: { running: true, since: T1, version: '1', last_round: T2 }, view: { id_vista: 'f'.repeat(32) }, attempts: [refused, done], total: 2, problem: refused };
const producerCard = { id: 'carta-diagnostica-1', title: 'Stato dell\'esecutore', paragraphs: ['Acceso.'] };
const page = (extra = {}) => ({
    title: 'PR #16', theme: 'revisione', tabs: true,
    sections: [{ id: 'file', title: 'File', cards: [{ id: 'f', title: 'F', paragraphs: ['Uno.'] }] }, { id: 'diagnostica', title: 'Diagnostica', count: 2, cards: [producerCard] }],
    diagnostics, ...extra,
});
const body = html => html.slice(html.indexOf('<body>'));
const cardHtml = (html, id) => (new RegExp('<article class="card" id="' + id + '"[\\s\\S]*?</article>').exec(html) || [''])[0];

test('the last problem and the attempts table open the section «diagnostica», before its own cards', async () => {
    const html = await renderDocument(page());
    const section = /<section id="diagnostica"[\s\S]*?<\/section>/.exec(html)[0];
    const order = [...section.matchAll(/<article class="card" id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(order, ['mb-diag-problem', 'mb-diag-attempts', 'carta-diagnostica-1']);
    const problem = cardHtml(html, 'mb-diag-problem');
    assert.match(problem, /^<article class="card" id="mb-diag-problem" data-mb-state="blocked" data-mb-tone="rosso">/);
    assert.match(problem, /<h3>Ultimo problema<\/h3><span class="mb-labels"><span class="mb-label" data-tone="rosso">Rifiutato<\/span>/);
    assert.match(problem, /<th scope="row">Operazione<\/th><td><p><span class="sentence"><code>unisci<\/code> · 23 nov, 14:20 · chat<\/span><\/p><\/td>/);
    assert.match(problem, /<th scope="row">Causa<\/th><td><p><span class="sentence">La testa della PR è cambiata\.<\/span><\/p><\/td>/);
    assert.match(problem, /<th scope="row">Cosa fare<\/th><td><p><span class="sentence">Rifai il clic dalla pagina rigenerata\.<\/span><\/p><\/td>/);
    assert.match(problem, /<th scope="row">Frase<\/th><td><p><span class="sentence">«Mergia»<\/span><\/p><\/td>/);
    assert.match(problem, /<details class="mb-transcript"><summary>Dettaglio tecnico<\/summary><pre>head &lt;abc&gt; != &lt;def&gt;<\/pre><\/details>/, 'the technical detail is preformatted and escaped');
    const attempts = cardHtml(html, 'mb-diag-attempts');
    assert.match(attempts, /<thead><tr><th scope="col">Ora<\/th><th scope="col">Operazione<\/th><th scope="col">Fonte<\/th><th scope="col">Esito<\/th><th scope="col">Motivo<\/th><th scope="col">Cosa fare<\/th><\/tr><\/thead>/);
    assert.match(attempts, /<tr><td>23 nov, 14:20<\/td><td><code>unisci<\/code><\/td><td>chat<\/td><td><span class="mb-level" data-tone="rosso">Rifiutato<\/span><\/td><td>La testa della PR è cambiata\.<br>Frase: «Mergia»<\/td><td>Rifai il clic dalla pagina rigenerata\.<\/td><\/tr>/);
    assert.match(attempts, /<tr><td>23 nov, 14:05<\/td><td><code>commento<\/code><\/td><td>pagina<\/td><td><span class="mb-level" data-tone="verde">Fatto<\/span><\/td><td>Commento pubblicato\.<\/td><td>—<\/td><\/tr>/);
    assert.match(attempts, /<div class="mb-notes"><p><span class="sentence">2 di 2, dal più recente\.<\/span><\/p><\/div>/);
    assert.match(attempts, /data-mb-help/, 'the attempts card explains Rifiutato and Incerto in its help');
});

test('every outcome has its label and colour; an attempt still running shows «In corso»', async () => {
    const outcomes = { fatto: ['Fatto', 'verde'], parziale: ['Fatto a metà', 'giallo'], rimandato: ['Rimandato', 'giallo'], rifiutato: ['Rifiutato', 'rosso'], incerto: ['Incerto', 'rosso'], scartato: ['Scartato', 'blu'] };
    const attempts = [...Object.keys(outcomes).map((esito, i) => ({ id: 'x' + i, ora: T1, operazione: 'commento', esito })), { id: 'run', ora: T1, operazione: 'unisci' }];
    const html = await renderDocument(page({ diagnostics: { attempts, total: 30, problem: null } }));
    for (const [label, tone] of [...Object.values(outcomes), ['In corso', 'giallo']])
        assert.match(cardHtml(html, 'mb-diag-attempts'), new RegExp('<span class="mb-level" data-tone="' + tone + '">' + label + '</span>'));
    assert.match(html, /7 di 30, dal più recente\./, 'the note says how many of the total are shown');
    assert.equal(cardHtml(html, 'mb-diag-problem'), '', 'no problem: no problem card');
    // A problem that is only postponed or partial is yellow, not blocked.
    const late = await renderDocument(page({ diagnostics: { attempts: [], problem: { operazione: 'unisci', esito: 'rimandato', motivo: 'CI in corso.' } } }));
    assert.match(cardHtml(late, 'mb-diag-problem'), /^<article class="card" id="mb-diag-problem" data-mb-state="info" data-mb-tone="giallo">/);
});

test('no attempts: the card says so; no section «diagnostica»: Bruvish adds it at the end with its count', async () => {
    const empty = await renderDocument(page({ diagnostics: { attempts: [], total: 0, problem: null } }));
    assert.match(cardHtml(empty, 'mb-diag-attempts'), /<p><span class="sentence">Nessun tentativo\.<\/span><\/p>/);
    assert.doesNotMatch(cardHtml(empty, 'mb-diag-attempts'), /<table/);
    const input = page();
    input.sections = [input.sections[0]];
    const html = await renderDocument(input);
    assert.match(html, /<a href="#diagnostica" data-mb-tab="diagnostica" data-lavish-action>Diagnostica<span class="mb-count">2<\/span><\/a><\/nav>/, 'the new tab is the last one');
    assert.match(html, /<section id="diagnostica" aria-label="Diagnostica"><article class="card" id="mb-diag-problem"/);
    const none = { ...input, diagnostics: {} };
    assert.match(await renderDocument(none), /<a href="#diagnostica" data-mb-tab="diagnostica" data-lavish-action>Diagnostica<\/a>/, 'no attempts: no count');
});

test('a page without diagnostics is unchanged; malformed diagnostics stop the render with the expected shape', async () => {
    const { diagnostics: _, ...plain } = page();
    const html = await renderDocument(plain);
    assert.doesNotMatch(body(html), /mb-diag-/);
    assert.match(html, /<section id="diagnostica" aria-label="Diagnostica"><article class="card" id="carta-diagnostica-1"/);
    for (const bad of [null, [], 'x', { attempts: {} }, { attempts: [null] }, { attempts: [{ motivo: 3 }] }, { attempts: [{ ora: {} }] }, { total: -1 }, { total: 1.5 }, { problem: 'x' }, { problem: { esito: 1 } }])
        await assert.rejects(renderDocument(page({ diagnostics: bad })), /diagnostics must be/);
});

test('texts from the executor are escaped; an odd operation name is shown as text, not as code', async () => {
    const html = await renderDocument(page({ diagnostics: { attempts: [{ ora: 'adesso', operazione: 'x`<b>', esito: 'rifiutato', motivo: '<script>alert(1)</script>' }], problem: null } }));
    const attempts = cardHtml(html, 'mb-diag-attempts');
    assert.match(attempts, /<tr><td>adesso<\/td><td>x`&lt;b&gt;<\/td>/);
    assert.match(attempts, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(attempts, /<script>|<b>/);
});
