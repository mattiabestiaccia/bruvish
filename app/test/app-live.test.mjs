import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { runtimeEnvironment } from '../../bruvish/lib/env.mjs';
import { renderDocument } from '../../bruvish/lib/document.mjs';
import fs from 'node:fs';import {execute} from '../../bruvish/lib/opening.mjs';
import { builtCli, builtServer, buildSkip, isolatedEnvironment, root } from '../../bruvish/test-helpers/runtime.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, message) { let last; for (let i = 0; i < 120; i++) {
    try {
        last = await fn();
        if (last)
            return last;
    }
    catch (error) {
        last = error.message;
    }
    await delay(50);
} throw new Error(message + ': ' + JSON.stringify(last)); }
async function freePort() { const s = net.createServer(); await new Promise((r, j) => s.listen(0, '127.0.0.1', r).once('error', j)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function cdp(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }); let id = 0; const pending = new Map(), contexts = new Map(), errors = []; let artifactSession = null; ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p?.timer);
    m.error ? p?.reject(m.error) : p?.resolve(m.result);
} if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
    artifactSession = m.params.sessionId;
    void call('Runtime.enable', {}, artifactSession);
} if (m.method === 'Runtime.executionContextCreated') {
    const c = m.params.context;
    if (c.auxData?.isDefault)
        contexts.set(c.auxData.frameId, c.id);
} if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails); }); const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP call timed out: '+method+(params.expression?' — '+String(params.expression).slice(0,160):'')));},15000);pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params, ...sessionId ? { sessionId } : {} })); }); ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP target disconnected'));}pending.clear();});await call('Page.enable'); await call('Runtime.enable'); await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); return { call, errors, close: () => ws.close(), async evaluate(expression, frame = false) { let contextId; if (frame && !artifactSession) {
        const tree = await call('Page.getFrameTree');
        contextId = contexts.get(tree.frameTree.childFrames?.find(c => c.frame.name === 'artifact')?.frame.id);
        if (!contextId)
            throw new Error('iframe context unavailable');
    } const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...contextId ? { contextId } : {} }, frame ? artifactSession : undefined); if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; } }; }
