// Widths of the review page with the tree bar, the files page and the spacing of lines, sentences and paragraphs
// (Mattia, 25 November 2026, on the first real review page in the new form: «Ora le viste card devono occupare tutta la
// larghezza, meno la larghezza che serve per il pannello laterale sinistro, che comunque va reso più stretto»; «le card
// non devono essere infinitamente larghe, bensì devono avere la stessa larghezza del resto e deve essere anche presente
// un tasto che attiva il ritorno a capo o lo disattiva»; «la distanza fra le righe, la distanza fra le frasi di un
// paragrafo e la distanza fra paragrafi devono essere distanze crescenti»). Only pages with "tabs": "tree" change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderDocument } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';
import { computed, layoutBox } from '../test-helpers/cascade.mjs';

const asset = name => readFile(new URL('../assets/' + name, import.meta.url), 'utf8');
const [fontsCss, baseCss, baseJs, blocksCss, blocksJs, treeCss, treeJs] = await Promise.all(['fonts.css', 'artifact.css', 'artifact.js', 'artifact-blocks.css', 'artifact-blocks.js', 'artifact-tree.css', 'artifact-tree.js'].map(n => asset(n).catch(() => '')));
const styleOf = html => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const scriptOf = html => /<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1];
const body = html => html.slice(html.indexOf('<body>'));
const render = (input, options = {}) => renderDocument(input, { id: 'fixture', ...options });
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-6, label + ': ' + actual + ' ≠ ' + expected);
// Mattia, after the preview: «Rendi un po' più strette queste card, del 20% rispetto a ora». One card width: 80% of the
// column right of the bar less the gutter of 🔊 and «?»; the cards stay left, beside the bar (a choice of the coordinator).
const cardWidth = column => (column - 48) * .8;
const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
function boot(html, { hash = '' } = {}) {
    const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
    const window = createWindow(document, { hash });
    window.lavish.sendQueuedPrompts = () => {};
    vm.runInNewContext(scriptOf(html), window);
    return { document, window };
}

const diff = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,2 +1,2 @@\n-a\n+' + 'b'.repeat(400) + '\n c\n';
// A tree page as pr-revisione-ai writes it: a short card, a long one, the files page with «Righe per file» above the diff.
const treePage = (extra = {}) => ({
    title: 'Una PR', theme: 'revisione', tabs: 'tree',
    groups: [{ id: 'gate', title: 'Gate', dot: 'verde', count: '6/6' }, { id: 'modifiche', title: 'Modifiche', count: '2' }],
    sections: [
        { id: 'sintesi', title: 'Sintesi', cards: [{ id: 'c-sintesi', title: 'Sintesi', paragraphs: [['Prima frase.', 'Seconda frase.'], 'Secondo paragrafo.'] }] },
        { id: 'rebase', title: 'Rebase', group: 'gate', dot: 'verde', cards: [{ id: 'c-rebase', title: 'Esito del rebase', tone: 'verde', table: { headers: ['Base', 'Esito'], rows: [['`main`', { text: 'pulito', tone: 'verde' }]] } }] },
        { id: 'intent', title: 'Intent', group: 'gate', dot: 'verde', cards: [{ id: 'c-intent', title: 'Intent', fields: [{ label: 'Chiesto', paragraphs: [['Una frase.', 'Un\'altra frase.'], 'Un paragrafo.'] }] }] },
        { id: 'file', title: 'File modificati', group: 'modifiche', count: 1, cards: [
            { id: 'carta-righe-per-file', title: 'Righe per file', tone: 'blu', paragraphs: ['Il file più toccato.'] },
            { id: 'carta-diff', title: 'File modificati', diff: { text: diff } },
        ] },
        { id: 'commit', title: 'Commit', group: 'modifiche', count: 1, cards: [{ id: 'c-commit', title: 'Commit', paragraphs: ['Testo.'] }] },
    ],
    ...extra,
});
const { tabs, groups, ...plain } = treePage({ tabs: true });
const tabsPage = { ...plain, tabs: true, sections: plain.sections.map(({ group, dot, ...s }) => s) };

test('a page without the tree keeps the assets of today: no tree stylesheet, no tree script, no wrap button', async () => {
    assert(treeCss && treeJs, 'artifact-tree.css and artifact-tree.js exist');
    const pages = [await readJson('../examples/revisione-completa.json'), await readJson('./fixtures/revisione-postit-6.json'), tabsPage, { ...tabsPage, tabs: false }];
    for (const page of pages) {
        const html = await render(page);
        assert.equal(styleOf(html), [fontsCss, baseCss, blocksCss].join('\n'), page.title + ': same stylesheet as today');
        assert.equal(scriptOf(html), [baseJs, blocksJs].join('\n'), page.title + ': same script as today');
        assert.doesNotMatch(body(html), /data-mb-nav|data-mb-diff-wrap|--mb-tree-rows/, page.title);
    }
});

