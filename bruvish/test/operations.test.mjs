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

test('two operations with the same name from different cards stay two prompts in the Lavish queue', async () => {
    const { document, window } = boot(await renderDocument(page()));
    const comment = document.getElementById('commento').querySelector('form'), review = document.getElementById('rev').querySelector('form');
    comment.querySelector('.mb-op-text').value = 'Testo A';
    comment.requestSubmit(); comment.requestSubmit();
    review.querySelectorAll('input[type="radio"]').forEach(radio => { radio.checked = radio.value === 'commento'; });
    review.querySelector('.mb-op-text').value = 'Testo B';
    review.requestSubmit(); review.requestSubmit();
    // Lavish chrome rule (src/chrome-client.js enqueuePrompt): a prompt with a non-empty queueKey replaces the queued one with the same key.
    const queue = [];
    for (const q of window.queued) {
        const at = q.queueKey ? queue.findIndex(other => other.queueKey === q.queueKey) : -1;
        if (at === -1) queue.push(q); else queue[at] = q;
    }
    assert.deepEqual(plainOf(queue.map(q => [q.data.operation, q.data.text])), [['commento', 'Testo A'], ['commento', 'Testo B']]);
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
    for (const bad of [{ ...actions, view: '' }, { ...actions, primary: [{ operation: 'Unisci!', label: 'x', confirm: 'y' }] }, { ...actions, menu: [{ operation: 'chiudi', label: 'x' }] }, 'x', null, false, 0, ''])
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

const reviewer = { operation: 'revisore', label: 'Assegna un revisore', field: 'line', required: true, placeholder: 'Login GitHub, per esempio octocat', confirm: 'Chiede la revisione a una persona. Scrivi il suo login, poi Conferma.' };

test('a fixed operation is an always-visible header button beside the main ones; without it the header markup is unchanged', async () => {
    const html = await renderDocument(page({ actions: { ...actions, fixed: [reviewer] } }));
    assert.match(html, /<div class="mb-actions" data-mb-actions><div class="mb-actions-row"><div class="mb-actions-primary">[\s\S]*?<\/div><div class="mb-actions-fixed"><button type="button" class="mb-action-fixed" data-mb-op="revisore" data-mb-confirm-title="Assegna un revisore" data-mb-confirm="Chiede la revisione a una persona\.[^"]*" data-mb-field-kind="line" data-mb-placeholder="Login GitHub, per esempio octocat" data-mb-required>Assegna un revisore<\/button><\/div><\/div><details class="mb-actions-menu">/);
    // Only the fixed operation: no main alternative, no menu, the button is still there.
    const alone = await renderDocument(page({ actions: { view: 'v1234', fixed: [reviewer] } }));
    assert.match(alone, /<div class="mb-actions" data-mb-actions><div class="mb-actions-row"><div class="mb-actions-fixed"><button type="button" class="mb-action-fixed" data-mb-op="revisore"/);
    assert.doesNotMatch(alone.slice(alone.indexOf('<body>')), /mb-actions-primary|mb-actions-menu/);
    for (const input of [page(), page({ actions: { ...actions, fixed: [] } })])
        assert.match(await renderDocument(input), /<div class="mb-actions" data-mb-actions><div class="mb-actions-primary">/, 'no fixed operation: no row wrapper');
    for (const bad of [{ ...actions, fixed: reviewer }, { ...actions, fixed: [{ ...reviewer, field: 'area' }] }, { ...actions, fixed: [{ ...reviewer, required: 'yes' }] },
        { ...actions, fixed: [{ ...reviewer, field: undefined }] }, { ...actions, fixed: [{ ...reviewer, placeholder: 3 }] }, { ...actions, fixed: [{ ...reviewer, confirm: '' }] }])
        await assert.rejects(renderDocument(page({ actions: bad })), /actions must be/);
});

test('the fixed operation asks for its text in the confirmation: empty refuses, Enter or Conferma sends the text', async () => {
    const { document, window, sent } = boot(await renderDocument(page({ actions: { ...actions, fixed: [reviewer] } })));
    const box = document.querySelector('.mb-confirm'), button = document.querySelector('.mb-action-fixed'), main = document.querySelector('.mb-action-main');
    button.click();
    assert.equal(box.hidden, false);
    assert.equal(box.querySelector('.mb-confirm-title').textContent, 'Assegna un revisore?');
    const field = box.querySelector('input.mb-confirm-field');
    assert.equal(field.getAttribute('placeholder'), 'Login GitHub, per esempio octocat');
    assert.equal(field.getAttribute('aria-label'), 'Assegna un revisore');
    assert.equal(document.activeElement, field, 'the field takes the focus');
    assert.ok(main.classList.contains('mb-action-main') && !button.classList.contains('mb-action-main'), 'a fixed operation never becomes the main alternative');
    box.querySelector('.mb-confirm-yes').click();
    assert.equal(box.querySelector('.mb-op-status').textContent, 'Compila il campo prima di confermare.');
    assert.equal(window.queued.length, 0);
    field.value = '  octocat ';
    document.dispatch(field, 'keydown', { key: 'Enter' });
    assert.deepEqual(plainOf(window.queued.map(q => [q.tag, q.data])), [['operation', { view: 'v1234', operation: 'revisore', text: 'octocat' }]]);
    assert.equal(sent.count, 1);
    assert.equal(box.querySelector('.mb-confirm-field'), null, 'after sending the dropdown shows only the outcome text');
    // A header operation without a field keeps the plain confirmation.
    main.click();
    assert.equal(box.querySelector('.mb-confirm-field'), null);
    assert.equal(box.querySelector('.mb-op-status'), null);
});

const flow = {
    id: 'operazione-revisione', title: 'La tua revisione', variant: 'flusso',
    paragraphs: ['La PR l\'ha aperta il tuo account: la revisione passa dal flusso.', '**Chiedi modifiche** rimette la PR in bozza. **Approva** la segna pronta.'],
    action: { submit: 'Invia la revisione', placeholder: 'Il motivo, o il commento', choices: [
        { operation: 'correzione', label: 'Chiedi modifiche', required: true, hint: 'serve il motivo: revisione, bozza, correzione' },
        { operation: 'approva-pronta', label: 'Approva', hint: 'approvazione e PR pronta; unire resta un clic' },
        { operation: 'commento', label: 'Solo commento', hint: 'senza esito', required: true }] },
};

test('a card with variant "flusso" renders its choices as tiles and sends the chosen flow operation with its text', async () => {
    const html = await renderDocument(page({ sections: [{ id: 'revisione', title: 'Revisione', cards: [flow] }] }));
    assert.match(html, /<article class="card" id="operazione-revisione" data-mb-state="info" data-mb-variant="flusso">/);
    assert.match(html, /<span class="sentence"><strong>Chiedi modifiche<\/strong> rimette la PR in bozza\.<\/span>/);
    assert.match(html, /<input type="radio" name="mb-op-operazione-revisione" value="correzione" data-mb-required checked><span>Chiedi modifiche<small>serve il motivo: revisione, bozza, correzione<\/small><\/span>/);
    const { document, window } = boot(html);
    const form = document.getElementById('operazione-revisione').querySelector('form');
    form.requestSubmit();
    assert.equal(form.querySelector('.mb-op-status').textContent, 'Scrivi il testo prima di inviare.', 'Chiedi modifiche needs the reason');
    form.querySelectorAll('input[type="radio"]').forEach(radio => { radio.checked = radio.value === 'approva-pronta'; });
    form.requestSubmit(); form.requestSubmit();
    assert.deepEqual(plainOf(window.queued.map(q => q.data)), [{ view: 'v1234', operation: 'approva-pronta', text: '' }], 'Approva goes without a text');
});

test('without variant the review card renders as before; a wrong variant or a variant without choices stops the render', async () => {
    const { variant: _, ...plain } = flow;
    const html = await renderDocument(page({ sections: [{ id: 'revisione', title: 'Revisione', cards: [plain] }] }));
    assert.match(html, /<article class="card" id="operazione-revisione" data-mb-state="info"><button class="voice"/);
    assert.doesNotMatch(html.slice(html.indexOf('<body>')), /data-mb-variant/);
    const one = card => page({ sections: [{ id: 'revisione', title: 'Revisione', cards: [card] }] });
    await assert.rejects(renderDocument(one({ ...flow, variant: 'percorso' })), /Card operazione-revisione: variant must be one of flusso or absent/);
    await assert.rejects(renderDocument(one({ ...flow, action: { operation: 'commento', field: 'text', submit: 'Invia' } })), /variant "flusso" needs an action with choices/);
    await assert.rejects(renderDocument(one({ id: 'x', title: 'X', variant: 'flusso' })), /variant "flusso" needs an action with choices/);
});
