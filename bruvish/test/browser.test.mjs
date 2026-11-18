import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { runtimeEnvironment } from '../lib/env.mjs';
import { builtCli, builtServer, buildSkip, isolatedEnvironment, root } from '../test-helpers/runtime.mjs';
import { renderDocument } from '../lib/document.mjs';
const chrome = process.env.LAVISH_MB_TEST_CHROME;
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
    m.error ? p?.reject(m.error) : p?.resolve(m.result);
} if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
    artifactSession = m.params.sessionId;
    void call('Runtime.enable', {}, artifactSession);
} if (m.method === 'Runtime.executionContextCreated') {
    const c = m.params.context;
    if (c.auxData?.isDefault)
        contexts.set(c.auxData.frameId, c.id);
} if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails); }); const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params, ...sessionId ? { sessionId } : {} })); }); await call('Page.enable'); await call('Runtime.enable'); await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); return { call, errors, close: () => ws.close(),
    // Emulation is per renderer: the sandboxed artifact is an out-of-process iframe, so it needs its own copy.
    async emulate(method, params) { await call(method, params); if (artifactSession)
        await call(method, params, artifactSession); }, async evaluate(expression, frame = false) { let contextId; if (frame && !artifactSession) {
        const tree = await call('Page.getFrameTree');
        contextId = contexts.get(tree.frameTree.childFrames?.find(c => c.frame.name === 'artifact')?.frame.id);
        if (!contextId)
            throw new Error('iframe context unavailable');
    } const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...contextId ? { contextId } : {} }, frame ? artifactSession : undefined); if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; } }; }