test('a tree page adds the tree stylesheet and script after the blocks; main keeps the markup of before', async () => {
    const html = await render(treePage());
    assert.equal(styleOf(html), [fontsCss, baseCss, blocksCss, treeCss].join('\n'), 'the tree rules come last, so they win at equal specificity');
    assert.equal(scriptOf(html), [baseJs, blocksJs, treeJs].join('\n'));
    // The header sits above bar and cards (approved mockup barra-di-navigazione-albero.html): no row count is needed.
    assert.match(body(html), /<main data-mb-nav="tree"><header/);
    assert.doesNotMatch(html, /--mb-tree-rows/);
});

test('wide: header D above, as wide as bar, gap and cards; under it a narrower bar on the left and the cards on the right', async () => {
    const html = await render(treePage()), css = styleOf(html);
    const { document } = boot(html);
    const main = document.querySelector('main'), nav = document.querySelector('nav.mb-tree'), header = document.querySelector('header');
    const at = (el, width = 1280) => computed(css, el, width);
    assert.equal(at(main)['grid-template-columns'], '200px minmax(0,1fr)', 'the bar is 200px wide (236px before)');
    assert.equal(at(main)['column-gap'], '24px');
    assert.equal(at(nav)['grid-column'], '1');
    assert.equal(at(nav)['grid-row'], undefined, 'the bar starts under the header, as before');
    assert.equal(at(nav).position, 'sticky');
    for (const el of document.querySelectorAll('main > section'))
        assert.equal(at(el)['grid-column'], '2', el.id + ' sits right of the bar');
    // The header spans the whole grid: its left edge is the left edge of the bar.
    assert.equal(at(header)['grid-column'], '1/-1');
    // Long names wrap (at a space, or hyphenated) instead of widening the bar; the count stays whole.
    const name = document.querySelector('nav.mb-tree .mb-tree-name');
    assert.equal(at(name)['white-space'], 'normal');
    assert.equal(at(name).hyphens, 'auto');
    assert.equal(at(name)['overflow-wrap'], 'break-word');
    assert.equal(at(document.querySelector('nav.mb-tree .mb-count'))['white-space'], 'nowrap');
    // ...and its right edge is the right edge of the cards: bar (200px), gap (24px), then a card of 80% of the column less
    // the gutter of 🔊 and «?»; the column is the grid less bar and gap.
    const margin = 'calc((100% - 224px) * .2 + 38.4px)';
    assert.equal(at(header)['margin-right'], margin);
    for (const viewport of [1440, 1280, 900]) {
        const grid = layoutBox(css, main, viewport).inner;
        near(layoutBox(css, header, viewport).width, 224 + cardWidth(grid - 224), viewport + ': the header ends where the cards end');
    }
    const notice = boot(await render(treePage({ header: { notice: 'Prova.' } }))).document.querySelector('.mb-notice');
    assert.deepEqual([at(notice)['grid-column'], at(notice)['margin-right']], ['1/-1', margin], 'the notice, above the header, too');
    // A facts value wraps only when the narrower column cannot hold the table on one line.
    // (Table layout auto: a cell that fits stays on one line whatever white-space says.)
    const facts = boot(await render(treePage({ header: { facts: [{ label: 'Unisce', text: '`un-ramo-lungo` → `main`' }] } }))).document.querySelector('.mb-facts td');
    assert.equal(at(facts)['white-space'], 'normal');
    assert.equal(at(facts, 800)['white-space'], 'nowrap', 'the two-column narrow form keeps each value on one line');
    // Under 820px the bar is the horizontal bar of today: none of these rules apply.
    assert.equal(at(main, 800)['grid-template-columns'], undefined);
    assert.equal(at(name, 800).hyphens, undefined);
});

