import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const chrome = process.env.LAVISH_MB_TEST_CHROME;
async function until(fn) {
  let error;
  for (let i = 0; i < 120; i++) {
    try {const value = await fn();if (value) return value;} catch (e) {error = e;}
    await new Promise(r => setTimeout(r, 50));
  }
  throw error || Error('Timed out');
}
const fixture = `
window.calls = [];
window.libraryPreferences = {transparent:false,artifactBackground:true,artifacts:{},folders:[],folderAssignments:{}};
window.lavishApp = {
  catalog: async () => [
    {key:'1',name:'Intervista',file:'/tmp/intervista.html',status:'active',available:true},
    {key:'2',name:'Concluso',file:'/tmp/concluso.html',status:'ended',available:true,metadata:{workedAt:'2026-11-22T01:25:00Z',agent:'Pi',profile:'pib',sessionId:'demo-123'}},
    {key:'3',name:'<img src=x onerror=alert(1)>',file:'/tmp/missing.html',status:'active',available:false}
  ],
  snapshot: async () => ({preferences:libraryPreferences,tabs:[{id:'tab1',title:'Scheda esistente'}],active:null}),
  openReview: async key => calls.push(['open',key]),
  home: async () => calls.push(['home']),
  select: async id => calls.push(['select',id]),
  close: async id => calls.push(['close',id]),
  chooseFile: async () => calls.push(['choose']),
  reviewAction: async name => {calls.push(['review-action',name]);if(name==='annotate')reviewState.controls.annotate.checked=!reviewState.controls.annotate.checked;return reviewState;},
  preferences: async settings => Object.assign(libraryPreferences,settings),
  mark: async request => {
    calls.push(['mark',request]);
    const file = {'1':'/tmp/intervista.html','2':'/tmp/concluso.html','3':'/tmp/missing.html'}[request.key];
    libraryPreferences.artifacts[file] = {...libraryPreferences.artifacts[file],[request.field]:request.value};
    return libraryPreferences;
  },
  createFolder: async name => {libraryPreferences.folders.push({id:'folder-fixture',name});return libraryPreferences;},
  assignFolder: async ({key,folderId}) => {if(key === '2')libraryPreferences.folderAssignments['/tmp/concluso.html']=folderId;return libraryPreferences;},
  fileAction: async request => calls.push(['file',request]),
  onChange: fn => window.changed = fn
};`;

