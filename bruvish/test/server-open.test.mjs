import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { registerBruvishRoutes } from '../lib/server.mjs';
import { requestOpening, requestRemote, sessionFromUrl } from '../lib/control-client.mjs';
import { runtimeEnvironment } from '../lib/env.mjs';
import { freePort, isolatedEnvironment, sourceCli, sourceServer, until } from '../test-helpers/runtime.mjs';

const run = promisify(execFile);
const KEY = '0123456789abcdef', ENDED = 'fedcba9876543210';
const fakeOpener = new URL('../test-helpers/fake-opener.mjs', import.meta.url).pathname;
const sandbox = new URL('../test-helpers/sandbox.mjs', import.meta.url).pathname;

// The Bruvish routes on a bare express app with the upstream JSON parser, a fixed store and
// recording replacements for the opening and the remote check: nothing opens, no network.
async function routes({ limits, now } = {}) {
    const opened = [], verified = [];
    const sessions = {
        [KEY]: { key: KEY, file: '/reviews/plan.html', url: `http://127.0.0.1:4388/session/${KEY}`, status: 'open' },
        [ENDED]: { key: ENDED, file: '/reviews/done.html', url: `http://127.0.0.1:4388/session/${ENDED}`, status: 'ended', ended_by: 'user' },
    };
    const app = express();
    app.use(express.json());
    const env = { LAVISH_BRUVISH: '1', LAVISH_AXI_PORT: '4388' };
    registerBruvishRoutes(app, { stateFile: '/nonexistent/state.json', version: 'test', chromeAssets: {}, env,
        store: { findByKey: async key => sessions[key] || null },
        control: {
            open: async (url, file, options) => { opened.push({ url, file, env: options.env }); return { status: 'opened' }; },
            verify: async (url, verifyEnv, identity) => { verified.push({ url, env: verifyEnv, identity }); return { status: 'ready', url: 'https://box.example.ts.net' + new URL(url).pathname + new URL(url).search, catalog_url: 'https://box.example.ts.net/' }; },
            ...(limits ? { limits } : {}), ...(now ? { now } : {}),
        } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, env, opened, verified, close: () => new Promise(resolve => server.close(resolve)) };
}

// fetch() always sends its own Host; raw requests choose every header. By default they send the
// CLI's control header; an undefined value leaves a header out.
function raw(base, method, route, { headers = {}, body } = {}) {
    const sent = Object.fromEntries(Object.entries({ host: new URL(base).host, 'x-bruvish-control': '1', ...headers }).filter(([, value]) => value !== undefined));
    return new Promise((resolve, reject) => {
        const request = http.request(base + route, { method, headers: sent }, response => {
            let text = '';
            response.on('data', data => text += data);
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, json: (() => { try { return JSON.parse(text); } catch { return text; } })() }));
        });
        request.once('error', reject);
        request.end(body);
    });
}
const postOpen = (base, payload, headers = {}) => raw(base, 'POST', '/mb/open', { headers: { 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

test('POST /mb/open opens only the stored session, by key, with the server environment', async () => {
    const r = await routes();
    try {
        const answer = await postOpen(r.base, { session: KEY });
        assert.equal(answer.status, 200, JSON.stringify(answer.json));
        assert.deepEqual(answer.json, { session: KEY, opening: { status: 'opened' } });
        assert.deepEqual(r.opened, [{ url: `http://127.0.0.1:4388/session/${KEY}`, file: '/reviews/plan.html', env: r.env }]);
        const gateless = await postOpen(r.base, { session: KEY, no_gate: true });
        assert.equal(gateless.status, 200);
        assert.equal(r.opened[1].url, `http://127.0.0.1:4388/session/${KEY}?no-gate=1`);
    } finally { await r.close(); }
});

test('POST /mb/open refuses extra fields, malformed keys and bodies, unknown and ended sessions', async () => {
    const r = await routes({ limits: { open: { limit: 100, windowMs: 60_000 }, remote: { limit: 100, windowMs: 60_000 } } });
    try {
        for (const payload of [
            { session: KEY, file: '/etc/passwd' }, { session: KEY, url: 'http://evil.test/' }, { session: KEY, command: '/bin/sh' },
            { session: KEY, adapter: '/tmp/adapter' }, { session: KEY, env: { LAVISH_MB_SURFACE: 'app' } }, { session: KEY, surface: 'app' },
            { session: KEY, no_gate: 'yes' }, { session: KEY.toUpperCase() }, { session: '../../etc/passwd' }, { session: KEY + '0' },
            { session: [KEY] }, {}, [KEY], 'null', '"' + KEY + '"',
        ]) {
            const answer = await postOpen(r.base, payload);
            assert.equal(answer.status, 400, JSON.stringify(payload));
            // A JSON body that is not an object or array is already refused by the strict JSON parser.
            if (typeof payload !== 'string') assert.equal(answer.json.code, 'INVALID_REQUEST');
        }
        const plain = await raw(r.base, 'POST', '/mb/open', { headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ session: KEY }) });
        assert.equal(plain.status, 400, 'only a JSON body is read');
        const unknown = await postOpen(r.base, { session: 'aaaaaaaaaaaaaaaa' });
        assert.equal(unknown.status, 404);
        assert.equal(unknown.json.code, 'UNKNOWN_SESSION');
        const ended = await postOpen(r.base, { session: ENDED });
        assert.equal(ended.status, 409);
        assert.deepEqual([ended.json.code, ended.json.ended_by], ['SESSION_ENDED', 'user']);
        assert.deepEqual(r.opened, [], 'nothing was opened');
    } finally { await r.close(); }
});

test('the control routes refuse web pages, proxied requests and other hosts', async () => {
    const r = await routes();
    try {
        const port = new URL(r.base).port;
        for (const headers of [
            { origin: 'https://evil.test' }, { origin: r.base }, { origin: 'null' }, { referer: r.base + '/session/' + KEY },
            { 'x-forwarded-host': 'box.example.ts.net' }, { 'x-forwarded-for': '100.64.0.2' }, { forwarded: 'for=100.64.0.2' },
            { 'tailscale-user-login': 'someone@example.com' }, { host: 'box.example.ts.net' }, { host: 'evil.test:' + port },
            // What an <img> or a form on a web page sends with referrerpolicy=no-referrer: no control header.
            { 'x-bruvish-control': undefined }, { 'x-bruvish-control': '0' },
        ]) {
            const open = await postOpen(r.base, { session: KEY }, headers);
            assert.equal(open.status, 403, JSON.stringify(headers));
            assert.equal(open.json.code, 'FORBIDDEN_CALLER');
            const remote = await raw(r.base, 'GET', '/mb/remote?session=' + KEY, { headers });
            assert.equal(remote.status, 403, JSON.stringify(headers));
        }
        for (const host of ['localhost:' + port, '[::1]:' + port]) assert.equal((await postOpen(r.base, { session: KEY }, { host })).status, 200, host);
        assert.equal(r.opened.length, 2);
        assert.equal(r.verified.length, 0);
    } finally { await r.close(); }
});

test('the control routes have a simple rate limit per route', async () => {
    let time = 1_000_000;
    const r = await routes({ limits: { open: { limit: 2, windowMs: 60_000 }, remote: { limit: 1, windowMs: 60_000 } }, now: () => time });
    try {
        assert.equal((await postOpen(r.base, { session: KEY })).status, 200);
        assert.equal((await postOpen(r.base, { session: 'aaaaaaaaaaaaaaaa' })).status, 404);
        assert.equal((await postOpen(r.base, { session: 'nope' })).status, 400);
        assert.equal((await postOpen(r.base, { session: KEY })).status, 200, 'refused calls are not charged');
        const limited = await postOpen(r.base, { session: KEY });
        assert.equal(limited.status, 429);
        assert.equal(limited.json.code, 'RATE_LIMITED');
        assert.equal(limited.headers['retry-after'], '60');
        assert.equal((await raw(r.base, 'GET', '/mb/remote?session=' + KEY)).status, 200, 'each route has its own budget');
        assert.equal((await raw(r.base, 'GET', '/mb/remote?session=' + KEY)).status, 429);
        time += 60_000;
        assert.equal((await postOpen(r.base, { session: KEY })).status, 200, 'the window moves on');
        assert.equal(r.opened.length, 3);
    } finally { await r.close(); }
});

test('header-less GET /mb/remote calls without a valid key cannot exhaust the remote budget', async () => {
    const r = await routes({ limits: { open: { limit: 1, windowMs: 60_000 }, remote: { limit: 1, windowMs: 60_000 } }, now: () => 1_000_000 });
    try {
        for (let i = 0; i < 20; i += 1) {
            for (const query of ['', 'session=nope', 'session=aaaaaaaaaaaaaaaa', `session=${KEY}&file=/etc/passwd`]) {
                const refused = await raw(r.base, 'GET', '/mb/remote?' + query);
                assert.notEqual(refused.status, 429, query);
            }
        }
        const legitimate = await raw(r.base, 'GET', '/mb/remote?session=' + KEY);
        assert.equal(legitimate.status, 200, JSON.stringify(legitimate.json));
        assert.equal(r.verified.length, 1);
    } finally { await r.close(); }
});

test('GET /mb/remote verifies the stored session URL, also for ended sessions, and opens nothing', async () => {
    const r = await routes();
    try {
        const answer = await raw(r.base, 'GET', '/mb/remote?session=' + KEY);
        assert.equal(answer.status, 200);
        assert.deepEqual(answer.json, { session: KEY, remote: { status: 'ready', url: `https://box.example.ts.net/session/${KEY}`, catalog_url: 'https://box.example.ts.net/' } });
        assert.deepEqual(r.verified[0], { url: `http://127.0.0.1:4388/session/${KEY}`, env: r.env, identity: r.verified[0].identity });
        assert.equal(typeof r.verified[0].identity, 'string');
        assert.equal((await raw(r.base, 'GET', `/mb/remote?session=${KEY}&no_gate=1`)).json.remote.url, `https://box.example.ts.net/session/${KEY}?no-gate=1`);
        assert.equal((await raw(r.base, 'GET', '/mb/remote?session=' + ENDED)).status, 200, 'read-only lookup of an ended review');
        for (const query of [`session=${KEY}&file=/etc/passwd`, `session=${KEY}&session=${KEY}`, `session=${KEY}&no_gate=true`, 'session=nope', '']) {
            const refused = await raw(r.base, 'GET', '/mb/remote?' + query);
            assert.equal(refused.status, 400, query);
        }
        assert.equal((await raw(r.base, 'GET', '/mb/remote?session=aaaaaaaaaaaaaaaa')).status, 404);
        assert.equal(r.opened.length, 0);
    } finally { await r.close(); }
});

test('outside the Bruvish runtime the control routes do not exist', async () => {
    const app = express();
    registerBruvishRoutes(app, { stateFile: '/nonexistent/state.json', version: 'test', chromeAssets: {}, env: {}, store: { findByKey: async () => { throw new Error('not reached'); } } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await postOpen(base, { session: KEY })).status, 404);
        assert.equal((await raw(base, 'GET', '/mb/remote?session=' + KEY)).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the CLI client refuses foreign session URLs and reports a missing or foreign server clearly', async () => {
    const env = { LAVISH_AXI_PORT: '4388' };
    assert.deepEqual(sessionFromUrl(`http://127.0.0.1:4388/session/${KEY}?no-gate=1`, env), { key: KEY, noGate: true });
    for (const url of [`http://127.0.0.1:4389/session/${KEY}`, `https://127.0.0.1:4388/session/${KEY}`, `http://evil.test:4388/session/${KEY}`,
        `http://127.0.0.1:4388/session/${KEY}/x`, `http://u:p@127.0.0.1:4388/session/${KEY}`, 'not a url']) assert.equal(sessionFromUrl(url, env), null, url);
    const closed = { LAVISH_AXI_PORT: String(await freePort()) };
    await assert.rejects(requestOpening(KEY, closed), /is not responding/);
    // An upstream Lavish server (or any other) answers the unknown route with its own 404 page.
    const foreign = http.createServer((_req, res) => { res.statusCode = 404; res.setHeader('content-type', 'text/html'); res.end('<pre>Cannot POST /mb/open</pre>'); });
    const port = await freePort();
    await new Promise(resolve => foreign.listen(port, '127.0.0.1', resolve));
    try {
        await assert.rejects(requestOpening(KEY, { LAVISH_AXI_PORT: String(port) }), /not this Bruvish build.*nothing was opened/);
        await assert.rejects(requestRemote(KEY, { LAVISH_AXI_PORT: String(port) }), /not this Bruvish build/);
    } finally { await new Promise(resolve => foreign.close(resolve)); }
});

// The whole path with a real server: the CLI runs as in an agent sandbox (it may not launch programs
// or reach anything but loopback) and the server records the surface launch instead of opening it.
test('open, the bare form and remote work from a sandboxed CLI; the server alone picks the surface', { timeout: 120000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-server-open-'));
    let server;
    try {
        const port = await freePort(), state = path.join(dir, 'state'), opened = path.join(dir, 'opened.jsonl'), log = path.join(dir, 'sandbox.jsonl');
        const base = 'http://127.0.0.1:' + port;
        await writeFile(path.join(dir, 'opening.json'), JSON.stringify({ surface: 'chrome' }));
        const env = runtimeEnvironment({ ...process.env, ...isolatedEnvironment(dir), LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: state });
        delete env.LAVISH_MB_SURFACE;
        server = spawn(process.execPath, [sourceServer, 'server', '--port', String(port)], { env: { ...env, NODE_OPTIONS: '--import=' + fakeOpener, TEST_OPENED: opened }, stdio: 'ignore' });
        await until(async () => (await fetch(base + '/health')).ok, 'server starts');
        // Caller-side overrides that the former in-process opening honored are now ignored.
        const cliEnv = { ...env, NODE_OPTIONS: '--import=' + sandbox, TEST_SANDBOX_LOG: log, LAVISH_MB_OPEN_ADAPTER: path.join(dir, 'adapter'), LAVISH_MB_SURFACE: 'app' };
        const launches = async () => (await readFile(opened, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
        const file = path.join(dir, 'review.html');
        await writeFile(file, '<!doctype html><html><head><title>Prova</title></head><body style="background:#222;color:#fff">Prova</body></html>');

        const first = await run(process.execPath, [sourceCli, 'open', file, '--no-gate'], { env: cliEnv });
        const url = first.stdout.match(/http:\/\/127\.0\.0\.1:\d+\/session\/[a-f0-9]{16}\?no-gate=1/)?.[0];
        assert(url, first.stdout);
        assert.match(first.stdout, /opening:\s+status: opened/);
        assert.match(first.stdout, /remote:\s+status: unavailable/, 'without remote configuration the phone link is unavailable');
        assert(first.stdout.indexOf('Bruvish presentation') < first.stdout.indexOf('Do not respond to the user just yet'), first.stdout);
        assert.deepEqual(await launches(), [{ command: '/usr/bin/open', args: ['-a', 'Google Chrome', url] }]);

        const bare = await run(process.execPath, [sourceCli, file], { env: cliEnv });
        assert.match(bare.stdout, /opening:\s+status: opened/);
        assert.equal((await launches())[1].args[2], url.replace('?no-gate=1', ''));

        // The server reads its own configuration at each request.
        await writeFile(path.join(dir, 'opening.json'), JSON.stringify({ surface: 'app' }));
        await run(process.execPath, [sourceCli, 'open', file], { env: { ...cliEnv, LAVISH_MB_SURFACE: 'chrome' } });
        const app = (await launches())[2];
        assert.equal(app.command, process.execPath);
        assert.match(app.args[0], /app[\\/]open\.mjs$/);
        assert.deepEqual(app.args.slice(1), [url.replace('?no-gate=1', ''), await realpath(file)]);

        // A second review stays open, so the server does not stop when the first one ends below.
        const other = path.join(dir, 'other.html');
        await writeFile(other, await readFile(file));
        await run(process.execPath, [sourceCli, other, '--no-open'], { env: cliEnv });
        assert.equal((await launches()).length, 3, '--no-open asks for no opening');

        const remote = await run(process.execPath, [sourceCli, 'remote', url], { env: cliEnv }).catch(error => error);
        assert.equal(remote.code, 1, 'an unavailable phone link is a failed check');
        assert.match(remote.stdout, /remote:\s+status: unavailable/);
        assert.match(remote.stdout, /Remote configuration is missing or invalid/);
        const foreignUrl = await run(process.execPath, [sourceCli, 'remote', 'http://127.0.0.1:1/session/0123456789abcdef'], { env: cliEnv }).catch(error => error);
        assert.equal(foreignUrl.code, 1);
        assert.match(foreignUrl.stderr, /Expected a session URL of the configured Bruvish service/);

        // A review the user ended stays closed without --reopen; with it, the server opens it again.
        const key = new URL(url).pathname.split('/').pop();
        const end = await fetch(base + '/api/' + key + '/end', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' });
        assert.equal(end.status, 200);
        const refused = await run(process.execPath, [sourceCli, file], { env: cliEnv });
        assert.match(refused.stdout, /status: user-ended/);
        assert.doesNotMatch(refused.stdout, /opening:/);
        const direct = await fetch(base + '/mb/open', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bruvish-control': '1' }, body: JSON.stringify({ session: key }) });
        assert.equal(direct.status, 409, 'the route itself never opens an ended session');
        assert.equal((await launches()).length, 3);
        const reopened = await run(process.execPath, [sourceCli, file, '--reopen'], { env: cliEnv });
        assert.match(reopened.stdout, /opening:\s+status: opened/);
        assert.equal((await launches()).length, 4);

        assert.equal(await readFile(log, 'utf8').catch(() => ''), '', 'the CLI launched no program and reached no other host');
    } finally {
        if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
        await rm(dir, { recursive: true, force: true });
    }
});

test('a failed opening is reported by the CLI with the server reason and exit status 1', { timeout: 60000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bruvish-server-open-fail-'));
    let server;
    try {
        const port = await freePort(), state = path.join(dir, 'state');
        const env = runtimeEnvironment({ ...process.env, ...isolatedEnvironment(dir), LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: state });
        server = spawn(process.execPath, [sourceServer, 'server', '--port', String(port)], { env: { ...env, NODE_OPTIONS: '--import=' + fakeOpener, TEST_OPENED: path.join(dir, 'opened.jsonl'), TEST_OPEN_EXIT: '1', TEST_OPEN_STDERR: 'fixture: window refused\n' }, stdio: 'ignore' });
        await until(async () => (await fetch('http://127.0.0.1:' + port + '/health')).ok, 'server starts');
        const file = path.join(dir, 'review.html');
        await writeFile(file, '<!doctype html><html><body>Prova</body></html>');
        const failed = await run(process.execPath, [sourceCli, file], { env }).catch(error => error);
        assert.equal(failed.code, 1);
        assert.match(failed.stdout, /opening:\s+status: failed/);
        assert.match(failed.stdout, /fixture: window refused/);
        assert.match(failed.stderr, /Bruvish opening failed: fixture: window refused/);
        assert.match(failed.stdout, /session:/, 'the session itself was created');
    } finally {
        if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
        await rm(dir, { recursive: true, force: true });
    }
});
