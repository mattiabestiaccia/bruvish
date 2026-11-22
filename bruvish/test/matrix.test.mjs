import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderDocument } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const documentWith = table => ({
    title: 'Matrix', guide: 'Compare', sections: [{ id: 's', title: 'Section', cards: [{ id: 'c', title: 'Choices', table }] }],
});
const matrix = { variant: 'matrix', headers: ['Criterion', 'Option'], rows: [['Cost', { text: '+ Low', tone: 'verde', detail: '\"<b> & detail' }]] };

const three = { variant: 'matrix', headers: ['Criterio', 'Disco', 'Cloud'], rows: [
    ['Costo', { text: '+ Una spesa', tone: 'verde', detail: 'Una volta sola.' }, { text: '− Abbonamento', tone: 'rosso', detail: 'Ogni mese.' }],
    ['Rete', { text: '+ Subito', tone: 'verde', detail: 'Senza rete.' }, { text: '~ Dipende', tone: 'giallo', detail: 'Serve la *rete*.' }],
    ['Tempo', { text: '~ Un pomeriggio.', tone: 'blu', detail: 'Da montare.' }, { text: '~ Da scegliere', tone: 'decidi', detail: 'Dipende dal piano.' }]] };

function boot(html) {
    const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
    const window = createWindow(document);
    vm.runInNewContext(/<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1], window);
    return document;
}

test('form C: criteria in rows, options as header buttons, cells keep their size, a Bilancio row and one card per option', async () => {
    const html = await renderDocument(documentWith(three));
    assert.match(html, /<th scope="col" class="mb-matrix-criterion">Criterio<\/th><th scope="col"><button type="button" class="mb-matrix-option" data-mb-matrix-col="1" aria-pressed="false">Disco<\/button><\/th>/);
    assert.match(html, /<th scope="row" class="mb-matrix-criterion">Costo<\/th><td data-mb-matrix-col="1"><button type="button" class="mb-matrix-cell" data-tone="verde" aria-pressed="false" title="Una volta sola\."/);
    assert.match(html, /<tr class="mb-matrix-balance"><th scope="row" class="mb-matrix-criterion">Bilancio<\/th><td data-mb-matrix-col="1"><span class="mb-matrix-counts"><span data-tone="verde">\+ 2<\/span><span data-tone="rosso">− 0<\/span><span data-tone="giallo">~ 1<\/span><\/span><\/td><td data-mb-matrix-col="2"><span class="mb-matrix-counts"><span data-tone="verde">\+ 0<\/span><span data-tone="rosso">− 1<\/span><span data-tone="giallo">~ 2<\/span>/);
    assert.match(html, /<div class="mb-matrix-detail" aria-live="polite">/);
    assert.match(html, /<section class="mb-matrix-card"><h4>Cloud<\/h4>.*<details data-tone="giallo"><summary><small>Rete<\/small>~ Dipende<\/summary><p>Serve la <em>rete<\/em>\.<\/p><\/details>/);
});

test('a tapped cell shows its reason under the table; a tapped option highlights its column', async () => {
    const document = boot(await renderDocument(documentWith(three)));
    const cells = document.querySelectorAll('.mb-matrix-cell'), box = document.querySelector('.mb-matrix-detail');
    cells[3].click();
    assert.equal(cells[3].getAttribute('aria-pressed'), 'true');
    assert.match(box.innerHTML, /<b>Cloud · Rete:<\/b> ~ Dipende\. Serve la <em>rete<\/em>\./);
    cells[4].click();
    assert.match(box.innerHTML, /<b>Disco · Tempo:<\/b> ~ Un pomeriggio\. Da montare\./);
    assert.doesNotMatch(box.innerHTML, /\.\./);
    cells[0].click();
    assert.deepEqual(cells.map(c => c.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false', 'false']);
    const [disco, cloud] = document.querySelectorAll('.mb-matrix-option');
    cloud.click();
    assert.equal(cloud.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(document.querySelectorAll('td[data-mb-matrix-col]').map(td => td.classList.contains('mb-matrix-dim')), [true, false, true, false, true, false, true, false]);
    cloud.click();
    assert.ok(document.querySelectorAll('td[data-mb-matrix-col]').every(td => !td.classList.contains('mb-matrix-dim')));
    assert.equal(disco.getAttribute('aria-pressed'), 'false');
});

test('a reason with markup is escaped in the title and rendered once in the box', async () => {
    const html = await renderDocument(documentWith(matrix));
    assert.match(html, /title="&quot;&lt;b&gt; &amp; detail"/);
    assert.doesNotMatch(html, /title=""<b>/);
    assert.match(html, /data-mb-matrix-detail="&lt;b&gt;Option · Cost:&lt;\/b&gt; \+ Low\. &amp;quot;&amp;lt;b&amp;gt; &amp;amp; detail"/);
});

test('matrix rejects an incomplete cell; ordinary tables are unchanged', async () => {
    await assert.rejects(renderDocument(documentWith({ ...matrix, rows: [['Cost', '+ Low']] })), /cells with text, tone and detail/);
    const html = await renderDocument(documentWith({ headers: ['Cost'], rows: [['Low']] }));
    assert.match(html, /<table class="mb-table">.*<td>Low<\/td>/);
});

test('an unknown table variant stops the render instead of falling back to an ordinary table', async () => {
    await assert.rejects(renderDocument(documentWith({ ...matrix, variant: 'matrice' })), /table\.variant must be "matrix" or absent \(got "matrice"\)/);
});

test('a matrix cell without tone or text, or a short row, stops the render with the matrix message', async () => {
    const message = /a matrix needs column headers, row labels and cells with text, tone and detail/;
    await assert.rejects(renderDocument(documentWith({ ...matrix, rows: [['Cost', { text: '+ Low', detail: 'why' }]] })), message);
    await assert.rejects(renderDocument(documentWith({ ...matrix, rows: [['Cost', { tone: 'verde', detail: 'why' }]] })), message);
    await assert.rejects(renderDocument(documentWith({ ...matrix, rows: [['Cost']] })), message);
});

test('a matrix with an empty option name or criterion label stops the render with the matrix message', async () => {
    const message = /a matrix needs column headers, row labels and cells with text, tone and detail/;
    await assert.rejects(renderDocument(documentWith({ ...matrix, headers: ['Criterion', ' '] })), message);
    await assert.rejects(renderDocument(documentWith({ ...matrix, rows: [['', matrix.rows[0][1]]] })), message);
});
