// Native check: a hand-written two-tap answer queued on its card can be changed from that card.
// The upstream ways are the queued bubble, a click on the anchored element in annotate mode, and a
// newer answer with the same queueKey. Used by app-live.test.mjs.

export const cardEditFixture = `<!doctype html><html lang="it" data-lavish-annotate="off"><head><meta charset="utf-8"><style>
html{background:transparent}body{margin:0;background:transparent;color:#e6e0f2;font:16px system-ui,sans-serif}
.card{margin:40px;padding:28px;background:rgba(36,31,52,.5);border:1px solid #4a4462;border-radius:10px}
.opz{font:inherit;padding:8px 14px;margin-right:10px}
</style></head><body><h1 id="card-edit">Risposta da cambiare</h1>
<section class="card attesa" id="t1" data-lavish-question="T1"><h3>T1 · Colore</h3>
<div class="opzioni"><button class="opz" type="button" data-v="lavanda">lavanda</button><button class="opz" type="button" data-v="ambra">ambra</button></div></section>
<section class="card attesa" id="t2" data-lavish-question="T2"><h3>T2 · Ancora aperta</h3></section>
<script>
document.querySelectorAll('section[data-lavish-question] .opz').forEach((b) => b.addEventListener('click', () => {
  const card = b.closest('section'), q = card.dataset.lavishQuestion, opz = [...card.querySelectorAll('.opz')];
  if (b.getAttribute('aria-pressed') !== 'true') { opz.forEach((o) => o.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); return; }
  window.lavish.queuePrompt('Prova, ' + q + ': risposta ' + b.dataset.v + '.', {tag: 'choice', text: q + ': ' + b.dataset.v, element: card, queueKey: q});
  card.classList.remove('attesa'); card.classList.add('fatta');
}));
</script></body></html>`;

/**
 * @param {{client: any, until: (fn: () => any, message: string) => Promise<any>, delay: (ms: number) => Promise<void>,
 *   writeFile: (file: string, data: string) => Promise<void>, file: string}} options
 */
export async function checkCardEdit({client, until, delay, writeFile, file}) {
 const steps = [];
 const queued = '(()=>Array.from(document.querySelectorAll("#queuedLog .bubble.queued"),b=>b.textContent))()';
 const clickAt = async point => {
  for (const type of ['mousePressed', 'mouseReleased']) await client.call('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1});
 };
 // A real click inside the artifact: frame offset plus the element's own box, refusing a covered point.
 const clickArtifact = async (selector, {edge = false} = {}) => {
  const local = await until(() => client.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||!el.getClientRects().length)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=${edge}?r.x+8:r.x+r.width/2,y=${edge}?r.y+8:r.y+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)===el}})()`, true), 'visible artifact target ' + selector);
  if (!local.hit) throw new Error('artifact target is covered: ' + selector);
  const frame = await client.evaluate('(()=>{const r=document.getElementById("artifact").getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const point = {x: frame.x + local.x, y: frame.y + local.y};
  await clickAt(point);
  steps.push({selector, point});
 };
 const clickChrome = async selector => {
  const point = await until(() => client.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`), 'chrome target ' + selector);
  await clickAt(point);
  steps.push({selector, point});
 };
 const setAnnotate = async on => {
  if ((await client.evaluate('document.getElementById("annotation").getAttribute("aria-checked")||document.getElementById("annotation").getAttribute("aria-pressed")')) !== String(on)) await client.evaluate('document.getElementById("annotation").click()');
  await until(() => client.evaluate('(document.getElementById("annotation").getAttribute("aria-checked")||document.getElementById("annotation").getAttribute("aria-pressed"))===' + JSON.stringify(String(on))), 'annotate mode ' + on);
 };
 const answer = async value => {
  await clickArtifact('#t1 .opz[data-v=' + value + ']');
  await delay(150);
  await clickArtifact('#t1 .opz[data-v=' + value + ']');
 };

 await writeFile(file, cardEditFixture);
 await until(() => client.evaluate('!!document.getElementById("card-edit")', true), 'card-edit fixture reload');
 await until(() => client.evaluate('!!window.lavish', true), 'card-edit fixture SDK');
 await setAnnotate(false);
 await answer('lavanda');
 await until(async () => {const notes = await client.evaluate(queued);return notes.length === 1 && notes[0].includes('lavanda');}, 'two taps queue one answer');
 await delay(400);
 // The card the reviewer just answered stays on the page: the only place the next two ways start from.
 if (!(await client.evaluate('document.getElementById("t1").getClientRects().length>0', true))) throw new Error('the card answered in this session stays on the page');
 await setAnnotate(true);
 await clickArtifact('#t1', {edge: true});
 await until(() => client.evaluate('!!document.querySelector(".queued-edit-input")'), 'annotate-mode click on the answered card reopens its queued answer');
 await client.evaluate('(()=>{const input=document.querySelector(".queued-edit-input");input.value="T1 corretta sulla carta";input.dispatchEvent(new Event("input",{bubbles:true}))})()');
 await clickChrome('.queued-edit-save');
 await until(async () => {const notes = await client.evaluate(queued);return notes.length === 1 && notes[0].includes('corretta sulla carta');}, 'card edit saved on the same queued answer');
 await setAnnotate(false);
 await answer('ambra');
 await until(async () => {const notes = await client.evaluate(queued);return notes.length === 1 && notes[0].includes('ambra') && !notes[0].includes('corretta');}, 'a newer answer with the same queueKey replaces the queued one');
 await client.evaluate('document.querySelector("#queuedLog .queued-remove")?.click()');
 await until(async () => (await client.evaluate(queued)).length === 0, 'card-edit queue cleared');
 return steps;
}
