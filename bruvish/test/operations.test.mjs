// Page operations (Mattia, 23 November 2026, S20): main operation and «⋯» menu in the header with a confirmation
// dropdown, card forms with a text, line comments bound to the view.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderDocument } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const actions = {
    view: 'v1234',
    primary: [
        { operation: 'pronta', label: 'Segna come pronta', confirm: 'Toglie la PR dalla bozza.' },
        { operation: 'pronta-unisci', label: 'Pronta e unisci', confirm: 'Toglie la bozza e unisce in `carry`.' },
    ],
    menu: [
        { operation: 'aggiorna', label: 'Aggiorna il ramo', hint: 'novità di carry', confirm: 'Porta nel ramo le novità.' },
        { operation: 'chiudi', label: 'Chiudi la PR', confirm: 'Chiude senza unire.', danger: true },
    ],
};
const plainOf = value => JSON.parse(JSON.stringify(value));
const page = (extra = {}) => ({
    title: 'PR #16', theme: 'revisione', header: { subtitle: 'Unisce `a` in `b`' }, actions,
    sections: [{ id: 'conversazione', title: 'Conversazione', cards: [
        { id: 'commento', title: 'Aggiungi un commento', action: { operation: 'commento', field: 'text', submit: 'Pubblica il commento', placeholder: 'Il commento va sulla PR così com\'è', required: true } },
        { id: 'rev', title: 'La tua revisione', action: { submit: 'Invia la revisione', choices: [
            { operation: 'approva', label: 'Approva', hint: 'non disponibile sulle tue PR', disabled: true },
            { operation: 'modifiche', label: 'Chiedi modifiche', hint: 'serve il motivo', required: true },
            { operation: 'commento', label: 'Solo commento', required: true }] } },
        { id: 'revisore', title: 'Chiedi una revisione', action: { operation: 'revisore', field: 'line', submit: 'Chiedi', placeholder: 'login GitHub', required: true } },
    ] }],
    state: { revision: 1, answers: {} }, ...extra,
});
function boot(html) {
    const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
    const window = createWindow(document);
    const sent = { count: 0 };
    window.lavish.sendQueuedPrompts = () => { sent.count++; };
    vm.runInNewContext(/<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1], window);
    return { document, window, sent };
}

test('the header carries the main operations side by side and the «⋯» menu; main carries the view id', async () => {
    const html = await renderDocument(page());
    assert.match(html, /<main data-mb-view="v1234">/);
    assert.match(html, /<header class="mb-header-actions"><div class="mb-header-main">/);
    assert.match(html, /<div class="mb-actions-primary"><button type="button" class="mb-action mb-action-main" data-mb-op="pronta" data-mb-confirm-title="Segna come pronta" data-mb-confirm="Toglie la PR dalla bozza\.">Segna come pronta<\/button><button type="button" class="mb-action" data-mb-op="pronta-unisci"/);
    assert.match(html, /data-mb-confirm="Toglie la bozza e unisce in &lt;code&gt;carry&lt;\/code&gt;\."/);
    assert.match(html, /<details class="mb-actions-menu"><summary>Altre operazioni ⋯<\/summary><div class="mb-actions-items"><button type="button" class="mb-action-item" data-mb-op="aggiorna"[^>]*>Aggiorna il ramo<small>novità di carry<\/small><\/button><button type="button" class="mb-action-item mb-danger" data-mb-op="chiudi"/);
    assert.doesNotMatch(html, /id="operazioni"|Operazioni<\/a>/, 'no Operazioni section');
});

test('a click on a header operation opens the confirmation; «Conferma» queues and sends it, «Annulla» closes', async () => {
    const { document, window, sent } = boot(await renderDocument(page()));
    const box = document.querySelector('.mb-confirm'), [ready, readyMerge] = document.querySelectorAll('.mb-action');
    assert.equal(box.hidden, true);
    readyMerge.click();
    assert.equal(box.hidden, false);
    assert.equal(box.querySelector('.mb-confirm-title').textContent, 'Pronta e unisci?');
    assert.ok(readyMerge.classList.contains('mb-action-main') && !ready.classList.contains('mb-action-main'), 'the clicked alternative becomes the main one');
    assert.equal(window.queued.length, 0, 'nothing is queued before the confirmation');
    box.querySelector('.mb-confirm-no').click();
    assert.equal(box.hidden, true);
    readyMerge.click();
    box.querySelector('.mb-confirm-yes').click();
    assert.deepEqual(plainOf(window.queued.map(q => [q.tag, q.data])), [['operation', { view: 'v1234', operation: 'pronta-unisci', text: '' }]]);
    assert.equal(sent.count, 1);
    document.querySelector('.mb-action-item.mb-danger').click();
    assert.equal(box.querySelector('.mb-confirm-title').textContent, 'Chiudi la PR?');
    assert.ok(readyMerge.classList.contains('mb-action-main'), 'a menu item leaves the main alternative alone');
});