test('every card of a tree page has one width: 80% of the column right of the bar less the gutter of 🔊 and «?», on the left', async () => {
    const html = await render(treePage()), css = styleOf(html);
    const { document } = boot(html);
    const cards = document.querySelectorAll('article.card');
    assert.deepEqual(cards.map(c => c.id), ['c-sintesi', 'c-rebase', 'c-intent', 'carta-righe-per-file', 'carta-diff', 'c-commit']);
    for (const viewport of [1440, 1024, 700]) {
        for (const card of cards) {
            const section = card.parent, s = layoutBox(css, section, viewport), c = layoutBox(css, card, viewport);
            assert.equal(computed(css, section, viewport)['max-width'], 'none', viewport + ': ' + section.id + ' has no 907px cap');
            assert.equal(c.left, 0, viewport + ': ' + card.id + ' starts at the left edge of the column');
            near(c.width, cardWidth(s.inner), viewport + ': ' + card.id + ' is as wide as the others');
        }
    }
    // «Righe per file» was centred at 80% of a page without cap (the rule meant for the full-width files page), so it stood
    // to the right of the files and wider than every other card: now it lines up with them.
    const rows = layoutBox(css, document.getElementById('carta-righe-per-file'), 1440), files = layoutBox(css, document.getElementById('carta-diff'), 1440);
    assert.deepEqual([rows.left, rows.width], [files.left, files.width]);
    // On a phone the cards keep the layout of today.
    const phone = computed(css, cards[0], 500);
    assert.equal(phone.width, '100%');
    // A page without the tree keeps its narrow central column.
    const other = await render(tabsPage), otherCss = styleOf(other), otherCard = boot(other).document.getElementById('c-sintesi');
    assert.equal(computed(otherCss, otherCard, 1440).width, 'calc((100% - 18px) * .8)');
});

test('the files page of a tree page: the diff never widens its card, and «A capo» switches the wrap of every diff line', async () => {
    const html = await render(treePage()), css = styleOf(html);
    const b = body(html);
    assert.match(b, /<div class="mb-diff-tools"><button class="mb-diff-all" type="button" data-mb-diff-all>Chiudi tutti<\/button><button class="mb-diff-wrap" type="button" data-mb-diff-wrap aria-pressed="true" data-lavish-action>A capo<\/button><\/div>/);
    assert.equal((b.match(/data-mb-diff-wrap/g) || []).length, 1);
    const { document } = boot(html);
    const main = document.querySelector('main'), button = document.querySelector('[data-mb-diff-wrap]');
    const code = document.querySelector('td.mb-code'), long = document.querySelectorAll('td.mb-code').find(td => td.textContent.includes('bbbb'));
    assert.equal(button.tagName, 'button', 'a native button: Enter and Space press it');
    // Wrap on at the start: the lines wrap inside the card.
    assert.equal(computed(css, long, 1280)['white-space'], 'pre-wrap');
    assert.equal(computed(css, long, 1280)['overflow-wrap'], 'anywhere');
    assert.equal(computed(css, document.querySelector('.mb-diff-body'), 1280)['overflow-x'], 'auto');
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(main.getAttribute('data-mb-wrap'), 'off');
    // Wrap off: one line stays one line and the block scrolls sideways inside the card, which keeps its width.
    assert.equal(computed(css, long, 1280)['white-space'], 'pre');
    assert.equal(computed(css, code, 1280)['white-space'], 'pre');
    const card = document.getElementById('carta-diff'), section = card.parent;
    near(layoutBox(css, card, 1280).width, cardWidth(layoutBox(css, section, 1280).inner), 'the files card keeps its width');
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(main.hasAttribute('data-mb-wrap'), false);
    assert.equal(computed(css, long, 1280)['white-space'], 'pre-wrap');
    // The line numbers never wrap; the «commenta» buttons keep working and are not touched by the switch.
    assert.equal(computed(css, document.querySelector('td.mb-num'), 1280)['white-space'], 'pre');
    const comment = document.querySelector('button[data-mb-comment]');
    button.click();
    assert.equal(comment.getAttribute('aria-expanded'), 'false', 'the switch opens no comment box');
    comment.click();
    assert.equal(comment.getAttribute('aria-expanded'), 'true');
    assert(document.querySelector('.mb-comment-box'), 'the comment box opens under the line');
    // A review page without the tree keeps its files page as today: no switch.
    assert.doesNotMatch(body(await render(tabsPage)), /data-mb-diff-wrap/);
});

