import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runtimeIdentity } from '../lib/identity.mjs';
import { assertCompatibleServer, discoverHealth, retrySlowServer, SlowServerError } from '../lib/runtime.mjs';
import { freePort, isolatedEnvironment, sourceCli } from '../test-helpers/runtime.mjs';

// The decision under test: only `open` retries, three attempts with fixed growing windows of
// 700, 1400 and 2800 ms, then an Italian "slow server" message naming the probe that timed out.
const IDENTITY = 'build-a';
const STATE = '/tmp/lavish-slow-test-state';
const LOOPBACK_URL = 'http://127.0.0.1:4388';
const runCli = promisify(execFile);

beforeEach(() => retrySlowServer(true));

// Every /health answer takes `delayHealth` ms, as on a machine under heavy load.
async function fakeServer({ delayHealth = 0, state = STATE, identity = IDENTITY } = {}) {
    const requests = [];
    const openedFiles = [];
    const open = new Set();
    const server = http.createServer(async (req, res) => {
        const endpoint = req.url.split('?')[0];
        requests.push(endpoint);
        res.setHeader('content-type', 'application/json');
        if (endpoint === '/health') {
            const body = JSON.stringify({
                ok: true, app: 'lavish-axi', version: '999.0.0', state_dir: state, hosts: ['127.0.0.1'],
            });
            const reply = setTimeout(() => res.end(body), delayHealth);
            res.once('close', () => clearTimeout(reply));
        } else if (endpoint === '/mb-info') {
            res.end(JSON.stringify({ identity }));
        } else if (req.method === 'POST' && endpoint === '/api/sessions') {
            let body = '';
            for await (const chunk of req) body += chunk;
            openedFiles.push(JSON.parse(body).file);
            res.end(JSON.stringify({
                status: 'opened',
                url: `http://127.0.0.1:${server.address().port}/session/0123456789abcdef`,
            }));
        } else {
            res.end(JSON.stringify({ status: 'unavailable', reason: 'Tailscale disattivata nella prova' }));
        }
    });
    server.on('connection', (socket) => { open.add(socket); socket.on('close', () => open.delete(socket)); });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    return {
        port: server.address().port,
        requests,
        openedFiles,
        close: () => new Promise((resolve) => { for (const socket of open) socket.destroy(); server.close(resolve); }),
    };
}

const HEALTH = { app: 'lavish-axi', state_dir: STATE };

// A stand-in for http.get. `handle(endpoint, call)` decides each request's fate: call.reply(body),
// call.refuse(error), call.cut(error) mid-body; doing nothing leaves it unanswered. An answer to a
// request the probe already gave up on (destroyed) is dropped, as on a closed socket.
function fakeGet(handle, requests = []) {
    return (url, options, callback) => {
        const request = new EventEmitter();
        let destroyed = false;
        request.destroy = () => { destroyed = true; };
        const endpoint = new URL(url).pathname;
        requests.push(endpoint);
        const respond = () => {
            const response = new PassThrough();
            response.statusCode = 200;
            callback(response);
            return response;
        };
        handle(endpoint, {
            reply: (body) => process.nextTick(() => { if (!destroyed) respond().end(JSON.stringify(body)); }),
            refuse: (error) => process.nextTick(() => request.emit('error', error)),
            cut: (error) => process.nextTick(() => {
                const response = respond();
                response.write('{"app":');
                process.nextTick(() => response.destroy(error));
            }),
        });
        return request;
    };
}

// /health answers arrive `delayMs` after each request, on the mocked clock; /mb-info at once.
const lateHealth = (delayMs, requests) => fakeGet((endpoint, call) => {
    if (endpoint === '/mb-info') call.reply({ identity: IDENTITY });
    else setTimeout(() => call.reply(HEALTH), delayMs);
}, requests);

const silent = (requests) => fakeGet(() => {}, requests);

async function advance(t, ...steps) {
    for (const ms of steps) {
        await setImmediate();
        t.mock.timers.tick(ms);
        await setImmediate();
    }
}