// Font sizes under 13px of every text the user can see inside the given scopes: text nodes, generated content, form fields.
const SMALL_TEXT = '(selector=>{const out=[],small=(el,size,text)=>{if(size>0&&size<13)out.push([el.getAttribute("class")||el.tagName,text.slice(0,30),size])};for(const scope of document.querySelectorAll(selector)){const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode()){const el=n.parentElement;if(n.textContent.trim()&&el.checkVisibility())small(el,parseFloat(getComputedStyle(el).fontSize),n.textContent.trim())}for(const el of scope.querySelectorAll("*")){if(!el.checkVisibility())continue;for(const pseudo of ["::before","::after"]){const css=getComputedStyle(el,pseudo);if(css.display!=="none"&&css.content.length>2&&/^["\x27]/.test(css.content))small(el,parseFloat(css.fontSize),css.content)}if(el.matches("textarea,select,input:not([type=checkbox]):not([type=radio])"))small(el,parseFloat(getComputedStyle(el).fontSize),el.value||el.placeholder||"")}}return out})';
test('real upstream chrome has fixed UI, runtime outline, reliable drafts and native feedback', { timeout: 60000, skip: buildSkip || (!chrome && 'set LAVISH_MB_TEST_CHROME to a Chrome for Testing executable') }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-browser-'));
    let server, browser, client;
    try {
        const port = await freePort();
        const env = runtimeEnvironment({ ...process.env, ...isolatedEnvironment(dir), LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: path.join(dir, 'state'), LAVISH_AXI_IDLE_TIMEOUT_MS: '60000', LAVISH_AXI_TELEMETRY: 'off' }), driver = path.join(root, 'dist/cli.mjs');
        let serverErrors = '';
        // The server opens reviews itself; the fake opener records the launch instead of opening Chrome.
        const opened = path.join(dir, 'opened.jsonl');
        server = spawn(process.execPath, [builtServer, 'server', '--port', String(port)], { env: { ...env, NODE_OPTIONS: '--import=' + new URL('../test-helpers/fake-opener.mjs', import.meta.url).pathname, TEST_OPENED: opened }, stdio: ['ignore', 'pipe', 'pipe'] });
        server.stderr.on('data', d => serverErrors += d);
        await until(async () => { const r = await fetch('http://127.0.0.1:' + port + '/health'); return r.ok; }, 'server start ' + serverErrors);
        const input = { title: 'Intervista dummy', guide: 'Accoda una risposta; inviala dal pannello.', state: { revision: 1, answers: {}, comments: [] }, sections: [{ id: 'scelte', title: 'Le scelte', cards: Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i, title: 'Scelta ' + i, status: ['waiting','answered','info','blocked'][i % 4], metadata: 'Fonte: intervista', clarification: 'Chiarimento agente', paragraphs: [['Prima frase.', 'Seconda frase.'], ['Altro paragrafo.']], question: { options: [{ value: 'yes', label: 'Sì' }, { value: 'no', label: 'No' }] } })) }] };
        const file = path.join(dir, 'dummy.html');
        // A previous revision without q7 and with another q3 title: q7 is new, q3 changed (data-mb-new).
        const previous = await renderDocument({ ...input, sections: [{ ...input.sections[0], cards: input.sections[0].cards.slice(0, 7).map(card => card.id === 'q3' ? { ...card, title: 'Prima versione' } : card) }] });
        await writeFile(file, await renderDocument(input, { previous }));
        const create = await fetch('http://127.0.0.1:' + port + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, noGate: true }) });
        const session = await create.json();
        assert(create.ok, JSON.stringify(session));
        const profile = path.join(dir, 'chrome');
        let chromeErrors = '';
        browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
        browser.stderr.on('data', d => chromeErrors += d);
        const debugPort = await until(async () => Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'Chrome start ' + chromeErrors);
        const pages = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
        client = await cdp(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
        await client.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await client.call('Page.navigate', { url: session.url });
        await until(() => client.evaluate('document.querySelectorAll(".mb-rail button").length>=8'), 'outline handshake');
        const railLayout = () => client.evaluate('(()=>{const frame=document.querySelector(".frame").getBoundingClientRect(),rail=document.querySelector(".mb-rail").getBoundingClientRect(),panel=document.querySelector(".panel").getBoundingClientRect();return {frameRight:frame.right,railLeft:rail.left,railRight:rail.right,panelLeft:panel.left,viewport:innerWidth}})()');
        const expanded = await railLayout();
        assert(expanded.frameRight <= expanded.railLeft + .5 && Math.abs(expanded.railRight-expanded.panelLeft)<.5, JSON.stringify(expanded));
        const matchingCardColors = async () => {
            const cards = await client.evaluate('Array.from(document.querySelectorAll(".card")).map(el=>{const t=document.createElement("i");t.style.color=getComputedStyle(el).getPropertyValue("--mb-state-color").trim();document.body.append(t);const color=getComputedStyle(t).color;t.remove();return [el.id,color]})', true);
            const bars = await client.evaluate('Array.from(document.querySelectorAll(".mb-rail button")).map(el=>[el.dataset.target,getComputedStyle(el.querySelector("i")).backgroundColor])');
            assert.deepEqual(bars, cards, 'one matching-color bar per card');
            return bars;
        };
        const expandedColors = await matchingCardColors();
        const columnWidth = await client.evaluate('document.querySelector("main").getBoundingClientRect().width',true);
        assert.equal(columnWidth,907,'artifact column: min(907px, 100% - 40px)');
        assert.deepEqual(await client.evaluate('(()=>{const card=getComputedStyle(document.querySelector(".card")),body=getComputedStyle(document.body);return {font:body.fontSize,borderLeft:card.borderLeftWidth,borderLeftColor:card.borderLeftColor===card.borderTopColor,family:document.documentElement.dataset.mbFamily.length>0}})()',true),{font:'19px',borderLeft:'1px',borderLeftColor:true,family:true});
        assert.equal(await client.evaluate('document.documentElement.dataset.mbMode',true),'dark','browsers default to the dark mode');
        assert.equal(await client.evaluate('getComputedStyle(document.body,"::before").backgroundColor',true),'rgb(31, 32, 35)');
        // Minimap as in the approved mock-up (cornice.html): 4px lines, 12px long, current 22px, 22px rows 9px apart.
        assert.deepEqual(await client.evaluate('[document.querySelector(".mb-rail button:not(.current):not(.mb-closed) i").getBoundingClientRect().width,document.querySelector(".mb-rail .current i").getBoundingClientRect().width,document.querySelector(".mb-rail i").getBoundingClientRect().height]'),[12,22,4]);
        assert.equal(await client.evaluate('(()=>{const [a,b]=document.querySelectorAll(".mb-rail button");return b.getBoundingClientRect().top-a.getBoundingClientRect().top})()'),31);
        assert.equal(await client.evaluate('document.querySelector(".mb-position")'),null,'the minimap is the only cursor');
        // Frame from the approved mock-up: BRUVISH mark, labelless icon switches, closed cards hidden by default (q1 and q5 are answered and not new).
        assert.deepEqual(await client.evaluate('(()=>{const a=document.getElementById("annotation"),c=document.querySelector(".mb-closed-switch");return {brand:document.querySelector(".brand-mark").textContent,role:a.getAttribute("role"),checked:a.getAttribute("aria-checked"),label:a.textContent.trim(),closedShown:getComputedStyle(c).display!=="none",closedChecked:c.getAttribute("aria-checked"),dots:Array.from(document.querySelectorAll(".mb-rail .mb-closed")).map(b=>b.dataset.target),title:document.querySelector(".panel h2").textContent,font:getComputedStyle(document.querySelector(".bar")).fontFamily}})()'),{brand:'BRUVISH',role:'switch',checked:'true',label:'',closedShown:true,closedChecked:'false',dots:['q1','q5'],title:'Conversazione',font:'"Atkinson Hyperlegible Next", system-ui, sans-serif'});
        assert.deepEqual(await client.evaluate('["q1","q5","q0"].map(id=>getComputedStyle(document.getElementById(id)).display)',true),['none','none','block']);
        // Top left, the arrow back to the artifacts index: it leads to the catalog home of the same server.
        const index = await client.evaluate('(()=>{const a=document.querySelector(".bar .mb-index");return a&&{text:a.textContent,href:a.href,first:a===document.querySelector(".bar").firstElementChild,label:a.getAttribute("aria-label")}})()');
        assert.deepEqual(index, { text: '←', href: new URL('/', session.url).href, first: true, label: 'Indice degli artefatti' });
        assert.equal((await fetch(index.href)).headers.get('x-lavish-catalog'), '1', 'the arrow opens the catalog');
        await client.evaluate('document.querySelector(".mb-closed-switch").click()');
        await until(() => client.evaluate('getComputedStyle(document.getElementById("q1")).display==="block"', true), 'closed cards shown by the switch');
        await until(() => client.evaluate('document.querySelectorAll(".mb-rail .mb-closed").length===0'), 'no dots while the closed cards are shown');
        await client.evaluate('document.querySelector(".mb-closed-switch").click()');
        await until(() => client.evaluate('getComputedStyle(document.getElementById("q1")).display==="none"', true), 'closed cards hidden again');
        // A double tap of the right Option key toggles annotation mode, in the frame and inside the artifact.
        const altRight = async () => { for (const type of ['rawKeyDown', 'keyUp']) await client.call('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltRight', location: 2, windowsVirtualKeyCode: 18, modifiers: type === 'rawKeyDown' ? 1 : 0 }); };
        await client.evaluate('document.activeElement?.blur();document.body.focus()');
        await altRight(); await altRight();
        await until(() => client.evaluate('document.getElementById("annotation").getAttribute("aria-checked")==="false"'), 'double Option toggles annotation off');
        await client.evaluate('window.focus()', true);
        await altRight(); await altRight();
        await until(() => client.evaluate('document.getElementById("annotation").getAttribute("aria-checked")==="true"'), 'double Option inside the artifact toggles annotation on');
        assert.deepEqual(await client.evaluate('Array.from(document.querySelectorAll(".card[data-mb-new]")).map(el=>[el.id,el.dataset.mbNew])',true),[['q3','changed'],['q7','new']]);
        assert.deepEqual(await client.evaluate('Array.from(document.querySelectorAll(".mb-rail .mb-new")).map(el=>{const css=getComputedStyle(el.querySelector("i"));return [el.dataset.target,css.animationName,css.animationDuration]})'),[['q3','mb-rail-novelty','2s'],['q7','mb-rail-novelty','2s']]);
        const accent = await client.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--title").trim()',true);
        assert.equal(await client.evaluate('getComputedStyle(document.querySelector(".mb-rail")).getPropertyValue("--mb-accent").trim()'),accent,'focus ring in the theme accent');
        await writeFile(path.join(dir, 'opening.json'), JSON.stringify({ surface: 'app' }));
        const opener = spawn(process.execPath, [builtCli, 'open', file, '--no-gate'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let openError = '';
        opener.stderr.on('data', d => openError += d);
        assert.equal(await new Promise(r => opener.on('exit', r)), 0, openError);
        assert.deepEqual(JSON.parse(await readFile(opened, 'utf8')).args.slice(1), [session.url, await realpath(file)]);
        assert.deepEqual(await client.evaluate('[document.querySelector(".bar").getBoundingClientRect().height,document.querySelector(".panel").getBoundingClientRect().width]'), [30, 245]);
        assert.equal(await client.evaluate('document.documentElement.dataset.mbTheme', true), 'dark');
        assert.equal(await client.evaluate('document.querySelector("#q0 .context p").getClientRects().length', true), 0, 'collapsed context must not create a false layout overlap');
        if (process.env.LAVISH_MB_TEST_EVIDENCE_DIR) {
            const shot = await client.call('Page.captureScreenshot', { format: 'png' });
            await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR, 'dummy-dark.png'), Buffer.from(shot.data, 'base64'));
            const issues = await client.evaluate('Array.from(document.querySelectorAll(".warning-row")).map(row=>({title:row.querySelector(".warning-title")?.textContent,explanation:row.querySelector(".warning-explanation")?.textContent,selector:row.querySelector(".warning-target")?.textContent}))');
            for (const issue of issues) {
                issue.geometry = await client.evaluate('(()=>{const el=document.querySelector('+JSON.stringify(issue.selector)+');if(!el)return null;const rect=el.getBoundingClientRect(),css=getComputedStyle(el);return {tag:el.tagName,text:el.textContent.slice(0,160),x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,overflow:css.overflow,font:css.font,viewport:innerWidth,detailsOpen:el.closest("details")?.open,visible:el.checkVisibility?.()}})()', true);
            }
            await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR, 'layout-issues.json'), JSON.stringify(issues,null,2)+'\n');
        }
        assert.equal(await client.evaluate('document.querySelector(".mb-tools").hidden'), true, 'the floating panel stays hidden while it has nothing to say');
        assert.equal(await client.evaluate('document.querySelectorAll(".mb-tools button").length'), 1, 'theme and zoom buttons are gone');
        assert.deepEqual(await client.evaluate('[document.querySelector(".bar").getBoundingClientRect().height,document.querySelector(".panel").getBoundingClientRect().width]'), [30, 245]);
        for (const frame of [false, true]) {
            const before = await client.evaluate('Number(document.documentElement.style.zoom)', true);
            await client.evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"+",ctrlKey:true,bubbles:true,cancelable:true}))', frame);
            await until(() => client.evaluate('Number(document.documentElement.style.zoom)>' + before, true), 'shortcut zoom');
            await client.evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"0",metaKey:true,bubbles:true,cancelable:true}))', frame);
            await until(() => client.evaluate('document.documentElement.style.zoom==="1"', true), 'shortcut reset');
        }
        const switchDisplay = () => client.evaluate('getComputedStyle(document.querySelector(".mb-mode")).display', true);
        assert.notEqual(await switchDisplay(), 'none', 'the mode switch is shown on the computer');
        await client.emulate('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await until(async () => await client.evaluate('matchMedia("(pointer: coarse)").matches', true) && await switchDisplay() === 'none', 'switch hidden with a phone pointer');
        await client.emulate('Emulation.setTouchEmulationEnabled', { enabled: false });
        await until(async () => await switchDisplay() !== 'none', 'switch shown again on the computer');
        // The mode switch lives in the sandboxed artifact; the host page remembers the choice on the device.
        await client.evaluate('document.querySelector("[data-mb-mode-switch]").click()', true);
        await until(() => client.evaluate('localStorage.getItem("lavish-mb:mode")==="transparent"'), 'mode remembered by the host page');
        assert.deepEqual(await client.evaluate('[getComputedStyle(document.documentElement).backgroundColor,getComputedStyle(document.body).backgroundColor,document.querySelector("[data-mb-mode-switch]").getAttribute("aria-checked")]', true), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'true']);
        await until(async()=>{try{await matchingCardColors();return true;}catch{return false;}},'card colors in minimap after mode change');
        // Interview cards carry no free text field: notes go through the annotation tool. The draft is the choice.
        assert.equal(await client.evaluate('document.querySelectorAll("textarea,[data-mb-question] input:not([type=radio])").length', true), 0);
        const q0Choice = 'document.querySelector("[data-mb-question=q0] input:checked")?.value';
        await client.evaluate('const choice=document.querySelector("[data-mb-question=q0] input[value=yes]");choice.checked=true;choice.dispatchEvent(new Event("input",{bubbles:true}))', true);
        await until(() => client.evaluate('Object.values(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith("lavish-mb:v1:")))).some(v=>JSON.parse(v).fields?.["q0:choice"]?.value==="yes")'), 'draft persisted');
        await client.call('Page.reload');
        await until(async () => await client.evaluate(q0Choice, true) === 'yes', 'draft restored after reload');
        await until(() => client.evaluate('document.documentElement.dataset.mbMode==="transparent"', true), 'mode restored after reload');
        input.state.answers.q0 = { choice: 'no' };
        input.state.revision = 2;
        await writeFile(file, await renderDocument(input));
        await until(() => client.evaluate('document.documentElement.dataset.mbStateVersion==="2"', true), 'live reload');
        assert.equal(await client.evaluate(q0Choice, true), 'no', 'a conflicting radio draft must not replace a new canonical choice');
        await until(() => client.evaluate('!document.querySelectorAll(".mb-tools button")[0].hidden'), 'conflict visible');
        await client.evaluate('document.querySelectorAll(".mb-tools button")[0].click()');
        assert.equal(await client.evaluate('document.querySelector(".mb-conflict-dialog [data-field=\\"q0:choice\\"] pre")?.textContent'), 'yes');
        await client.evaluate('document.querySelector(".mb-conflict-dialog [data-field=\\"q0:choice\\"] button").click()');
        await until(async () => await client.evaluate(q0Choice, true) === 'yes', 'explicit draft restoration');
        await client.evaluate('document.querySelector(".mb-conflict-dialog > button")?.click()');
        await client.evaluate('document.getElementById("sidebarToggle").click()');
        assert.equal(await client.evaluate('document.body.classList.contains("panel-collapsed")'), true);
        assert.equal(await client.evaluate('document.querySelectorAll(".mb-rail button").length'), 8);
        const collapsed = await railLayout();
        assert(collapsed.frameRight <= collapsed.railLeft + .5 && Math.abs(collapsed.railRight-collapsed.viewport)<.5, JSON.stringify(collapsed));
        await until(async()=>{try{await matchingCardColors();return true;}catch{return false;}},'card colors after reload and collapse');
        if (process.env.LAVISH_MB_TEST_EVIDENCE_DIR) {
            const shot = await client.call('Page.captureScreenshot',{format:'png'});
            await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'minimap-collapsed.png'),Buffer.from(shot.data,'base64'));
            await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR,'minimap-geometry.json'),JSON.stringify({columnWidth,expanded,collapsed,expandedColors,collapsedColors:await matchingCardColors()},null,2)+'\n');
        }
        await client.evaluate('document.querySelector(".mb-rail [data-target=q7]").click()');
        await until(() => client.evaluate('scrollY>1000', true), 'outline scroll');
        await until(() => client.evaluate('document.querySelector(".mb-rail .current")?.dataset.target==="q7"'), 'outline position');
        // The minimap is the only cursor: no native scrollbar in the artifact nor on the minimap, yet the page still scrolls by keys and wheel.
        assert.deepEqual(await client.evaluate('[getComputedStyle(document.documentElement).scrollbarWidth,innerWidth-document.documentElement.clientWidth,matchMedia("(pointer: fine)").matches]', true), ['none', 0, true]);
        assert.equal(await client.evaluate('getComputedStyle(document.querySelector(".mb-rail")).scrollbarWidth'), 'none');
        await client.evaluate('window.focus()', true);
        await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        await until(() => client.evaluate('scrollY===0', true), 'keyboard scroll without scrollbar');
        const frameCenter = await client.evaluate('(()=>{const r=document.querySelector(".frame").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
        await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...frameCenter, deltaX: 0, deltaY: 600 });
        await until(() => client.evaluate('scrollY>0', true), 'wheel scroll without scrollbar');
        const reply = spawn(process.execPath, [driver, 'reply', file, '--agent-reply', '## Titolo\n\n**Risposta** con colori'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let replyErr = '';
        reply.stderr.on('data', d => replyErr += d);
        assert.equal(await new Promise(r => reply.on('exit', r)), 0, replyErr);
        await until(() => client.evaluate('!document.body.classList.contains("panel-collapsed")'), 'reply opens panel');
        await client.evaluate('document.querySelector("[data-mb-question=q0]").requestSubmit()', true);
        await until(() => client.evaluate('!document.getElementById("send").disabled'), 'native queue');
        const poll = spawn(process.execPath, [driver, 'poll', file, '--timeout-ms', '5000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let feedback = '';
        poll.stdout.on('data', d => feedback += d);
        await client.evaluate('document.getElementById("send").click()');
        assert.equal(await new Promise(r => poll.on('exit', r)), 0);
        assert(/choice\W+yes/.test(feedback), feedback);
        assert(feedback.includes('q0'), feedback);
        // Frame style of the approved mock-up as the browser computes it: agent replies inline without a bubble,
        // the reader's messages on a very light green, the restyled frame text never under 13px.
        await until(() => client.evaluate('document.querySelector(".bubble.user")!==null&&document.querySelector(".bubble.agent .chat-md")!==null'), 'reader and agent messages in the conversation');
        const conversation = await client.evaluate('(()=>{const agent=getComputedStyle(document.querySelector(".bubble.agent")),user=getComputedStyle(document.querySelector(".bubble.user")),green=c=>{const n=c.match(/[0-9.]+/g).map(Number);return n[1]>n[0]&&n[1]>n[2]&&(n.length<4||n[3]>0)};return {agentBorder:agent.borderTopWidth,agentBackground:agent.backgroundColor,userBorders:[user.borderTopWidth,user.borderRightWidth,user.borderBottomWidth],userRule:parseFloat(user.borderLeftWidth)>0&&green(user.borderLeftColor),userGreen:green(user.backgroundColor)}})()');
        assert.deepEqual(conversation, { agentBorder: '0px', agentBackground: 'rgba(0, 0, 0, 0)', userBorders: ['0px', '0px', '0px'], userRule: true, userGreen: true }, JSON.stringify(conversation));
        assert.deepEqual(await client.evaluate(SMALL_TEXT + '(".bar,.panel")'), [], 'no frame text under 13px');
        await client.evaluate('document.getElementById("moreButton").click()');
        await until(() => client.evaluate('!document.getElementById("moreMenu").hidden'), 'more menu open');
        assert.deepEqual(await client.evaluate(SMALL_TEXT + '("#moreMenu")'), [], 'no menu text under 13px');
        await client.evaluate('document.getElementById("moreButton").click()');
        // A first tap on an answer arms it, outlined in the theme accent of the page.
        await client.evaluate('document.querySelector("[data-mb-question=q4] input[value=yes]").click()', true);
        assert.deepEqual(await client.evaluate('(()=>{const label=document.querySelector("[data-mb-question=q4] input[value=yes]").closest("label"),t=document.createElement("i");t.style.color="var(--title)";document.body.append(t);const accent=getComputedStyle(t).color;t.remove();return [label.classList.contains("mb-armed"),getComputedStyle(label).borderTopColor===accent]})()', true), [true, true], 'armed answer in the accent');
        assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
    }
    finally {
        client?.close();
        browser?.kill('SIGTERM');
        server?.kill('SIGTERM');
        await delay(250);
        await rm(dir, { recursive: true, force: true });
    }
});
