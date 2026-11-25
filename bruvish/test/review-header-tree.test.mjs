// The review page header (variant D) and the tree navigation bar (Mattia, 25 November 2026: «Ok, approvata questa
// versione va bene questa forma di intestazione»; mockups laboratorio-stile/lavish/revisione-pr/intestazione-D.html and
// barra-di-navigazione-albero.html). Both switch on only with the new fields: a page written as before renders as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderDocument } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const skeleton = html => html.replace(/<style>[\s\S]*?<\/style><script>[\s\S]*?<\/script>/, '<style/><script/>');
const styleOf = html => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const scriptOf = html => /<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1];
const body = html => html.slice(html.indexOf('<body>'));
const render = (input, options = {}) => renderDocument(input, { id: 'fixture', ...options });
const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const plainOf = value => JSON.parse(JSON.stringify(value));
function boot(html, { matchMedia, hash = '' } = {}) {
    const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
    const window = createWindow(document, { hash });
    const sent = { count: 0 };
    window.lavish.sendQueuedPrompts = () => { sent.count++; };
    if (matchMedia)
        window.matchMedia = matchMedia;
    vm.runInNewContext(scriptOf(html), window);
    return { document, window, sent };
}

// The operations page of today, as pr-revisione-ai writes it for a draft PR.
const operations = {
    view: 'v1234',
    primary: [{ operation: 'pronta-unisci', label: 'Pronta e unisci', confirm: 'Unisce.' }, { operation: 'pronta', label: 'Segna come pronta', confirm: 'Toglie la bozza.' }],
    fixed: [{ operation: 'revisore', label: 'Assegna un revisore', confirm: 'Chiede.', field: 'line', placeholder: 'login', required: true }],
    menu: [{ operation: 'aggiorna', label: 'Aggiorna il ramo', hint: 'novità', confirm: 'Porta.' }, { operation: 'chiudi', label: 'Chiudi la PR', confirm: 'Chiude.', danger: true }],
};
const todayPage = {
    title: 'Una PR #16', theme: 'revisione', tabs: true,
    header: { badge: { text: 'Bozza', tone: 'blu', icon: 'draft' }, subtitle: 'Unisce `a` in `b`', meta: ['mattiabestiaccia/x', '25 nov 2026'], stat: { added: 6, removed: 0 } },
    actions: operations, diagnostics: { attempts: [], problem: null },
    sections: [{ id: 'sintesi', title: 'Sintesi', cards: [{ id: 'a', title: 'A', paragraphs: ['Testo.'] }] }, { id: 'commit', title: 'Commit', count: 1, cards: [{ id: 'b', title: 'B', paragraphs: ['Testo.'] }] }],
};

test('review pages written as today render byte for byte as on carry (page skeleton)', async () => {
    // Hashes computed on carry (c31e865) before the new header and the tree bar existed.
    const before = {
        '../examples/revisione-completa.json': '8bd2d92bb620d04bba5e064aaafbb787d04864e9e255a688f030c69f8bf4768b',
        './fixtures/revisione-postit-6.json': '4bc34861f93bdde144f8e06d9b331b40bf4deac98b9e5e065a986b23cf7c6d88',
    };
    for (const [path, hash] of Object.entries(before))
        assert.equal(sha(skeleton(await render(await readJson(path)))), hash, path);
    assert.equal(sha(skeleton(await render(todayPage))), 'bc9bd33671d2236fd432093af308c1c2ddc4e9ab0f2fad5b4fa13e927133ad84', 'operations page of today');
});

// The data of the approved mockup (agents-kit #16).
const facts = [
    { label: 'PR', text: '#16', type: 'link', href: 'https://github.com/mattiabestiaccia/agents-kit/pull/16' },
    { label: 'Repository', text: '`mattiabestiaccia/agents-kit`' },
    { label: 'Aperta da', text: 'mattiabestiaccia' },
    { label: 'Quando', text: '25 nov 2026, 02:02' },
    { label: 'Head', text: '`6c5241a`' },
    { label: 'Unisce', text: '`prova-pagina-revisione` → `main`' },
    { label: 'Modifiche', text: '1 commit · 1 file', type: 'delta', added: 6, removed: 0 },
];
const icons = {
    view: 'v1234',
    primary: [{ ...operations.primary[0], icon: 'unisci' }, { ...operations.primary[1], icon: 'pronta' }],
    fixed: [{ ...operations.fixed[0], icon: 'revisore' }],
    menu: [operations.menu[0], { ...operations.menu[1], hint: 'senza unirla', icon: 'chiudi' }],
};
const newPage = (extra = {}) => ({ ...todayPage, header: { badge: { text: 'Bozza', tone: 'blu', icon: 'draft' }, facts }, actions: icons, ...extra });