const environment = (port) => ({ LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: STATE });
const refusal = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4388'), { code: 'ECONNREFUSED' });
const counting = (counter) => (...args) => {
    counter.requests += 1;
    return http.get(...args);
};

test('open registers the session with a server whose every health answer takes 1 s', { timeout: 20000 }, async (t) => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const directory = await mkdtemp(path.join(root, '.bruvish-open-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'review.html');
    await writeFile(file, '<!doctype html><h1>Prova</h1>');
    const state = path.join(directory, 'state');
    const server = await fakeServer({ delayHealth: 1000, state, identity: runtimeIdentity() });
    t.after(server.close);
    await runCli(process.execPath, [sourceCli, 'open', file, '--no-open'], {
        timeout: 18000,
        env: {
            ...process.env,
            ...isolatedEnvironment(directory),
            LAVISH_AXI_PORT: String(server.port),
            LAVISH_AXI_STATE_DIR: state,
        },
    });
    // Every /health answer takes 1 s, past the old single 700 ms check, so the page is registered
    // only if open asked again; the build check reads /mb-info only after a later /health answered.
    assert.deepEqual(server.openedFiles, [await realpath(file)]);
    const firstInfo = server.requests.indexOf('/mb-info');
    assert.ok(firstInfo >= 2, JSON.stringify(server.requests));
    assert.ok(server.requests.slice(0, firstInfo).every((request) => request === '/health'), JSON.stringify(server.requests));
});

test('stop does not retry a slow server and says which check timed out', { timeout: 15000 }, async (t) => {
    const server = await fakeServer({ delayHealth: 1000 });
    t.after(server.close);
    const directory = await mkdtemp(path.join(fileURLToPath(new URL('../../', import.meta.url)), '.bruvish-stop-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await assert.rejects(
        runCli(process.execPath, [sourceCli, 'stop', '--port', String(server.port)], {
            timeout: 12000,
            env: { ...process.env, ...isolatedEnvironment(directory), LAVISH_AXI_STATE_DIR: STATE },
        }),
        (error) => {
            assert.match(error.stderr, /Il server Lavish risponde lentamente\. Il controllo \/health è scaduto dopo 1 tentativo/);
            return true;
        },
    );
    assert.deepEqual(server.requests, ['/health']);
});

for (const [delayMs, ticks, healthRequests] of [
    [1000, [700, 1000], 2],
    [2000, [700, 1400, 2000], 3],
]) {
    test(`a health answer after ${delayMs} ms is accepted on attempt ${healthRequests}`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const requests = [];
        const result = assertCompatibleServer(environment(4388), IDENTITY, { get: lateHealth(delayMs, requests) });
        await advance(t, ...ticks);
        await result;
        assert.deepEqual(requests, [...Array(healthRequests).fill('/health'), '/mb-info']);
    });
}

test('three unanswered health requests report a slow server in Italian', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, { get: silent(requests) }),
        (error) => {
            assert.ok(error instanceof SlowServerError);
            assert.equal(
                error.message,
                'Il server Lavish risponde lentamente. Il controllo /health è scaduto dopo 3 tentativi in 4,9 s. Riprova tra qualche secondo.',
            );
            return true;
        },
    );
    await advance(t, 700, 1400, 2800);
    await result;
    assert.deepEqual(requests, ['/health', '/health', '/health']);
});

test('an unanswered /mb-info is read once and named in the message', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            get: fakeGet((endpoint, call) => { if (endpoint === '/health') call.reply(HEALTH); }, requests),
        }),
        (error) => error instanceof SlowServerError && error.message.includes('Il controllo /mb-info è scaduto dopo 1 tentativo in 2,8 s'),
    );
    await advance(t, 0, 2800);
    await result;
    assert.deepEqual(requests, ['/health', '/mb-info']);
});

test('outside open a slow health check is not retried', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    retrySlowServer(false);
    const requests = [];
    const result = assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, { get: silent(requests) }),
        (error) => error instanceof SlowServerError && error.message.includes('dopo 1 tentativo in 0,7 s'),
    );
    await advance(t, 700);
    await result;
    assert.deepEqual(requests, ['/health']);
});

