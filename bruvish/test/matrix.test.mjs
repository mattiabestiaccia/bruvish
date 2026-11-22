import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from '../lib/document.mjs';

const documentWith = table => ({
    title: 'Matrix', guide: 'Compare', sections: [{ id: 's', title: 'Section', cards: [{ id: 'c', title: 'Choices', table }] }],
});
const matrix = { variant: 'matrix', headers: ['Criterion', 'Option'], rows: [['Cost', { text: '+ Low', tone: 'verde', detail: '\"<b> & detail' }]] };

test('matrix has semantic headings and native disclosure with escaped content', async () => {
    const html = await renderDocument(documentWith(matrix));
    assert.match(html, /<th scope="col">Option<\/th>/);
    assert.match(html, /<th scope="row">Cost<\/th>/);
    assert.match(html, /<details data-tone="verde"><summary title="&quot;&lt;b&gt; &amp; detail">\+ Low<\/summary>/);
    assert.doesNotMatch(html, /<summary title=""<b>/);
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