test('catalog suggests titles, filters, assigns folders, and routes file actions safely', {timeout: 30000, skip: !chrome && 'set LAVISH_MB_TEST_CHROME to a Chrome for Testing executable'}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavish-home-ui-'));
  let browser, ws, chromeErrors = '';
  try {
    browser = spawn(chrome, ['--headless=new','--remote-debugging-port=0','--user-data-dir='+dir,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','about:blank'], {stdio: ['ignore','ignore','pipe']});
    browser.stderr.on('data', data => chromeErrors += data);
    browser.on('error', error => chromeErrors += error.message);
    let port;
    try {port = await until(async () => Number((await fs.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0]));}
    catch (error) {throw Error(`Chrome test startup failed (${browser.exitCode ?? browser.signalCode}): ${chromeErrors || error.message}`);}
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((r,j) => {ws.onopen=r;ws.onerror=j;});
    let id = 0;
    const pending = new Map();
    ws.onmessage = event => {
      const m = JSON.parse(event.data), p = pending.get(m.id);
      if (p) {pending.delete(m.id);m.error ? p.reject(m.error) : p.resolve(m.result);}
    };
    const call = (method, params = {}) => new Promise((resolve,reject) => {
      const n = ++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride',{width:1240,height:920,deviceScaleFactor:1,mobile:false});
    await call('Page.addScriptToEvaluateOnNewDocument',{source:fixture});
    await call('Page.navigate',{url:new URL('../ui/index.html',import.meta.url).href});
    await until(() => evaluate('document.querySelectorAll(".catalog-row").length===3'));
    assert.equal(await evaluate('document.querySelectorAll(".catalog-row img").length'),0);
    assert.equal(await evaluate('document.querySelectorAll(".open-review")[2].disabled'),true);
    await evaluate('document.querySelectorAll(".open-review")[1].click()');
    assert.deepEqual(await evaluate('calls'),[['open','2']]);
    await evaluate('document.getElementById("search").value="intervista";document.getElementById("search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".catalog-row").length'),1);
    assert.equal(await evaluate('document.querySelector("#suggestions [role=option]").textContent'),'Intervista');
    await evaluate('document.querySelector(".tab .title").click();document.querySelector(".tab .close").click()');
    assert.deepEqual(await evaluate('calls.slice(1)'),[['select','tab1'],['close','tab1']]);
    assert.equal(await evaluate('document.querySelector("#choose,#artifact-background")'),null);
    assert.deepEqual(await evaluate('(()=>{const b=document.getElementById("transparent");return [b.getAttribute("role"),b.getAttribute("aria-label"),b.getAttribute("aria-checked"),b.textContent.trim()]})()'),['switch','Trasparenza','false','']);
    await evaluate('changed({tabs:[],active:null});document.getElementById("search").value="";document.getElementById("search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".tab").length'),0);
    assert.equal(await evaluate('document.getElementById("layout")'),null);
    await evaluate('document.getElementById("pinned-2").click()');
    await until(() => evaluate('document.querySelector(".catalog-name").textContent==="Concluso"'));
    await evaluate('document.getElementById("favorite-2").click()');
    await until(() => evaluate('document.getElementById("favorite-2").getAttribute("aria-pressed")==="true"'));
    await evaluate('document.getElementById("new-folder").click();document.getElementById("folder-name").value="Note";document.getElementById("folder-form").requestSubmit()');
    await until(() => evaluate('document.getElementById("folders").textContent.includes("Note")'));
    await evaluate('document.getElementById("info-2").click()');
    assert.equal(await evaluate('document.querySelector("#catalog-info").matches(":popover-open")'),true);
    assert.match(await evaluate('document.querySelector("#catalog-info dl").textContent'),/demo-123/);
    await evaluate('(()=>{const s=document.querySelector("#catalog-info select");s.value="folder-fixture";s.dispatchEvent(new Event("change"));})()');
    await until(() => evaluate('document.querySelector(".catalog-folder").textContent==="Note"'));
    await evaluate('document.getElementById("info-2").click();[...document.querySelectorAll("#catalog-info .catalog-actions button")].reverse().forEach(b=>b.click())');
    await until(() => evaluate('calls.filter(c=>c[0]==="file").length===2'));
    assert.deepEqual(await evaluate('calls.filter(c=>c[0]==="file")'),[['file',{key:'2',action:'copy'}],['file',{key:'2',action:'reveal'}]]);
    await evaluate('document.querySelector("#catalog-filter summary").click();[...document.querySelectorAll("#filter-options button")].find(b=>b.textContent==="Solo preferiti").click()');
    assert.equal(await evaluate('document.querySelectorAll(".catalog-row").length'),1);
    await evaluate('document.getElementById("transparent").click()');
    await until(() => evaluate('document.body.classList.contains("transparent")'));
    assert.equal(await evaluate('document.getElementById("transparent").getAttribute("aria-checked")'),'true');
    assert.equal(await evaluate('getComputedStyle(document.documentElement).backgroundColor'),'rgba(0, 0, 0, 0)');
    // The backdrop window owns the single 40% tint (rgba(16,19,24,.4), the accepted pre-toolbar home); the home view adds none.
    assert.deepEqual(await evaluate('(()=>{const s=getComputedStyle(document.body);return [s.backgroundColor,s.backgroundImage]})()'),['rgba(0, 0, 0, 0)','none'],'the transparent home paints no second tint');
    if (process.env.LAVISH_MB_TEST_EVIDENCE_DIR) {
      await fs.mkdir(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,{recursive:true});
      const shot = await call('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'app-catalog-list.png'),Buffer.from(shot.data,'base64'));
    }
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    await evaluate('document.getElementById("favorite-2").click()');
    await until(() => evaluate('document.querySelectorAll(".catalog-row").length===0'));
    await evaluate('window.reviewState={preferences:libraryPreferences,tabs:[{id:"tab1",title:"An unusually long review title to exercise tab overflow"}],active:"tab1",controls:Object.fromEntries(["annotate","closed","panel","more","revisions","warnings"].map(id=>[id,{hidden:false,disabled:false,checked:true,expanded:false,count:id==="warnings"?"3":""}]))};changed(reviewState)');
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgba(0, 0, 0, 0)','the transparent review composition is unchanged');
    for (const width of [720,1000,1240]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:920,deviceScaleFactor:1,mobile:false});
      assert.deepEqual(await evaluate('(()=>{const bar=document.querySelector(".toolbar").getBoundingClientRect(),group=document.getElementById("toolbar-actions").getBoundingClientRect();return {left:bar.left,width:bar.width,height:bar.height,groupInside:group.right<=bar.right,groupAtRight:bar.right-group.right===8,centered:[...document.querySelectorAll("#toolbar-actions button")].every(b=>{const r=b.getBoundingClientRect();return r.top+r.height/2===bar.height/2})}})()'),{left:0,width,height:40,groupInside:true,groupAtRight:true,centered:true});
    }
    await evaluate('document.getElementById("annotate").click()');
    await until(()=>evaluate('document.getElementById("annotate").getAttribute("aria-checked")==="false"'));
    assert.deepEqual(await evaluate('calls.at(-1)'),['review-action','annotate']);
    await evaluate('lavishApp.catalog=async()=>[{key:"a",name:"pagina",file:"/r/uno/pagina.html",status:"active",available:true},{key:"b",name:"pagina",file:"/r/due/pagina.html",status:"active",available:true},{key:"c",name:"Altro",file:"/r/uno/altro.html",status:"active",available:true}];document.getElementById("clear-catalog").click();document.getElementById("refresh").click()');
    await until(() => evaluate('document.querySelectorAll(".catalog-row").length===3&&document.querySelector(".catalog-name").firstChild.textContent==="pagina"'));
    const titles = selector => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(n=>[n.firstChild.textContent,n.querySelector(".catalog-identifier")?.textContent??null])`);
    assert.deepEqual(await titles('.catalog-name'),[['pagina','uno'],['pagina','due'],['Altro',null]]);
    await evaluate('document.getElementById("search").value="pagina";document.getElementById("search").dispatchEvent(new Event("input"))');
    assert.deepEqual(await titles('#suggestions [role=option]'),[['pagina','uno'],['pagina','due']]);
    await evaluate('document.querySelectorAll("#suggestions [role=option]")[1].click()');
    assert.equal(await evaluate('document.getElementById("search").value'),'pagina');
    assert.deepEqual(await titles('.catalog-name'),[['pagina','due']]);
    await call('Page.navigate',{url:new URL('../ui/backdrop.html',import.meta.url).href});
    await until(() => evaluate('document.readyState==="complete"&&getComputedStyle(document.body).backgroundColor!=="rgba(0, 0, 0, 0)"'));
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgba(16, 19, 24, 0.4)','the backdrop paints the single 40% tint');
  } finally {
    ws?.close();
    if (browser && browser.exitCode===null && browser.signalCode===null) {browser.kill('SIGTERM');await new Promise(r=>browser.once('exit',r));}
    await fs.rm(dir,{recursive:true,force:true});
  }
});
