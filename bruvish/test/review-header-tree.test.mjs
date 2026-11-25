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