test('inside the cards of a tree page lines < sentences < paragraphs, as everywhere in Bruvish (1.45, +0.45em, 1.8em; 1.2em in a cell)', async () => {
    const html = await render(treePage()), css = styleOf(html);
    const { document } = boot(html);
    const card = document.getElementById('c-sintesi'), [first, second] = card.querySelectorAll('p');
    const sentences = first.querySelectorAll('.sentence');
    assert.equal(computed(css, document.querySelector('body'))['font'], '19px/1.45 \'Atkinson Hyperlegible Next\',system-ui,sans-serif', 'lines: 1.45');
    assert.equal(computed(css, card)['line-height'], undefined, 'the theme sets no other line height on a card');
    assert.equal(computed(css, sentences[1])['margin-top'], '.45em', 'sentences of a paragraph: 0.45em more (the theme set 0)');
    assert.equal(computed(css, first).margin, '0 0 1.8em', 'paragraphs: 1.8em (the theme set 0.7em)');
    assert(second, 'two paragraphs');
    const cell = document.getElementById('c-intent').querySelector('td');
    const [cellFirst] = cell.querySelectorAll('p');
    assert.equal(computed(css, cellFirst).margin, '0 0 1.2em', 'paragraphs in a cell: 1.2em');
    assert.equal(computed(css, cellFirst.querySelectorAll('.sentence')[1])['margin-top'], '.45em', 'sentences in a cell: 0.45em');
    // A page without the tree keeps the spacing of the theme as today.
    const other = await render(tabsPage), otherCss = styleOf(other), otherP = boot(other).document.getElementById('c-sintesi').querySelector('p');
    assert.equal(computed(otherCss, otherP).margin, '0 0 .7em');
});

test('the examples revisione-albero render with the tree assets, one card width and the wrap switch', async () => {
    for (const name of ['revisione-albero', 'revisione-albero-senza-gate']) {
        const html = await render(await readJson('../examples/' + name + '.json'));
        assert(styleOf(html).endsWith(treeCss), name);
        assert.match(body(html), /<main data-mb-view="[^"]+" data-mb-executor data-mb-nav="tree">/, name);
        assert.match(body(html), /data-mb-diff-wrap aria-pressed="true"/, name);
    }
});

// A column that does not wrap (Mattia, on the card «Rilievi» of the preview: «la colonna "rilievo" deve essere più stretta
// di così, mentre dove deve essere un po' più larga»): table.nowrap lists the columns, from 0, whose header and cells keep
// one line on a wide screen; the other columns share the rest. Only tree pages carry the rule (artifact-tree.css).
const findings = (extra = {}) => ({ id: 'c-rilievi', title: 'Rilievi', table: { headers: ['#', 'Rilievo', 'Gravità', 'Dove'], rows: [['1', 'Un rilievo lungo che va a capo.', { text: 'alta', tone: 'rosso' }, '`tests/pr_revisione_test.py:1186`']], ...extra } });
const withFindings = table => treePage({ groups: undefined, sections: [{ id: 'rilievi', title: 'Rilievi', cards: [findings(table)] }] });