test('dedicated app reuses its window, persists drafts and handles two sends in one review',{skip:buildSkip||process.env.LAVISH_MB_TEST_DEDICATED!=='1'||!process.env.LAVISH_APP_BUNDLE,timeout:240000},async()=>{
 const dir=process.env.LAVISH_MB_TEST_ROOT?path.resolve(process.env.LAVISH_MB_TEST_ROOT):await mkdtemp(path.join(os.tmpdir(),'lavish-dedicated-'));await mkdir(dir,{recursive:true});let server,client,uiClient,appPid,keepApp=false;
 try{
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const env=runtimeEnvironment({...process.env,...isolatedEnvironment(dir),LAVISH_AXI_PORT:String(port),LAVISH_AXI_STATE_DIR:path.join(dir,'server'),LAVISH_AXI_IDLE_TIMEOUT_MS:'60000',LAVISH_AXI_TELEMETRY:'off',LAVISH_APP_STATE_DIR:path.join(dir,'app'),LAVISH_APP_TEST_CDP:'1',LAVISH_APP_ACK_TIMEOUT_MS:'120000',LAVISH_APP_CORE_ROOT:root});
  server=spawn(process.execPath,[builtServer,'server','--port',String(port)],{env,stdio:'ignore'});
  await until(async()=> (await fetch(base+'/health')).ok,'server');
  const file=path.join(dir,'automation-dummy.html');await writeFile(file,await renderDocument({title:'Lavish app dummy',guide:'Accoda e invia.',sections:[{id:'questions',title:'Domande',cards:[{id:'q0',title:'Prova',status:'waiting',paragraphs:Array.from({length:35},(_,i)=>['Paragrafo dummy '+i+'. Testo per verificare il mantenimento della posizione nella pagina.']),question:{options:[1,2,3].map(i=>({value:'giro-'+i,label:'Giro '+i}))}}]}]}));
  const response=await fetch(base+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file,noGate:true})});const session=await response.json();assert(response.ok,JSON.stringify(session));
  let bootstrapDebugPort;
  if(process.env.LAVISH_APP_BUNDLE){const bundle=process.env.LAVISH_APP_BUNDLE;const info=JSON.parse(await readFile(bundle+'.lavish-build.json','utf8'));await rm(path.join(dir,'app/profile/DevToolsActivePort'),{force:true});const bare=spawn(path.join(bundle,'Contents/MacOS',info.executable),[],{env,stdio:'ignore'});bare.unref();appPid=bare.pid;bootstrapDebugPort=await until(async()=>Number((await readFile(path.join(dir,'app/profile/DevToolsActivePort'),'utf8')).split('\n')[0]),'landing CDP');await until(async()=>{const ps=await(await fetch('http://127.0.0.1:'+bootstrapDebugPort+'/json/list')).json();return ps.some(p=>p.url.startsWith('file:')&&p.url.endsWith('/ui/index.html'));},'landing without arguments');}
  const adapter=new URL('../open.mjs',import.meta.url).pathname;
  const opened=await execute(process.execPath,[adapter,session.url,file],{env});if(opened.code&&opened.stderr.includes('left running'))keepApp=true;assert.equal(opened.code,0,opened.stderr);const first=JSON.parse(opened.stdout);appPid=first.pid;assert.equal(first.surface,'dedicated-electron');
  const debugPort=bootstrapDebugPort||await until(async()=>Number((await readFile(path.join(dir,'app/profile/DevToolsActivePort'),'utf8')).split('\n')[0]),'app CDP');
  const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();client=await cdp(pages.find(p=>p.url===session.url).webSocketDebuggerUrl);
  uiClient=await cdp(pages.find(p=>p.url.startsWith('file:')&&p.url.endsWith('/ui/index.html')).webSocketDebuggerUrl);
  await uiClient.evaluate('document.getElementById("home").click()');await until(()=>uiClient.evaluate('Array.from(document.querySelectorAll(".review .path")).some(n=>n.textContent==='+JSON.stringify(file)+')'),'native catalog reads canonical state');
  await uiClient.evaluate('Array.from(document.querySelectorAll(".review")).find(n=>n.querySelector(".path").textContent==='+JSON.stringify(file)+').querySelector("button").click()');await until(()=>uiClient.evaluate('document.body.classList.contains("in-review")'),'catalog opens through canonical CLI');
  const again=await execute(process.execPath,[adapter,session.url,file],{env});assert.equal(again.code,0,again.stderr);assert.equal(JSON.parse(again.stdout).pid,first.pid);assert.equal(JSON.parse(again.stdout).window,first.window);
  // Interview cards have no free text field: the draft is the chosen answer.
  const choice='document.querySelector("[data-mb-question=q0] input:checked")?.value';
  const choose=value=>'(()=>{const option=document.querySelector("[data-mb-question=q0] input[value='+value+']");if(!option)return false;option.checked=true;option.dispatchEvent(new Event("input",{bubbles:true}));return true})()';
  await until(()=>client.evaluate(choose('giro-3'),true),'artifact');
  await until(()=>client.evaluate('Object.entries(localStorage).some(([k,v])=>k.startsWith("lavish-mb:v1:")&&JSON.parse(v).fields?.["q0:choice"]?.value==="giro-3")'),'draft storage');
  await client.evaluate('document.querySelector("details")?.setAttribute("open","");scrollTo(0,400)',true);const scrollBefore=await client.evaluate('scrollY',true);assert(scrollBefore>0,'dummy must actually scroll');
  const reused=await execute(process.execPath,[adapter,session.url,file],{env});assert.equal(reused.code,0,reused.stderr);assert.equal(JSON.parse(reused.stdout).view,first.view);assert.equal(JSON.parse(reused.stdout).reused,true);assert.equal(await client.evaluate('scrollY',true),scrollBefore,'duplicate open preserves scroll');assert.equal(await client.evaluate(choice,true),'giro-3');
  await client.call('Page.reload');await until(async()=>await client.evaluate(choice,true)==='giro-3','draft reload');
  // Two feedback rounds through the ordinary CLI: a tracked poll, the native Send, then a reply.
  const cli=(...args)=>execute(process.execPath,[builtCli,...args],{env});
  for(let i=1;i<=2;i++){
   const text='giro-'+i;
   await until(()=>client.evaluate('window.lavish&&'+choose(text)+'&&(document.querySelector("[data-mb-question=q0]").requestSubmit(),true)',true),'form ready before send');
   const poll=cli('poll',file,'--timeout-ms','60000');
   await until(()=>client.evaluate('!document.getElementById("send").disabled'),'send enabled');await client.evaluate('document.getElementById("send").click()');
   const feedback=await poll;assert.equal(feedback.code,0,feedback.stderr);assert(feedback.stdout.includes(text),feedback.stdout);
   const reply=await cli('reply',file,'--agent-reply','Riscontro agente '+i);assert.equal(reply.code,0,reply.stderr);
   await until(()=>client.evaluate('document.body.textContent.includes('+JSON.stringify('Riscontro agente '+i)+')'),'reply visible');
  }
  // Exercise real application IPC and frame styling without reloading the review.
  const stableView = JSON.parse(reused.stdout).view;
  // Establish an acknowledged opaque baseline before measuring the toggle.
  await uiClient.evaluate('window.lavishApp.preferences({transparent:false,artifactBackground:true,layout:"list"})');
  await until(()=>uiClient.evaluate('!document.body.classList.contains("transparent")'),'opaque baseline acknowledged');
  await until(()=>client.evaluate('!document.getElementById("lavish-private-app-background")',true),'opaque artifact baseline');
  const beforeToggle = await client.evaluate('scrollY',true);
  const draftBeforeToggle = await client.evaluate(choice,true);
  const backgroundBeforeToggle = await client.evaluate('getComputedStyle(document.body).backgroundColor',true);
  await uiClient.evaluate('document.getElementById("transparent").click()');
  await uiClient.evaluate('window.lavishApp.snapshot()');
  await until(()=>uiClient.evaluate('document.body.classList.contains("transparent")'),'transparent app shell');
  await until(()=>client.evaluate('!!document.getElementById("lavish-private-app-background")',true),'transparent artifact frame');
  assert.equal(await client.evaluate('getComputedStyle(document.documentElement).backgroundColor',true),'rgba(0, 0, 0, 0)');
  const bodyAlpha = await client.evaluate(`(() => {const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(document.body).backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]})()`,true);
  assert(bodyAlpha > 0 && bodyAlpha < 128,'artifact body has a translucent background');
  assert.equal(await client.evaluate('scrollY',true),beforeToggle,'appearance toggle preserves scroll');
  assert.equal(await client.evaluate(choice,true),draftBeforeToggle);
  await uiClient.evaluate('document.getElementById("artifact-background").click()');
  await uiClient.evaluate('window.lavishApp.snapshot()');
  await until(()=>client.evaluate('!document.getElementById("lavish-private-app-background")',true),'original artifact background restored');
  assert.equal(await client.evaluate('getComputedStyle(document.body).backgroundColor',true),backgroundBeforeToggle);
  await uiClient.evaluate('document.getElementById("artifact-background").click()');
  await uiClient.evaluate('window.lavishApp.snapshot()');
  await until(()=>client.evaluate('!!document.getElementById("lavish-private-app-background")',true),'artifact background enabled again');
  await client.call('Page.reload');
  await until(()=>client.evaluate('!!document.getElementById("lavish-private-app-background")',true),'artifact transparency survives reload');
  await uiClient.evaluate('document.getElementById("transparent").click()');
  await uiClient.evaluate('window.lavishApp.snapshot()');
  await until(()=>client.evaluate('!document.getElementById("lavish-private-app-background")',true),'opaque appearance restored');
  await uiClient.evaluate('document.getElementById("home").click()');
  await until(()=>uiClient.evaluate('!document.body.classList.contains("in-review") && document.querySelectorAll(".review").length>0'),'catalog after appearance changes');
  await uiClient.evaluate('document.getElementById("layout").click()');
  await uiClient.evaluate('window.lavishApp.snapshot()');
  await until(()=>uiClient.evaluate('document.getElementById("reviews").classList.contains("grid")'),'compact native catalog');
  await uiClient.evaluate('document.querySelector(".review .favorite").click()');
  await until(()=>uiClient.evaluate('document.querySelector(".review .favorite").getAttribute("aria-pressed")==="true"'),'native favorite persisted');
  await uiClient.evaluate('document.querySelector(".review .pin").click()');
  await until(()=>uiClient.evaluate('document.querySelector(".review .pin").getAttribute("aria-pressed")==="true"'),'native pin persisted');
  await uiClient.evaluate('document.querySelector(".review .copy-path").click()');
  await until(()=>uiClient.evaluate('document.getElementById("status").textContent.startsWith("Percorso copiato:")'),'copy file path through native IPC');
  const saved = JSON.parse(await readFile(path.join(dir,'app/preferences.json'),'utf8'));
  assert.equal(saved.layout,'grid');assert.equal(saved.artifacts[file].favorite,true);assert.equal(saved.artifacts[file].pinned,true);
  await uiClient.call('Page.reload');
  await until(()=>uiClient.evaluate('document.querySelector(".review .pin")?.getAttribute("aria-pressed")==="true" && document.getElementById("reviews").classList.contains("grid")'),'catalog choices survive UI reload');
  const afterAppearance=await execute(process.execPath,[adapter,session.url,file],{env});
  assert.equal(afterAppearance.code,0,afterAppearance.stderr);assert.equal(JSON.parse(afterAppearance.stdout).view,stableView);
  const voices=await until(()=>client.evaluate('typeof speechSynthesis==="object"?speechSynthesis.getVoices().filter(v=>v.lang.startsWith("it")).length:0',true),'Italian SpeechSynthesis voices');
  const speech=await client.evaluate('new Promise(resolve=>{const u=new SpeechSynthesisUtterance("Prova Lavish");u.lang="it-IT";let done=false;const finish=v=>{if(done)return;done=true;resolve(v)};u.onstart=()=>{finish("started");speechSynthesis.cancel()};u.onerror=e=>finish(e.error);speechSynthesis.speak(u);setTimeout(()=>{finish("timeout");speechSynthesis.cancel()},4000)})',true);assert.equal(speech,'started');
  if(process.env.LAVISH_MB_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,{recursive:true});const shot=await client.call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'dedicated-dummy.png'),Buffer.from(shot.data,'base64'));await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'dedicated-result.json'),JSON.stringify({first,secondSend:true,persistentDraft:true,italianVoices:voices,speechStart:speech,audioListened:false},null,2));}
 }catch(error){
  const evidence=process.env.LAVISH_MB_TEST_EVIDENCE_DIR;
  if(evidence){
   await mkdir(evidence,{recursive:true});
   const diagnostic={error:error.message,uiExceptions:uiClient?.errors,reviewExceptions:client?.errors};
   try{diagnostic.ui=await uiClient.evaluate(`({inReview:document.body.classList.contains('in-review'),layoutLabel:document.getElementById('layout')?.textContent,grid:document.getElementById('reviews')?.classList.contains('grid'),error:document.getElementById('error')?.textContent})`);}catch(e){diagnostic.uiError=e.message;}
   try{diagnostic.preferences=JSON.parse(await readFile(path.join(dir,'app/preferences.json'),'utf8'));}catch{}
   try{const shot=await uiClient.call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,'native-failure.png'),Buffer.from(shot.data,'base64'));}catch{}
   await writeFile(path.join(evidence,'native-failure.json'),JSON.stringify(diagnostic,null,2));
  }
  throw error;
 }finally{if(process.env.LAVISH_MB_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,{recursive:true});try{await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'app-last.log'),await readFile(path.join(dir,'app/app.log')));}catch{}}client?.close();uiClient?.close();if(appPid&&!keepApp)try{process.kill(appPid,'SIGTERM');}catch{}server?.kill('SIGTERM');await delay(300);if(!process.env.LAVISH_MB_TEST_ROOT)await rm(dir,{recursive:true,force:true});}
});