test('a compatible server answering at once gets one request per endpoint', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assertCompatibleServer(environment(server.port), IDENTITY);
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});

test('nothing listening returns after one connection attempt', async () => {
    const counter = { requests: 0 };
    await assertCompatibleServer(environment(await freePort()), IDENTITY, { get: counting(counter) });
    assert.equal(counter.requests, 1);
});

test('a port that closes after a health timeout means no server, so open can start its own', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = assertCompatibleServer(environment(4388), IDENTITY, {
        get: fakeGet((endpoint, call) => { if (requests.length > 1) call.refuse(refusal()); }, requests),
    });
    await advance(t, 700);
    assert.equal(await result, undefined);
    assert.deepEqual(requests, ['/health', '/health']);
});

test('a port that closes before /mb-info answers means no server', async () => {
    const requests = [];
    const result = await assertCompatibleServer(environment(4388), IDENTITY, {
        get: fakeGet((endpoint, call) => (endpoint === '/health' ? call.reply(HEALTH) : call.refuse(refusal())), requests),
    });
    assert.equal(result, undefined);
    assert.deepEqual(requests, ['/health', '/mb-info']);
});

for (const endpoint of ['/health', '/mb-info']) {
    test(`a ${endpoint} body cut off mid-read fails instead of being judged`, async () => {
        const cut = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        await assert.rejects(
            assertCompatibleServer(environment(4388), IDENTITY, {
                get: fakeGet((requested, call) => (requested === endpoint ? call.cut(cut) : call.reply(HEALTH))),
            }),
            (error) => error === cut,
        );
    });
}

test('an oversized health answer is refused, as upstream caps it at 256 KiB', async () => {
    await assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            get: fakeGet((endpoint, call) => call.reply({ ...HEALTH, padding: 'x'.repeat(300 * 1024) })),
        }),
        /Risposta troppo lunga/,
    );
});

test('a server from another build is refused without retrying', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assert.rejects(assertCompatibleServer(environment(server.port), 'other-build'), /another Bruvish build/);
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});

test('open discovery on loopback waits for a late health answer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = discoverHealth('127.0.0.1', LOOPBACK_URL, () => assert.fail('upstream probe used'), {
        get: lateHealth(1000, requests),
    });
    await advance(t, 700, 1000);
    assert.deepEqual(await result, HEALTH);
    assert.deepEqual(requests, ['/health', '/health']);
});

test('open discovery reports a loopback that never answers as slow', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = assert.rejects(
        discoverHealth('127.0.0.1', LOOPBACK_URL, () => null, { get: silent(requests) }),
        SlowServerError,
    );
    await advance(t, 700, 1400, 2800);
    await result;
    assert.equal(requests.length, 3);
});

test('open discovery takes a free loopback port as free after one attempt', async () => {
    const counter = { requests: 0 };
    const port = await freePort();
    const health = await discoverHealth('127.0.0.1', `http://127.0.0.1:${port}`, () => assert.fail('upstream probe used'), {
        get: counting(counter),
    });
    assert.equal(health, null);
    assert.equal(counter.requests, 1);
});

test('open discovery takes a port that closes after a late answer as free', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = discoverHealth('127.0.0.1', LOOPBACK_URL, () => assert.fail('upstream probe used'), {
        get: fakeGet((endpoint, call) => { if (requests.length > 1) call.refuse(refusal()); }, requests),
    });
    await advance(t, 700);
    assert.equal(await result, null);
    assert.equal(requests.length, 2);
});

test('discovery keeps the upstream probe for other addresses and outside open', async () => {
    const upstreamAnswer = { app: 'lavish-axi', state_dir: STATE };
    const noGet = () => assert.fail('Bruvish probe used');
    assert.equal(await discoverHealth('100.64.0.1', 'http://100.64.0.1:4388', () => upstreamAnswer, { get: noGet }), upstreamAnswer);
    retrySlowServer(false);
    assert.equal(await discoverHealth('127.0.0.1', LOOPBACK_URL, () => upstreamAnswer, { get: noGet }), upstreamAnswer);
});
