import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {checkCardEdit, cardEditFixture} from '../test-helpers/card-edit.mjs';

// A scripted review: every expression must compile as renderer code, and the check must follow the
// upstream order (answer, card still there, annotate click reopens, save, same-key replacement).
function fakeReview({cardHidden = false, reopen = true} = {}) {
 let notes = [], annotate = 'false', editing = false, written = '';
 const calls = [];
 const client = {
  async evaluate(expression, frame = false) {
   new vm.Script(expression);
   calls.push([frame ? 'artifact' : 'chrome', expression]);
   if (expression.includes('"card-edit"')) return written.includes('id="card-edit"');
   if (expression === '!!window.lavish') return true;
   if (expression.includes('getAttribute("aria-checked")') && expression.includes('===')) return expression.endsWith(JSON.stringify(annotate));
   if (expression.includes('getAttribute("aria-checked")')) return annotate;
   if (expression.includes('getElementById("annotation").click()')) {annotate = annotate === 'true' ? 'false' : 'true';return undefined;}
   if (expression.includes('#queuedLog .bubble.queued')) return notes;
   if (expression.includes('"t1").getClientRects')) return !cardHidden;
   if (expression.includes('elementFromPoint')) {
    if (expression.includes('"#t1"') && cardHidden) return null;
    return {x: 10, y: 20, hit: true};
   }
   if (expression.includes('getElementById("artifact")')) return {x: 100, y: 40};
   if (expression.includes('!!document.querySelector(".queued-edit-input")')) return editing;
   if (expression.includes('input.value=')) {notes = ['T1 corretta sulla carta'];return undefined;}
   if (expression.includes('".queued-edit-save"')) return {x: 5, y: 5};
   if (expression.includes('.queued-remove')) {notes = [];return undefined;}
   throw new Error('unexpected expression: ' + expression.slice(0, 80));
  },
  async call(method, params) {
   assert.equal(method, 'Input.dispatchMouseEvent');
   if (params.type !== 'mouseReleased') return;
   const last = calls.at(-1)?.[1] || '';
   if (last.includes('getElementById("artifact")')) {
    const target = calls.at(-2)[1];
    const value = /data-v=(\w+)/.exec(target)?.[1];
    if (value) {
     taps.push(value);
     if (taps.length % 2 === 0) notes = ['Prova, T1: risposta ' + value + '.'];
    } else if (annotate === 'true' && reopen) editing = true;
   }
   if (last.includes('".queued-edit-save"')) editing = false;
  }
 };
 const taps = [];
 const until = async (fn, message) => {for (let i = 0; i < 5; i++) {const value = await fn();if (value) return value;}throw new Error(message);};
 return {client, until, delay: async () => {}, writeFile: async (_file, data) => {written = data;}, file: '/x.html', calls, taps};
}

test('card-edit check follows the upstream ways of changing a queued answer, in renderer-valid code', async () => {
 const review = fakeReview();
 const steps = await checkCardEdit(review);
 assert.deepEqual(review.taps, ['lavanda', 'lavanda', 'ambra', 'ambra']);
 assert.deepEqual(steps.map(step => step.selector), ['#t1 .opz[data-v=lavanda]', '#t1 .opz[data-v=lavanda]', '#t1', '.queued-edit-save', '#t1 .opz[data-v=ambra]', '#t1 .opz[data-v=ambra]']);
 assert.deepEqual(steps[2].point, {x: 110, y: 60}, 'artifact clicks add the frame offset');
});

test('card-edit check fails with the regression message when the answered card is hidden', async () => {
 await assert.rejects(checkCardEdit(fakeReview({cardHidden: true})), /the card answered in this session stays on the page/);
});

test('card-edit check fails when the annotate-mode click does not reopen the queued answer', async () => {
 await assert.rejects(checkCardEdit(fakeReview({reopen: false})), /annotate-mode click on the answered card reopens its queued answer/);
});

test('card-edit fixture queues on the card with a per-question key, as hand-written two-tap pages do', () => {
 assert.match(cardEditFixture, /element: card, queueKey: q/);
 assert.match(cardEditFixture, /classList\.add\('fatta'\)/);
 assert.match(cardEditFixture, /id="t2"[^>]*data-lavish-question/, 'a second open card keeps the closed-card filter active');
});