test('a card form needs its text when required, then two taps: the second queues the operation with the text', async () => {
    const { document, window } = boot(await renderDocument(page()));
    const form = document.getElementById('commento').querySelector('form'), submit = form.querySelector('.mb-op-submit'), status = form.querySelector('.mb-op-status');
    form.requestSubmit();
    assert.equal(status.textContent, 'Scrivi il testo prima di inviare.');
    form.querySelector('.mb-op-text').value = '  Va bene così.  ';
    form.requestSubmit();
    assert.ok(submit.hasAttribute('data-mb-armed'));
    assert.equal(window.queued.length, 0);
    form.requestSubmit();
    assert.deepEqual(plainOf(window.queued.map(q => q.data)), [{ view: 'v1234', operation: 'commento', text: 'Va bene così.' }]);
    assert.equal(status.textContent, '✓ Inviato all\'agente.');
});

test('the review form starts on the first enabled choice; a disabled choice stays off', async () => {
    const html = await renderDocument(page());
    assert.match(html, /<label class="mb-op-off"><input type="radio" name="mb-op-rev" value="approva" disabled>/);
    assert.match(html, /<input type="radio" name="mb-op-rev" value="modifiche" data-mb-required checked>/);
    const { document, window } = boot(html);
    const form = document.getElementById('rev').querySelector('form');
    form.querySelector('.mb-op-text').value = 'Manca un test.';
    form.requestSubmit(); form.requestSubmit();
    assert.deepEqual(plainOf(window.queued.map(q => q.data)), [{ view: 'v1234', operation: 'modifiche', text: 'Manca un test.' }]);
    assert.match(await renderDocument(page()), /<input type="text" class="mb-op-text" placeholder="login GitHub">/);
});

test('a page without actions keeps its header; malformed actions stop the render with the expected shape', async () => {
    const { actions: _, ...plain } = page();
    plain.sections = [{ id: 's', title: 'S', cards: [{ id: 'a', title: 'A' }] }];
    const html = await renderDocument(plain);
    assert.match(html, /<main><header>/);
    for (const bad of [{ ...actions, view: '' }, { ...actions, primary: [{ operation: 'Unisci!', label: 'x', confirm: 'y' }] }, { ...actions, menu: [{ operation: 'chiudi', label: 'x' }] }, 'x'])
        await assert.rejects(renderDocument(page({ actions: bad })), /actions must be/);
    const card = action => ({ ...page(), sections: [{ id: 's', title: 'S', cards: [{ id: 'a', title: 'A', action }] }] });
    for (const bad of [{ operation: 'commento', field: 'text' }, { operation: 'commento', submit: 'x', field: 'area' }, { submit: 'x', choices: [] }, { submit: 'x', choices: [{ operation: 'approva', label: 'A', disabled: true }] }])
        await assert.rejects(renderDocument(card(bad)), /Card a: action must be/);
});

test('a line comment on a page with operations carries the view id, so the agent binds it to this page', async () => {
    const diff = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,1 +1,2 @@\n uno\n+due\n';
    const html = await renderDocument(page({ sections: [{ id: 'file', title: 'File', cards: [{ id: 'd', title: 'File', diff: { text: diff } }] }] }));
    const { document, window } = boot(html);
    const row = document.querySelector('tr[data-mb-line="src/a.js:2"]');
    row.querySelector('[data-mb-comment]').click();
    const box = row.nextElementSibling;
    box.querySelector('textarea').value = 'Meglio una costante.';
    box.querySelectorAll('button')[0].click();
    assert.deepEqual(plainOf(window.queued.map(q => [q.tag, q.data])), [['line-comment', { file: 'src/a.js', line: 2, text: 'Meglio una costante.', view: 'v1234' }]]);
});