test('table.nowrap: the listed columns keep one line on a wide tree page, header included; on a phone they wrap again', async () => {
    const html = await render(withFindings({ nowrap: [0, 3] })), css = styleOf(html);
    assert.match(body(html), /<table class="mb-table"><thead><tr><th scope="col" data-mb-nowrap>#<\/th><th scope="col">Rilievo<\/th><th scope="col">Gravità<\/th><th scope="col" data-mb-nowrap>Dove<\/th><\/tr><\/thead><tbody><tr><td data-mb-nowrap>1<\/td><td>Un rilievo lungo che va a capo\.<\/td><td><span class="mb-level" data-tone="rosso">alta<\/span><\/td><td data-mb-nowrap><code>tests\/pr_revisione_test\.py:1186<\/code><\/td><\/tr><\/tbody><\/table>/);
    const { document } = boot(html);
    const [num, finding, , where] = document.querySelectorAll('td'), whereHead = document.querySelectorAll('th')[3];
    for (const el of [num, where, whereHead])
        assert.equal(computed(css, el, 1280)['white-space'], 'nowrap');
    assert.equal(computed(css, finding, 1280)['white-space'], undefined, 'the other columns wrap as always');
    // On a phone the table scrolls sideways already; the column wraps again so the text does not run off the screen.
    assert.equal(computed(css, where, 500)['white-space'], 'normal');
    // Without nowrap the table is as before, also on a tree page.
    assert.doesNotMatch(body(await render(withFindings())), /data-mb-nowrap/);
});

test('table.nowrap: a wrong shape stops the render with the right one; a page without the tree accepts it and keeps its markup', async () => {
    const shape = /table\.nowrap must be a list of column numbers from 0, like \[3\]/;
    for (const bad of ['3', 3, [4], [-1], [1.5], ['1'], [1, 1], null])
        await assert.rejects(render(withFindings({ nowrap: bad })), shape, JSON.stringify(bad));
    await assert.rejects(render(withFindings({ nowrap: [0], variant: 'matrix', headers: ['Criterio', 'A'], rows: [['Costo', { text: 'basso', tone: 'verde', detail: 'perché' }]] })), /table\.nowrap is for plain tables, not for the matrix/);
    // Without headers the columns are counted on the widest row.
    assert.match(body(await render(withFindings({ headers: undefined, nowrap: [3] }))), /<td data-mb-nowrap><code>/);
    // A page without the tree has no rule for it: the field is checked and the page stays as without it, but for the card
    // fingerprint of the render record, which covers the whole table as for any other table field.
    const plainPage = extra => ({ ...tabsPage, sections: [{ id: 'rilievi', title: 'Rilievi', cards: [findings(extra)] }] });
    const withoutRecord = html => html.replace(/<script type="application\/json" id="mb-render">[\s\S]*?<\/script>/, '');
    assert.equal(withoutRecord(await render(plainPage({ nowrap: [3] }))), withoutRecord(await render(plainPage())));
    await assert.rejects(render(plainPage({ nowrap: [9] })), shape);
});

// Cells of a table split into sentences in tree pages (Mattia, on the cards of the single findings, two-column tables
// with a cell of twenty lines: «dovrebbero essere meglio differenziati, per esempio con paragrafi più brevi e la
// spaziatura come te la descrivevo prima»). Only a part with two sentences or more changes; « · » still makes lines.
const twoColumns = rows => treePage({ groups: undefined, sections: [{ id: 'r1', title: 'R1', cards: [{ id: 'c-r1', title: 'Rilievo 1', table: { rows, nowrap: [0] } }] }] });
const cellsOf = async rows => body(await render(twoColumns(rows))).match(/<tbody>([\s\S]*?)<\/tbody>/)[1];

test('tree pages: a table cell of several sentences shows one sentence per line with the space of sentences; short cells do not change', async () => {
    const cells = await cellsOf([
        ['Il rilievo', 'Prima frase del motivo. Seconda frase, con `codice`. Terza frase?'],
        ['Deciso da', 'agente'],
        ['Giro', '3'],
        ['Gravità', { text: 'alta', tone: 'rosso' }],
        ['Dove', 'a.js · b.js'],
        ['Misto', 'Una riga sola · Prima frase. Seconda frase. · Ultima riga'],
    ]);
    assert.match(cells, /<td data-mb-nowrap>Il rilievo<\/td><td><span class="sentence">Prima frase del motivo\.<\/span><span class="sentence">Seconda frase, con <code>codice<\/code>\.<\/span><span class="sentence">Terza frase\?<\/span><\/td>/);
    assert.match(cells, /<td data-mb-nowrap>Deciso da<\/td><td>agente<\/td>/, 'one word: as before');
    assert.match(cells, /<td data-mb-nowrap>Giro<\/td><td>3<\/td>/, 'a number: as before');
    assert.match(cells, /<td><span class="mb-level" data-tone="rosso">alta<\/span><\/td>/, 'a level: as before');
    assert.match(cells, /<td>a\.js<br>b\.js<\/td>/, '« · » still makes lines');
    // A part with several sentences is a column of sentence blocks: no <br> around it, which would add an empty line.
    assert.match(cells, /<td>Una riga sola<span class="sentence">Prima frase\.<\/span><span class="sentence">Seconda frase\.<\/span>Ultima riga<\/td>/);
    const css = styleOf(await render(twoColumns([['A', 'Una. Due.']])));
    const doc = boot(await render(twoColumns([['A', 'Una. Due.']]))).document;
    assert.equal(computed(css, doc.querySelectorAll('td .sentence')[1])['margin-top'], '.45em');
    assert.equal(computed(css, doc.querySelectorAll('td .sentence')[0]).display, 'block');
});

test('without the tree a table cell of several sentences renders as before; nowrap works on a table without headers', async () => {
    const plainPage = { ...tabsPage, sections: [{ id: 'r1', title: 'R1', cards: [{ id: 'c-r1', title: 'Rilievo 1', table: { rows: [['Il rilievo', 'Prima frase. Seconda frase.']] } }] }] };
    assert.match(body(await render(plainPage)), /<td>Il rilievo<\/td><td>Prima frase\. Seconda frase\.<\/td>/);
    // Two columns, only rows: the label column keeps one line.
    const html = await render(twoColumns([['Il rilievo', 'Testo.'], ['Deciso da', 'agente']])), css = styleOf(html);
    const labels = boot(html).document.querySelectorAll('td[data-mb-nowrap]');
    assert.deepEqual(labels.map(td => td.textContent), ['Il rilievo', 'Deciso da']);
    assert.equal(computed(css, labels[0], 1280)['white-space'], 'nowrap');
    const wide = twoColumns([['A', 'B']]);
    wide.sections[0].cards[0].table.nowrap = [2];
    await assert.rejects(render(wide), /table\.nowrap must be a list of column numbers from 0, like \[3\] for the fourth column, each once and below 2/, 'two columns without headers: 2 is out');
});
