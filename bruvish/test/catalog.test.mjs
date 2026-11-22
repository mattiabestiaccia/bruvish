import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, realpath, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runtimeEnvironment} from '../lib/env.mjs';
import {isolatedEnvironment, sourceServer} from '../test-helpers/runtime.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  let last;
  for (let n = 0; n < 100; n++) {
    try { if (last = await fn()) return last; } catch (error) { last = error.message; }
    await delay(50);
  }
  throw Error(message + ': ' + JSON.stringify(last));
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lavish-catalog-'));
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`, state = path.join(directory, 'state');
  const env = runtimeEnvironment({...process.env, ...isolatedEnvironment(directory), LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: state,
    LAVISH_AXI_TELEMETRY: 'off', LAVISH_AXI_IDLE_TIMEOUT_MS: '60000'});
  const server = spawn(process.execPath, [sourceServer, 'server', '--port', String(port)], {env, stdio: 'ignore'});
  await until(async () => (await fetch(origin + '/health')).ok, 'fixture server starts');
  async function register(name) {
    const file = path.join(directory, name + '.html');
    await writeFile(file, '<!doctype html><html><head><title>Catalog fixture</title></head><body>Catalog fixture</body></html>');
    const response = await fetch(origin + '/api/sessions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({file, noGate: true})});
    assert.equal(response.status, 200);
    return {...await response.json(), file};
  }
  return {directory, origin, state, env, register, async close() {
    if (server.exitCode === null) {server.kill('SIGTERM');await new Promise(resolve => server.once('exit', resolve));}
    await rm(directory, {recursive: true, force: true});
  }};
}

test('the root lists registered artifacts without reopening reviews or exposing local paths', {timeout: 30000}, async () => {
  const f = await fixture();
  try {
    const first = await f.register('Prima scelta'), closed = await f.register('Conclusa'), missing = await f.register('Mancante');
    const unsafe = await f.register('<img src=x onerror=alert(1)>');
    await fetch(f.origin + '/api/' + closed.key + '/end', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    await rm(missing.file);
    const before = await readFile(path.join(f.state, 'state.json'));
    const response = await fetch(f.origin + '/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /I tuoi Lavish/, 'the saved root URL must contain the catalog');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert(html.includes('href="/session/' + first.key + '"'));
    assert(html.includes('href="/session/' + closed.key + '"'), 'ended reviews can be consulted without reopening');
    assert(!html.includes('href="/session/' + missing.key + '"'), 'missing files cannot be opened');
    assert(html.includes('File non disponibile'));
    assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(!html.includes('<img src=x onerror=alert(1)>'));
    assert(!html.includes(f.directory), 'the remote catalog does not disclose absolute paths');
    assert(html.indexOf('/session/' + unsafe.key) < html.indexOf('/session/' + first.key), 'recent entries come first');
    assert.deepEqual(await readFile(path.join(f.state, 'state.json')), before, 'catalog navigation is read-only');
    const closedView = await fetch(f.origin + '/session/' + closed.key);
    assert.equal(closedView.status, 200);
    assert.deepEqual(await readFile(path.join(f.state, 'state.json')), before, 'consulting a user-ended review does not reopen it');
    const foreignStatus = await new Promise((resolve, reject) => {
      http.get(f.origin + '/', {headers: {host: 'foreign.test'}}, response => {
        response.resume();resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(foreignStatus, 403, 'the catalog stays behind the existing Host boundary');
    await writeFile(path.join(f.state, 'state.json'), '{invalid');
    const unavailable = await fetch(f.origin + '/');
    assert.equal(unavailable.status, 503, 'a broken catalog is not reported as an empty list');
    assert.equal(unavailable.headers.get('x-lavish-catalog'), null);
    assert(!(await unavailable.text()).includes(f.directory));
    await writeFile(path.join(f.state, 'state.json'), before);
  } finally {await f.close();}
});

test('local metadata is monotonic and web catalog mirrors organization without exposing agent session IDs', {timeout: 30000}, async () => {
  const f = await fixture();
  try {
    const review = await f.register('Taccuino di esempio');
    const headers = {'content-type':'application/json','x-bruvish-control':'1'};
    const metadata = {agent:'Pi',profile:'pib',sessionId:'private-agent-session',workedAt:'2026-11-20T09:20:00Z'};
    const record = (value,extra = {}) => fetch(f.origin + '/mb/metadata',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({session:review.key,metadata:value})});
    assert.equal((await record(metadata,{origin:'https://example.invalid'})).status,403);
    assert.equal((await record(metadata,{'x-forwarded-for':'100.101.102.103'})).status,403);
    assert.equal((await record({...metadata, workedAt:'2026-02-30T09:20:00Z'})).status,400);
    assert.equal((await record({...metadata, workedAt:new Date(Date.now() + 60 * 60_000).toISOString()})).status,400);
    const cli = fileURLToPath(new URL('../bin/lavish-axi.js', import.meta.url));
    const argv = ['metadata', `${f.origin}/session/${review.key}`, '--agent', metadata.agent, '--profile', metadata.profile, '--session-id', metadata.sessionId, '--worked-at', metadata.workedAt];
    const result = await promisify(execFile)(process.execPath,[cli,...argv],{env:f.env});
    assert.equal(JSON.parse(result.stdout).status,'updated');
    assert.equal((await (await record(metadata)).json()).status,'unchanged');
    assert.equal((await (await record({...metadata, workedAt:'2026-11-19T09:20:00Z'})).json()).status,'unchanged');
    const saved = JSON.parse(await readFile(path.join(f.state,'catalog-metadata',review.key + '.json'),'utf8'));
    assert.equal(saved.sessionId,metadata.sessionId);
    const appDir = path.join(f.directory,'app'), folder = '00000000-0000-4000-8000-000000000000';
    const canonical = await realpath(review.file);
    await mkdir(appDir);
    await writeFile(path.join(appDir,'preferences.json'),'{');
    const degraded = await fetch(f.origin + '/');
    assert.equal(degraded.status,200);assert.equal(degraded.headers.get('x-lavish-catalog'),'1');
    assert.match(await degraded.text(),/Taccuino di esempio/);
    await writeFile(path.join(appDir,'preferences.json'),JSON.stringify({artifacts:{[canonical]:{favorite:true,pinned:true}}}));
    await writeFile(path.join(appDir,'catalog-organization.json'),JSON.stringify({folders:[{id:folder,name:'Prove'}],folderAssignments:{[canonical]:folder}}));
    const html = await (await fetch(f.origin + '/')).text();
    assert.match(html,/Fissati in alto/);assert.match(html,/>Prove</);assert.match(html,/Ultimo profilo: pib/);
    assert(!html.includes(metadata.sessionId));assert(!html.includes(canonical));
  } finally {await f.close();}
});

async function connectPage(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  let sequence = 0;
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true});socket.addEventListener('error', reject, {once: true});});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (!message.id) return;
    const entry = pending.get(message.id);if (!entry) return;
    clearTimeout(entry.timer);pending.delete(message.id);
    message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  });
  socket.addEventListener('close', () => {for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(Error('Browser disconnected'));}pending.clear();});
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id);reject(Error('CDP timeout: ' + method));}, 8000);
    pending.set(id, {resolve, reject, timer});socket.send(JSON.stringify({id, method, params}));
  });
  await call('Page.enable');await call('Runtime.enable');
  return {call, errors, close: () => socket.close(), async evaluate(expression) {
    const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }};
}

test('a phone browser searches the catalog, sees fresh entries and consults ended reviews read-only', {timeout: 45000, skip: !process.env.LAVISH_MB_TEST_CHROME && 'set LAVISH_MB_TEST_CHROME to a Chrome for Testing executable'}, async () => {
  const f = await fixture();let browser, page;
  try {
    await f.register('Prova Pixel — una scelta da rivedere insieme');
    const closed = await f.register('Decisioni concluse'), missing = await f.register('Vecchia prova');
    await fetch(f.origin + '/api/' + closed.key + '/end', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    await rm(missing.file);
    const chrome = process.env.LAVISH_MB_TEST_CHROME;
    const profile = path.join(f.directory, 'browser');
    browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', 'about:blank'], {stdio: 'ignore'});
    const port = await until(async () => Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'browser starts');
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    page = await connectPage(pages.find(item => item.type === 'page').webSocketDebuggerUrl);
    await page.call('Emulation.setDeviceMetricsOverride', {width: 393, height: 852, deviceScaleFactor: 1, mobile: true});
    await page.call('Page.navigate', {url: f.origin + '/'});
    await until(() => page.evaluate('document.querySelectorAll(".review").length===3'), 'catalog shown');
    await page.evaluate('document.fonts.ready');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal scrolling on phone');
    assert.equal(await page.evaluate('document.querySelectorAll(".missing a").length'), 0);
    assert(await page.evaluate('Array.from(document.querySelectorAll(".review a")).every(a=>new URL(a.href).origin===location.origin)'));
    assert(await page.evaluate('Array.from(document.querySelectorAll(".review a")).every(a=>a.getBoundingClientRect().height>=44)'));
    assert.equal(await page.evaluate('getComputedStyle(document.documentElement).colorScheme'), 'dark');
    await page.evaluate('document.getElementById("search").value="pixel";document.getElementById("search").dispatchEvent(new Event("input"))');
    assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".review:not([hidden]) h2")).map(el=>el.textContent)'), ['Prova Pixel — una scelta da rivedere insieme']);
    await page.evaluate('document.getElementById("search").value="";document.getElementById("search").dispatchEvent(new Event("input"));[...document.querySelectorAll("[data-filter]")].find(b=>b.dataset.filter==="ended").click()');
    assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".review:not([hidden]) h2")).map(el=>el.textContent)'), ['Decisioni concluse']);
    await f.register('Un nuovo Lavish pronto');
    await page.evaluate('document.querySelector(".refresh").click()');
    await until(() => page.evaluate('document.querySelectorAll(".review").length===4'), 'refresh discovers new artifacts');
    if (process.env.LAVISH_MB_TEST_EVIDENCE_DIR) {
      const {mkdir} = await import('node:fs/promises');
      await mkdir(process.env.LAVISH_MB_TEST_EVIDENCE_DIR, {recursive: true});
      const shot = await page.call('Page.captureScreenshot', {format: 'png'});
      await writeFile(path.join(process.env.LAVISH_MB_TEST_EVIDENCE_DIR, 'mobile-catalog.png'), Buffer.from(shot.data, 'base64'));
    }
    await page.evaluate('document.querySelector(".ended a").click()');
    await until(() => page.evaluate('document.getElementById("endedOverlay")?.hidden===false'), 'ended review remains read-only');
    assert.equal(await page.evaluate('document.getElementById("send").disabled'), true);
    const persisted = JSON.parse(await readFile(path.join(f.state, 'state.json'), 'utf8')).sessions[closed.key];
    assert.equal(persisted.status, 'ended');assert.equal(persisted.ended_by, 'user');
    assert.equal(page.errors.length, 0, JSON.stringify(page.errors));
  } finally {
    page?.close();
    if (browser && browser.exitCode === null) {browser.kill('SIGTERM');await new Promise(resolve => browser.once('exit', resolve));}
    await f.close();
  }
});
