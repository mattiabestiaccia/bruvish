import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {checkCardEdit, cardEditFixture} from '../test-helpers/card-edit.mjs';

test('every renderer expression the card-edit check sends compiles as script code', async () => {
 const expressions = [], written = [];
 const point = {x: 0, y: 0, hit: true};
 const client = {
  async evaluate(expression) {new vm.Script(expression);expressions.push(expression);return point;},
  async call() {}
 };
 const until = async fn => {await fn();return point;};
 await checkCardEdit({client, until, delay: async () => {}, writeFile: async (_file, data) => {written.push(data);}, file: '/x.html'});
 assert.deepEqual(written, [cardEditFixture]);
 assert(expressions.length > 0);
});

function runFixture() {
 const script = /<script>([\s\S]*?)<\/script>/.exec(cardEditFixture)[1];
 const queued = [], listeners = new Map(), classes = new Set(['card', 'attesa']);
 const card = {dataset: {lavishQuestion: 'T1'}, classList: {add: name => classes.add(name), remove: name => classes.delete(name)}, querySelectorAll: () => buttons};
 const buttons = ['lavanda', 'ambra'].map(v => {
  const attributes = {};
  const button = {dataset: {v}, getAttribute: name => attributes[name] ?? null, setAttribute: (name, value) => {attributes[name] = String(value);},
   closest: selector => selector === 'section' ? card : null, addEventListener: (_type, fn) => listeners.set(v, fn)};
  return button;
 });
 vm.runInNewContext(script, {document: {querySelectorAll: () => buttons}, window: {lavish: {queuePrompt: (text, options) => queued.push({text, options})}}});
 return {queued, classes, card, tap: value => listeners.get(value)()};
}

test('the fixture answers in two taps on its card with a per-question key, then marks the card answered', () => {
 const run = runFixture();
 run.tap('lavanda');
 assert.deepEqual([run.queued.length, [...run.classes]], [0, ['card', 'attesa']], 'a first tap only selects');
 run.tap('lavanda');
 assert.equal(run.queued.length, 1);
 assert.equal(run.queued[0].options.element, run.card, 'the answer is anchored to its card');
 assert.equal(run.queued[0].options.queueKey, 'T1');
 assert.match(run.queued[0].text, /lavanda/);
 assert.deepEqual([...run.classes], ['card', 'fatta'], 'the card moves to its answered class');
 run.tap('ambra');run.tap('ambra');
 assert.deepEqual(run.queued.map(item => item.options.queueKey), ['T1', 'T1'], 'a newer answer reuses the key, so it replaces the queued one');
});
