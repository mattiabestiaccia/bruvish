import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { runtimeEnvironment } from '../lib/env.mjs';
import { isolatedEnvironment, sourceCli, sourceServer } from '../test-helpers/runtime.mjs';

const run = promisify(execFile);
const cli = sourceCli;
async function freePort() {
    const s = net.createServer(); await new Promise((r, j) => s.listen(0, '127.0.0.1', r).once('error', j));
    const port = s.address().port; await new Promise(r => s.close(r)); return port;
}
async function until(fn) {
    for (let i = 0; i < 80; i++) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw new Error('Fixture server did not start');
}

const fakeOpener = new URL('../test-helpers/fake-opener.mjs', import.meta.url).pathname;
const sandbox = new URL('../test-helpers/sandbox.mjs', import.meta.url).pathname;

test('public CLI emits a remote URL verified by the server, which opens the localhost review; remote command is read-only', { timeout: 90000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-remote-cli-'));
    let server, websocket;
    try {
        const port = await freePort(), state = path.join(dir, 'state'), config = path.join(dir, 'remote.json');
        const local = 'http://127.0.0.1:' + port, remote = 'https://fixture.test.ts.net:8443';
        await writeFile(config, JSON.stringify({origin: remote, localPort: port, stateDirectory: state}));
        const env = runtimeEnvironment({...process.env, ...isolatedEnvironment(dir), LAVISH_MB_REMOTE_CONFIG: config,
            LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: state, LAVISH_AXI_TELEMETRY: 'off'});
        // Replace only the remote transport boundary of the server, which verifies the phone link now.
        // Real upstream HTTP routes, Host/Origin validation and CLI output run unchanged; TLS is a live
        // rollout check. While the `offline` file exists, the proxy is unreachable.
        const transport = path.join(dir, 'proxy-transport.mjs'), offline = path.join(dir, 'offline');
        await writeFile(transport, `import {existsSync} from 'node:fs'; const original = globalThis.fetch; globalThis.fetch = (url, options={}) => {
            if (String(url).startsWith(${JSON.stringify(remote)})) return existsSync(${JSON.stringify(offline)}) ? Promise.reject(new Error('Fixture proxy offline')) : original(${JSON.stringify(local)} + String(url).slice(${remote.length}), {
                ...options, headers: {...options.headers, host: 'fixture.test.ts.net:8443', 'x-forwarded-host': 'fixture.test.ts.net:8443', 'x-forwarded-proto': 'https'}
            }); return original(url, options);
        };`);
        const opened = path.join(dir, 'opened.jsonl');
        server = spawn(process.execPath, [sourceServer, 'server', '--port', String(port)], {env: {...env, NODE_OPTIONS: `--import=${transport} --import=${fakeOpener}`, TEST_OPENED: opened}, stdio: ['ignore', 'ignore', 'pipe']});
        await until(async () => (await fetch(local + '/health')).ok);
        // The CLI runs as in an agent sandbox: loopback only, no program launches.
        const sandboxLog = path.join(dir, 'sandbox.jsonl');
        const childEnv = {...env, NODE_OPTIONS: '--import=' + sandbox, TEST_SANDBOX_LOG: sandboxLog};
        const file = path.join(dir, 'dummy.html');
        await writeFile(file, '<!doctype html><html><head><title>Remote fixture</title></head><body style="background:#222;color:#fff">Remote fixture</body></html>');
        const created = await run(process.execPath, [cli, file, '--no-open', '--no-gate'], {env: childEnv});
        const localUrl = created.stdout.match(/http:\/\/127\.0\.0\.1:\d+\/session\/[^\s"<>]+/)?.[0];
        assert(localUrl, created.stdout);
        const remoteUrl = remote + new URL(localUrl).pathname + new URL(localUrl).search;
        assert.match(created.stdout, /remote:\s+status: ready/);
        assert(created.stdout.includes(remoteUrl), created.stdout);
        assert(created.stdout.includes('catalog_url: "' + remote + '/"'), created.stdout);
        // The upstream sentence stays; the Bruvish prefix before it allows the one visible presentation.
        const nextStep = created.stdout.slice(created.stdout.indexOf('next_step:'));
        assert(nextStep.indexOf('Bruvish presentation: after this command completes successfully') < nextStep.indexOf('Do not respond to the user just yet'), created.stdout);
        assert(nextStep.includes('review question'), created.stdout);
        assert(nextStep.includes('exact remote.url above'), created.stdout);
        assert(nextStep.includes('does not finalize the turn'), created.stdout);
        assert(created.stdout.indexOf('remote:') < created.stdout.indexOf('next_step:'), 'the remote block comes before next_step');
        assert(created.stdout.includes('Do not pass --timeout-ms during normal agent use'), 'upstream poll restrictions remain');
        assert(created.stdout.includes('If the user ends the session, stop polling'), 'upstream end semantics remain');
        const before = await readFile(path.join(state, 'state.json'));
        const viewed = await run(process.execPath, [cli, 'remote', localUrl], {env: childEnv});
        assert(viewed.stdout.includes(remoteUrl), viewed.stdout);
        assert.deepEqual(await readFile(path.join(state, 'state.json')), before, 'remote lookup must not recreate or reopen the session');
        await writeFile(path.join(dir, 'opening.json'), JSON.stringify({surface: 'app'}));
        const openedResult = await run(process.execPath, [cli, file, '--no-gate'], {env: childEnv});
        assert(openedResult.stdout.includes(remoteUrl));
        // The app opener receives the local URL and the canonical path that upstream registered.
        const [launch] = (await readFile(opened, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(launch.args.slice(1), [localUrl, await realpath(file)]);

        const key = new URL(localUrl).pathname.split('/').pop();
        const headers = {host: 'fixture.test.ts.net:8443', 'x-forwarded-host': 'fixture.test.ts.net:8443',
            'x-forwarded-proto': 'https', origin: remote, 'content-type': 'application/json'};
        const promptBody = JSON.stringify({prompts: [{prompt: 'Fixture phone feedback', text: 'Fixture phone feedback', tag: 'test'}]});
        const rejected = await fetch(local + '/api/' + key + '/prompts', {method: 'POST', headers: {...headers, origin: 'https://foreign.test'}, body: promptBody});
        assert.equal(rejected.status, 403, 'foreign Origin must stay rejected behind the proxy');
        const rejectedHost = await fetch(local + '/health', {headers: {...headers, host: 'foreign.test', 'x-forwarded-host': 'foreign.test'}});
        assert.equal(rejectedHost.status, 403);
        const accepted = await fetch(local + '/api/' + key + '/prompts', {method: 'POST', headers, body: promptBody});
        assert.equal(accepted.status, 200, await accepted.text());
        const feedback = await run(process.execPath, [cli, 'poll', file, '--timeout-ms', '2000'], {env: childEnv});
        assert(feedback.stdout.includes('Fixture phone feedback'), feedback.stdout);
        const events = await fetch(local + '/events/' + key, {headers});
        assert.equal(events.status, 200);
        assert.match(events.headers.get('content-type'), /text\/event-stream/);
        assert.match(await events.text(), /chrome-reload/);

        websocket = new WebSocket(local.replace('http:', 'ws:') + '/events/' + key, {headers});
        await new Promise((resolve, reject) => {websocket.once('open', resolve); websocket.once('error', reject);});
        // The reply below runs the CLI from source: under the full parallel suite it can take seconds.
        const pushedReply = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('WebSocket reply event missing')), 20000);
            websocket.on('message', data => { const message = JSON.parse(data); if (message.type === 'agent-reply') { clearTimeout(timer); resolve(message); } });
        });
        await run(process.execPath, [cli, 'reply', file, '--agent-reply', 'Fixture agent receipt'], {env: childEnv});
        assert(JSON.stringify(await pushedReply).includes('Fixture agent receipt'));

        // An unavailable proxy does not turn local session creation into a failure.
        await writeFile(offline, '');
        const unavailable = await run(process.execPath, [cli, file, '--no-open', '--no-gate'], {env: childEnv});
        await rm(offline);
        assert(unavailable.stdout.includes(localUrl));
        assert.match(unavailable.stdout, /remote:\s+status: unavailable/);
        assert(!unavailable.stdout.includes(remoteUrl), 'offline remote link must not be advertised');
        assert(unavailable.stdout.includes('remote.reason above'), unavailable.stdout);
        assert(unavailable.stdout.includes('do not invent a phone link'), unavailable.stdout);
        assert(unavailable.stdout.includes('does not finalize the turn'), unavailable.stdout);

        const otherFile = path.join(dir, 'other.html');
        await writeFile(otherFile, await readFile(file));
        await run(process.execPath, [cli, otherFile, '--no-open', '--no-gate'], {env: childEnv});
        const ended = await fetch(local + '/api/' + key + '/end', {method: 'POST', headers, body: '{}'});
        assert.equal(ended.status, 200);
        const endedState = await readFile(path.join(state, 'state.json'));
        const endedLookup = await run(process.execPath, [cli, 'remote', localUrl], {env: childEnv});
        assert(endedLookup.stdout.includes(remoteUrl));
        assert.deepEqual(await readFile(path.join(state, 'state.json')), endedState, 'remote lookup must leave a user-ended review ended');
        const refusedOpen = await run(process.execPath, [cli, file, '--no-open'], {env: childEnv});
        assert.match(refusedOpen.stdout, /status: user-ended/);
        assert(!refusedOpen.stdout.includes('remote:'), 'creation refusal must not advertise a new remote opening');
        assert(!refusedOpen.stdout.includes('Bruvish presentation'), 'user-ended output must not start a new review loop');
        assert.equal(await readFile(sandboxLog, 'utf8').catch(() => ''), '', 'the CLI reached only loopback and launched nothing');
    } finally {
        websocket?.terminate();
        if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
        await rm(dir, {recursive: true, force: true});
    }
});