test('header D: the title comes first, without the PR number; operations and state sit top right; the facts table follows', async () => {
    const html = await render(newPage({ pills: [{ text: 'rischio basso', tone: 'verde', level: true }] }));
    const { document } = boot(html);
    const header = document.querySelector('header');
    assert(header.classList.contains('mb-header-facts'));
    const [top, table] = header.elements;
    assert(top.classList.contains('mb-header-top'), 'the top row comes first');
    const [h1, side] = top.elements;
    assert.equal(h1.tagName, 'h1', 'the title is the first thing');
    assert.equal(h1.textContent, 'Una PR', 'the number goes to the facts table');
    assert.match(html, /<title>Una PR #16<\/title>/, 'the browser tab keeps the number');
    assert(side.classList.contains('mb-header-side'));
    assert.deepEqual(side.elements.map(e => e.className), ['mb-actions mb-actions-icons', 'mb-badge'], 'operations, then the state under them');
    assert.equal(table.tagName, 'table');
    assert.equal(table.className, 'mb-facts');
    assert.deepEqual(table.querySelectorAll('th').map(th => [th.getAttribute('scope'), th.textContent]), facts.map(f => ['col', f.label]));
    const cells = table.querySelectorAll('td');
    assert.deepEqual(cells.map(td => td.getAttribute('data-label')), facts.map(f => f.label), 'each value knows its label for the narrow form');
    const link = cells[0].querySelector('a');
    assert.deepEqual([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel'), link.textContent], ['https://github.com/mattiabestiaccia/agents-kit/pull/16', '_blank', 'noopener noreferrer', '#16 ↗']);
    assert.equal(link.getAttribute('data-lavish-action'), '', 'a plain click opens the PR: Lavish does not turn it into an annotation');
    assert.match(body(html), /<td data-label="Repository"><span class="mb-fact"><code>mattiabestiaccia\/agents-kit<\/code><\/span><\/td>/);
    assert.match(body(html), /<td data-label="Modifiche"><span class="mb-fact">1 commit · 1 file · <span class="mb-plus">\+6<\/span> <span class="mb-minus">−0<\/span><\/span><\/td>/);
    assert.equal(table.nextElementSibling.className, 'mb-pills', 'pills follow the table');
    assert.doesNotMatch(body(html), /mb-header-meta|mb-subtitle|mb-number/);
});

test('header D escapes every fact; a link is https only; facts replace meta, subtitle and stat; a bad shape stops the render', async () => {
    const evil = [{ label: '<b>x</b>', text: '<img src=x onerror=alert(1)> **ok**' }, { label: 'PR', text: '"#1"', type: 'link', href: 'https://example.org/a?b="c"&d=<e>' }];
    const html = await render(newPage({ header: { facts: evil } }));
    assert.match(body(html), /<th scope="col">&lt;b&gt;x&lt;\/b&gt;<\/th>/);
    assert.match(body(html), /<td data-label="&lt;b&gt;x&lt;\/b&gt;"><span class="mb-fact">&lt;img src=x onerror=alert\(1\)&gt; <strong>ok<\/strong><\/span><\/td>/);
    assert.match(body(html), /href="https:\/\/example\.org\/a\?b=&quot;c&quot;&amp;d=&lt;e&gt;"/);
    assert.doesNotMatch(body(html), /<img|<b>x/);
    const shape = /header\.facts must be/;
    for (const bad of ['x', [], [{ label: '', text: 'a' }], [{ label: 'A' }], [{ label: 'A', text: 3 }], [{ label: 'A', text: 'a', type: 'img' }],
        [{ label: 'A', text: 'a', type: 'link' }], [{ label: 'A', text: 'a', type: 'link', href: 'javascript:alert(1)' }], [{ label: 'A', text: 'a', type: 'link', href: 'http://x.org' }],
        [{ label: 'A', text: 'a', type: 'link', href: 'https://x.org/a b' }], [{ label: 'A', type: 'delta', added: -1, removed: 0 }], [{ label: 'A', type: 'delta', added: 1 }], [{ label: 'A', type: 'delta', added: 1.5, removed: 0 }]])
        await assert.rejects(render(newPage({ header: { facts: bad } })), shape, JSON.stringify(bad));
    for (const extra of [{ meta: ['x'] }, { subtitle: 'x' }, { stat: { added: 1, removed: 0 } }])
        await assert.rejects(render(newPage({ header: { facts, ...extra } })), /header\.facts replaces meta, subtitle and stat/);
    // A delta without its text is only the counts.
    assert.match(body(await render(newPage({ header: { facts: [{ label: 'Modifiche', type: 'delta', added: 1180, removed: 92 }] } }))), /<td data-label="Modifiche"><span class="mb-fact"><span class="mb-plus">\+1180<\/span> <span class="mb-minus">−92<\/span><\/span><\/td>/);
});

test('icon buttons keep the contract with the executor: same attributes, same confirmation, same message', async () => {
    const html = await render(newPage());
    const b = body(html);
    // Same attributes as today, plus the name for assistive technology and the tooltip; the label text is not content.
    assert.match(b, /<div class="mb-actions mb-actions-icons" data-mb-actions><div class="mb-actions-row"><div class="mb-actions-primary"><button type="button" class="mb-action mb-action-main mb-icon-button" data-mb-op="pronta-unisci" data-mb-confirm-title="Pronta e unisci" data-mb-confirm="Unisce\." data-mb-icon="unisci" aria-label="Pronta e unisci" data-mb-name="Pronta e unisci"><svg class="mb-op-icon" viewBox="0 0 16 16" aria-hidden="true">/);
    assert.match(b, /<button type="button" class="mb-action mb-icon-button" data-mb-op="pronta" data-mb-confirm-title="Segna come pronta" data-mb-confirm="Toglie la bozza\." data-mb-icon="pronta" aria-label="Segna come pronta" data-mb-name="Segna come pronta">/);
    assert.match(b, /<div class="mb-actions-fixed"><button type="button" class="mb-action-fixed mb-icon-button" data-mb-op="revisore" data-mb-confirm-title="Assegna un revisore" data-mb-confirm="Chiede\." data-mb-field-kind="line" data-mb-placeholder="login" data-mb-required data-mb-icon="revisore" aria-label="Assegna un revisore" data-mb-name="Assegna un revisore">/);
    // A menu operation with an icon stands beside the menu, red when dangerous; the rest stays in the «⋯» menu, now an icon.
    assert.match(b, /<button type="button" class="mb-action-item mb-danger mb-icon-button" data-mb-op="chiudi" data-mb-confirm-title="Chiudi la PR" data-mb-confirm="Chiude\." data-mb-icon="chiudi" aria-label="Chiudi la PR senza unirla" data-mb-name="Chiudi la PR senza unirla">/);
    assert.match(b, /<details class="mb-actions-menu"><summary class="mb-icon-button" aria-label="Altre operazioni" data-mb-name="Altre operazioni"><svg class="mb-op-icon"[^>]*>[\s\S]*?<\/svg><\/summary><div class="mb-actions-items"><button type="button" class="mb-action-item" data-mb-op="aggiorna"[^>]*>Aggiorna il ramo<small>novità<\/small><\/button><\/div><\/details>/);
    assert.equal((b.match(/data-mb-op="chiudi"/g) || []).length, 1, 'the operation is not repeated in the menu');
    // The name is plain text: the inline marks of a hint are not read aloud nor shown in the tooltip.
    const marked = body(await render(newPage({ actions: { view: 'v1234', menu: [{ ...operations.menu[1], hint: 'senza unirla in `main` & **subito**', icon: 'chiudi' }] } })));
    assert.match(marked, /aria-label="Chiudi la PR senza unirla in main &amp; subito" data-mb-name="Chiudi la PR senza unirla in main &amp; subito"/);
    const { document, window, sent } = boot(html);
    const box = document.querySelector('.mb-confirm');
    const [merge, ready] = document.querySelectorAll('.mb-action');
    ready.click();
    assert.equal(box.querySelector('.mb-confirm-title').textContent, 'Segna come pronta?');
    assert(ready.classList.contains('mb-action-main') && !merge.classList.contains('mb-action-main'), 'the clicked alternative becomes the main one');
    box.querySelector('.mb-confirm-yes').click();
    document.querySelector('[data-mb-op="chiudi"]').click();
    assert.equal(box.querySelector('.mb-confirm-title').textContent, 'Chiudi la PR?', 'the confirmation keeps the label');
    box.querySelector('.mb-confirm-yes').click();
    document.querySelector('[data-mb-op="revisore"]').click();
    box.querySelector('.mb-confirm-field').value = 'octocat';
    box.querySelector('.mb-confirm-yes').click();
    assert.deepEqual(plainOf(window.queued.map(q => [q.tag, q.data])), [
        ['operation', { view: 'v1234', operation: 'pronta', text: '' }], ['operation', { view: 'v1234', operation: 'chiudi', text: '' }], ['operation', { view: 'v1234', operation: 'revisore', text: 'octocat' }]]);
    assert.equal(sent.count, 3);
    assert.equal(box.textContent, '✓ Inviato: l\'esito arriva nel pannello e nella Diagnostica.');
});

test('an operation without an icon stays a text button; an unknown icon or an icon on a non-operation stops the render', async () => {
    const mixed = { ...icons, primary: [operations.primary[0], icons.primary[1]] };
    const b = body(await render(newPage({ actions: mixed })));
    assert.match(b, /<button type="button" class="mb-action mb-action-main" data-mb-op="pronta-unisci" data-mb-confirm-title="Pronta e unisci" data-mb-confirm="Unisce\.">Pronta e unisci<\/button>/);
    // Without any icon the header operations keep the markup of today, also in header D.
    const plain = body(await render(newPage({ actions: operations })));
    assert.match(plain, /<div class="mb-actions" data-mb-actions><div class="mb-actions-row"><div class="mb-actions-primary"><button type="button" class="mb-action mb-action-main" data-mb-op="pronta-unisci"/);
    assert.match(plain, /<details class="mb-actions-menu"><summary>Altre operazioni ⋯<\/summary>/);
    for (const icon of ['altre', 'svg', '<svg/>', 3, ''])
        await assert.rejects(render(newPage({ actions: { ...icons, fixed: [{ ...operations.fixed[0], icon }] } })), /actions must be/, String(icon));
    // Every menu operation with an icon: no «⋯» menu is left.
    const allOut = body(await render(newPage({ actions: { view: 'v1234', menu: [{ ...operations.menu[1], icon: 'chiudi' }] } })));
    assert.doesNotMatch(allOut, /mb-actions-menu/);
});

test('header D without operations keeps the state top right; the theme accent and the tooltip come from the stylesheet', async () => {
    const { actions: _, diagnostics: __, ...noActions } = newPage();
    const html = await render(noActions);
    assert.match(body(html), /<main><header class="mb-header-facts"><div class="mb-header-top"><h1>Una PR<\/h1><div class="mb-header-side"><span class="mb-badge" data-tone="blu">/);
    const css = styleOf(html);
    // Sizes of the approved mockup (values 14px, headings 11px), headings centred, vertical lines between the columns.
    assert.match(css, /\.mb-facts\{[^}]*font-size:14px/);
    assert.match(css, /\.mb-facts th\{[^}]*font-size:11px/);
    assert.match(css, /\.mb-facts th\{[^}]*text-align:center/);
    assert.match(css, /\.mb-facts td::before\{[^}]*font-size:11px/);
    assert.match(css, /\.mb-facts th\+th,\.mb-facts td\+td\{border-left:1px solid var\(--line\)\}/);
    // Narrow: two columns, label and value, every value on one line.
    assert.match(css, /@media\(max-width:820px\)\{[^@]*\.mb-facts td\{display:grid;grid-template-columns:[^}]*\}[^@]*\.mb-facts td::before\{content:attr\(data-label\)/);
    assert.match(css, /\.mb-facts td\{[^}]*white-space:nowrap/);
    // The name of an icon operation shows on hover and with the keyboard focus.
    assert.match(css, /\.mb-icon-button::after\{content:attr\(data-mb-name\)/);
    assert.match(css, /\.mb-icon-button:hover::after,\.mb-icon-button:focus-visible::after\{opacity:1\}/);
    assert.match(css, /\.mb-icon-button\[data-mb-icon=chiudi\]\{[^}]*color:var\(--mb-red\)/);
    // Phone: one column, the title first at full width, then the row of the operations and the state.
    assert.match(css, /@media\(max-width:560px\)\{\.mb-header-top\{grid-template-columns:minmax\(0,1fr\)[^}]*\}\.mb-header-side\{display:flex;flex-wrap:wrap;[^}]*\}\.mb-header-side>\.mb-actions\{order:1;margin-left:auto\}\}/, 'the operations sit at the right end, so their right-anchored popups stay on screen');
});

// The tree bar: groups and sections in JSON order, a status dot and a count beside an item.
const treePage = (extra = {}) => ({
    title: 'Una PR', theme: 'revisione', tabs: 'tree',
    groups: [{ id: 'gate', title: 'Gate', dot: 'verde', count: '9 su 9' }, { id: 'modifiche', title: 'Modifiche', count: '10 file' }, { id: 'storia', title: 'Storia' }],
    sections: [
        { id: 'sintesi', title: 'Sintesi', cards: [{ id: 'c-sintesi', title: 'Sintesi', paragraphs: ['Testo.'] }] },
        { id: 'intent', title: 'Intent', group: 'gate', dot: 'verde', cards: [{ id: 'c-intent', title: 'Intent', paragraphs: ['Testo.'] }] },
        { id: 'revisione', title: 'Revisione', group: 'gate', dot: 'giallo', count: '4 corretti', cards: [{ id: 'c-rev', title: 'Revisione', paragraphs: ['Testo.'] }] },
        { id: 'ci', title: 'CI', group: 'gate', dot: 'vuoto', count: 'nessuna', cards: [{ id: 'c-ci', title: 'CI', paragraphs: ['Testo.'] }] },
        { id: 'file', title: 'File modificati', group: 'modifiche', count: 10, cards: [{ id: 'c-file', title: 'File', diff: { text: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,1 +1,1 @@\n-a\n+b\n' } }] },
        { id: 'commit', title: 'Commit', group: 'modifiche', count: 4, cards: [{ id: 'c-commit', title: 'Commit', paragraphs: ['Testo.'] }] },
        { id: 'conversazione', title: 'Conversazione', group: 'storia', cards: [{ id: 'c-conv', title: 'Conversazione', paragraphs: ['Testo.'] }] },
        { id: 'cronologia', title: 'Cronologia', group: 'storia', cards: [{ id: 'c-cron', title: 'Cronologia', paragraphs: ['Testo.'] }] },
    ],
    ...extra,
});

test('tabs "tree": a vertical tree of top items and groups, in JSON order, with status dots and counts', async () => {
    const html = await render(treePage());
    const b = body(html);
    assert.match(b, /<main data-mb-nav="tree"><header>/);
    assert.match(b, /<nav class="mb-tabs mb-tree" aria-label="Schede"><a href="#sintesi" data-mb-tab="sintesi" data-lavish-action><span class="mb-tree-name">Sintesi<\/span><\/a><div class="mb-tree-group" data-mb-group="gate"><button type="button" class="mb-tree-branch" data-mb-branch aria-expanded="true" aria-controls="mb-group-gate" data-lavish-action><span class="mb-tree-arrow" aria-hidden="true">▸<\/span><span class="mb-tree-dot" data-dot="verde" aria-hidden="true"><\/span><span class="mb-tree-name">Gate<\/span><span class="mb-count">9 su 9<\/span><\/button><div class="mb-tree-children" id="mb-group-gate" role="group" aria-label="Gate"><a href="#intent" data-mb-tab="intent" data-lavish-action><span class="mb-tree-dot" data-dot="verde" aria-hidden="true"><\/span><span class="mb-tree-name">Intent<\/span><\/a><a href="#revisione" data-mb-tab="revisione" data-lavish-action><span class="mb-tree-dot" data-dot="giallo" aria-hidden="true"><\/span><span class="mb-tree-name">Revisione<\/span><span class="mb-count">4 corretti<\/span><\/a>/);
    const { document } = boot(html);
    const nav = document.querySelector('nav.mb-tree');
    assert.deepEqual(nav.elements.map(e => e.tagName === 'a' ? e.dataset.mbTab : e.dataset.mbGroup), ['sintesi', 'gate', 'modifiche', 'storia']);
    assert.deepEqual(document.querySelectorAll('#mb-group-modifiche a').map(a => a.dataset.mbTab), ['file', 'commit']);
    // The tab names the section, as with tabs: true.
    assert.equal(document.querySelectorAll('section h2').length, 0);
    assert.equal(document.getElementById('intent').getAttribute('aria-label'), 'Intent');
    // A group sits where its first section is: here a top item after a group keeps its place.
    const late = treePage();
    late.sections = [late.sections[1], late.sections[0], ...late.sections.slice(2)];
    const order = boot(await render(late)).document.querySelector('nav.mb-tree').elements.map(e => e.tagName === 'a' ? e.dataset.mbTab : e.dataset.mbGroup);
    assert.deepEqual(order, ['gate', 'sintesi', 'modifiche', 'storia']);
});

test('the tree shows one page at a time: a child opens its group, a branch opens or closes, the hash and a reveal still work', async () => {
    const html = await render(treePage());
    const { document, window } = boot(html);
    const section = id => document.getElementById(id), link = id => document.querySelector('a[data-mb-tab="' + id + '"]');
    const branch = id => document.querySelector('[data-mb-group="' + id + '"] .mb-tree-branch'), children = id => document.getElementById('mb-group-' + id);
    const visible = () => document.querySelectorAll('main > section').filter(s => !s.hidden).map(s => s.id);
    assert.deepEqual(visible(), ['sintesi']);
    assert.equal(link('sintesi').getAttribute('aria-current'), 'page');
    for (const g of ['gate', 'modifiche', 'storia']) {
        assert.equal(children(g).hidden, true, g + ' starts closed: Sintesi is open');
        assert.equal(branch(g).getAttribute('aria-expanded'), 'false');
    }
    // A branch opens and closes its parts without changing the page.
    branch('gate').click();
    assert.equal(children('gate').hidden, false);
    assert.equal(branch('gate').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(visible(), ['sintesi']);
    branch('gate').click();
    assert.equal(children('gate').hidden, true);
    // A part shows its page and opens its group; the other groups close.
    assert(document.dispatch(link('commit'), 'click').defaultPrevented);
    assert.deepEqual(visible(), ['commit']);
    assert.equal(link('commit').getAttribute('aria-current'), 'page');
    assert.equal(link('sintesi').getAttribute('aria-current'), null);
    assert.equal(children('modifiche').hidden, false);
    assert.equal(window.location.hash, '#commit');
    // A link to a card in another page opens that page and its group.
    window.location.hash = '#c-rev';
    window.fire('hashchange');
    assert.deepEqual(visible(), ['revisione']);
    assert.equal(children('gate').hidden, false);
    assert.equal(children('modifiche').hidden, true);
    window.post({ type: 'lavish:revealElement', selector: '#c-cron' });
    assert.deepEqual(visible(), ['cronologia']);
    assert.equal(branch('storia').getAttribute('aria-expanded'), 'true');
    // Opening on a hash shows that page with its group open.
    const deep = boot(html, { hash: '#c-file' }).document;
    assert.equal(deep.getElementById('file').hidden, false);
    assert.equal(deep.getElementById('mb-group-modifiche').hidden, false);
});

test('on a phone a branch opens the first part of its group, and the bar is a two-row horizontal bar', async () => {
    const html = await render(treePage());
    const { document } = boot(html, { matchMedia: query => ({ matches: /max-width:\s*820px/.test(query) }) });
    const visible = () => document.querySelectorAll('main > section').filter(s => !s.hidden).map(s => s.id);
    document.querySelector('[data-mb-group="gate"] .mb-tree-branch').click();
    assert.deepEqual(visible(), ['intent']);
    document.querySelector('a[data-mb-tab="ci"]').click();
    document.querySelector('[data-mb-group="gate"] .mb-tree-branch').click();
    assert.deepEqual(visible(), ['ci'], 'the open group stays on its page');
    const css = styleOf(html);
    // Wide: a grid of the bar on the left, kept in view, and the page; the files page takes all the width that is left.
    assert.match(css, /@media\(min-width:821px\)\{main\[data-mb-nav=tree\]\{display:grid;grid-template-columns:236px minmax\(0,1fr\)/);
    assert.match(css, /main\[data-mb-nav=tree\]>nav\.mb-tree\{[^}]*position:sticky/);
    // Phone: top items on the first row, the parts of the open group on a second row that scrolls sideways.
    assert.match(css, /@media\(max-width:820px\)\{[^@]*nav\.mb-tree \.mb-tree-group\{display:contents\}[^@]*nav\.mb-tree \.mb-tree-group:has\(a\[aria-current\]\)>\.mb-tree-children\{display:flex\}/);
    assert.match(css, /nav\.mb-tree \.mb-tree-children\{[^}]*overflow-x:auto/);
    // Without the script the groups stay open also on a phone: only the hidden attribute, set by the script, hides parts.
    assert.match(css, /@media\(max-width:820px\)\{[^@]*nav\.mb-tree \.mb-tree-children\{order:1;flex:1 0 100%;display:flex;/);
    assert.match(css, /main\[data-mb-nav=tree\] nav\.mb-tree \.mb-tree-children\[hidden\]\{display:none\}/);
    const parts = document.querySelectorAll('.mb-tree-children').map(p => [p.id, p.hidden]);
    assert.deepEqual(parts, [['mb-group-gate', false], ['mb-group-modifiche', true], ['mb-group-storia', true]], 'with the script only the open group shows its parts');
    assert(!/<div class="mb-tree-children"[^>]*hidden/.test(body(html)), 'the page as written has every group open');
});

test('tree fields: a wrong group, dot or tabs value stops the render; groups need tabs "tree"; a page with tabs: true is unchanged', async () => {
    await assert.rejects(render(treePage({ tabs: 'albero' })), /tabs must be true or false, or "tree" for the tree bar/);
    await assert.rejects(render(treePage({ tabs: true })), /groups and section groups need "tabs": "tree"/);
    await assert.rejects(render(treePage({ groups: [{ id: 'gate', title: 'Gate', dot: 'blu' }] })), /dot must be one of verde, giallo, rosso, vuoto/);
    const unknown = treePage();
    unknown.sections[1] = { ...unknown.sections[1], group: 'nessuno' };
    await assert.rejects(render(unknown), /Section intent: group must be the id of one of the groups/);
    await assert.rejects(render(treePage({ groups: [{ id: 'gate' }] })), /groups must be an array of/);
    await assert.rejects(render(treePage({ groups: [{ id: 'gate', title: 'Gate' }, { id: 'gate', title: 'Gate' }] })), /unique stable id/);
    const dot = treePage();
    dot.sections[0] = { ...dot.sections[0], dot: 'blu' };
    await assert.rejects(render(dot), /Section sintesi: dot must be one of/);
    const empty = treePage();
    empty.groups = [...empty.groups, { id: 'vuoto', title: 'Vuoto' }];
    await assert.rejects(render(empty), /Group vuoto has no section/);
    // Escape: titles and counts of groups and sections are plain text.
    const evil = treePage({ groups: [{ id: 'gate', title: '<i>Gate</i>', count: '<b>9</b>' }, ...treePage().groups.slice(1)] });
    const b = body(await render(evil));
    assert.match(b, /<span class="mb-tree-name">&lt;i&gt;Gate&lt;\/i&gt;<\/span><span class="mb-count">&lt;b&gt;9&lt;\/b&gt;<\/span>/);
});

test('the examples revisione-albero (with and without the gate) render through the CLI with header D and the tree bar', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const os = await import('node:os'), path = await import('node:path');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-albero-'));
    try {
        for (const name of ['revisione-albero', 'revisione-albero-senza-gate']) {
            const input = await readJson('../examples/' + name + '.json');
            assert.equal(input.tabs, 'tree', name);
            assert(input.header.facts.length && input.actions.primary.every(o => o.icon), name);
            const output = path.join(dir, name + '.html');
            const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname, file = new URL('../examples/' + name + '.json', import.meta.url).pathname;
            const r = spawnSync(process.execPath, [cli, 'render', file, '--output', output], { encoding: 'utf8' });
            assert.equal(r.status, 0, r.stderr);
            const html = await readFile(output, 'utf8');
            for (const needle of ['class="mb-header-facts"', 'class="mb-facts"', 'mb-icon-button', 'nav class="mb-tabs mb-tree"', 'data-mb-nav="tree"']) assert(html.includes(needle), name + ': ' + needle);
            const second = input.groups[0].title;
            assert.equal(second, name === 'revisione-albero' ? 'Gate' : 'Verifiche', name);
            assert.equal(input.header.state, 'bozza', name);
            assert.equal(input.sections.at(-1).id, 'diagnostica', name);
            assert.equal(input.sections.at(-1).group, 'storia', name + ': the diagnostics are the last part of Storia');
        }
        const gate = await readJson('../examples/revisione-albero.json');
        assert.deepEqual(gate.sections.filter(s => s.group === 'gate').map(s => s.title), ['Intent', 'Rebase', 'Revisione', 'Prove', 'Documenti', 'Lint', 'Push', 'PR', 'CI'], 'the nine steps of no-mistakes, in order');
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the diagnostics page sits under a group when its section names one; without a group it stays a top item', async () => {
    const withDiag = extra => {
        const page = treePage({ diagnostics: { attempts: [], problem: null } });
        page.sections = [...page.sections, { id: 'diagnostica', title: 'Diagnostica', ...extra, cards: [{ id: 'carta-diagnostica-1', title: 'Stato', paragraphs: ['Testo.'] }, { id: 'carta-diagnostica-3', title: 'x', paragraphs: ['x'] }] }];
        return page;
    };
    const { document } = boot(await render(withDiag({ group: 'storia' })));
    assert.deepEqual(document.querySelectorAll('#mb-group-storia a').map(a => a.dataset.mbTab), ['conversazione', 'cronologia', 'diagnostica'], 'last of the parts of Storia');
    assert.deepEqual(document.getElementById('diagnostica').querySelectorAll('article.card').map(c => c.id), ['carta-diagnostica-1', 'mb-diag-attempts'], 'the executor cards still replace the producer ones');
    const top = boot(await render(withDiag({}))).document;
    assert.equal(top.querySelector('nav.mb-tree > a[data-mb-tab="diagnostica"]')?.dataset.mbTab, 'diagnostica');
});

test('header.state gives the PR state with its own colour and icon: Bozza grey, Aperta green, Unita violet, Chiusa red', async () => {
    const expected = { bozza: ['Bozza', 'draft'], aperta: ['Aperta', 'open'], unita: ['Unita', 'merged'], chiusa: ['Chiusa', 'closed'] };
    for (const [state, [text]] of Object.entries(expected)) {
        // Header D: the state under the operations, top right; the outcome after a merge or a close lives here.
        const html = await render(newPage({ header: { state, facts } }));
        const { document } = boot(html);
        const badge = document.querySelector('.mb-header-side .mb-badge');
        assert.equal(badge.getAttribute('data-state'), state);
        assert.equal(badge.getAttribute('data-tone'), null, 'the state is not a tone: the other colours do not change');
        assert.equal(badge.textContent, text);
        assert.equal(badge.querySelectorAll('svg').length, 1, state + ': an icon');
        // Classic header: the same badge above the title.
        const classic = await render({ ...todayPage, header: { state, subtitle: 'x' } });
        assert.match(body(classic), new RegExp('<div class="mb-header-meta"><span class="mb-badge" data-state="' + state + '"><svg class="mb-icon"[^>]*><path[^>]*></path></svg>' + text + '</span></div>'));
    }
    const css = styleOf(await render(newPage({ header: { state: 'bozza', facts } })));
    for (const [state, colour] of Object.entries({ bozza: '#565b6e', aperta: '#1f7a45', unita: '#8957e5', chiusa: '#da3633' }))
        assert.match(css, new RegExp('\\.mb-badge\\[data-state=' + state + '\\]\\{background:' + colour + '\\}'), state);
    await assert.rejects(render(newPage({ header: { state: 'Aperta', facts } })), /header\.state must be one of bozza, aperta, unita, chiusa/);
    await assert.rejects(render(newPage({ header: { state: 'bozza', badge: { text: 'Bozza', tone: 'blu' }, facts } })), /header\.state replaces header\.badge/);
});
