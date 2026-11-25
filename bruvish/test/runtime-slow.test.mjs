import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
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

// A fetch whose /health answers arrive `delayMs` after each request, on the mocked clock.
function lateHealth(delayMs, requests) {
    return (url, { signal }) => {
        const endpoint = new URL(url).pathname;
        requests.push(endpoint);
        if (endpoint === '/mb-info') return Promise.resolve(Response.json({ identity: IDENTITY }));
        return new Promise((resolve, reject) => {
            const reply = setTimeout(() => resolve(Response.json({ app: 'lavish-axi', state_dir: STATE })), delayMs);
            signal.addEventListener('abort', () => {
                clearTimeout(reply);
                reject(signal.reason);
            }, { once: true });
        });
    };
}

async function advance(t, ...steps) {
    for (const ms of steps) {
        t.mock.timers.tick(ms);
        await setImmediate();
    }
}

const environment = (port) => ({ LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: STATE });
const aborted = () => Promise.reject(new DOMException('The operation was aborted', 'AbortError'));

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
    // Build check: 700 ms window lost, 1400 ms won, /mb-info once. Discovery on loopback: the same two.
    assert.deepEqual(server.requests.slice(0, 5), ['/health', '/health', '/mb-info', '/health', '/health']);
    assert.deepEqual(server.openedFiles, [await realpath(file)]);
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
        const result = assertCompatibleServer(environment(4388), IDENTITY, { fetchImpl: lateHealth(delayMs, requests) });
        await advance(t, ...ticks);
        await result;
        assert.deepEqual(requests, [...Array(healthRequests).fill('/health'), '/mb-info']);
    });
}

test('three unanswered health requests report a slow server in Italian', async () => {
    const requests = [];
    await assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            fetchImpl: (url) => {
                requests.push(new URL(url).pathname);
                return aborted();
            },
        }),
        (error) => {
            assert.ok(error instanceof SlowServerError);
            assert.equal(
                error.message,
                'Il server Lavish risponde lentamente. Il controllo /health è scaduto dopo 3 tentativi in 4,9 s. Riprova tra qualche secondo.',
            );
            return true;
        },
    );
    assert.deepEqual(requests, ['/health', '/health', '/health']);
});

test('an unanswered /mb-info is read once and named in the message', async () => {
    const requests = [];
    await assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            fetchImpl: (url) => {
                const endpoint = new URL(url).pathname;
                requests.push(endpoint);
                return endpoint === '/mb-info' ? aborted() : Promise.resolve(Response.json({ app: 'lavish-axi', state_dir: STATE }));
            },
        }),
        (error) => error instanceof SlowServerError && error.message.includes('Il controllo /mb-info è scaduto dopo 1 tentativo'),
    );
    assert.deepEqual(requests, ['/health', '/mb-info']);
});

test('outside open a slow health check is not retried', async () => {
    retrySlowServer(false);
    const requests = [];
    await assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            fetchImpl: (url) => {
                requests.push(new URL(url).pathname);
                return aborted();
            },
        }),
        (error) => error instanceof SlowServerError && error.message.includes('dopo 1 tentativo in 0,7 s'),
    );
    assert.deepEqual(requests, ['/health']);
});

test('a compatible server answering at once gets one request per endpoint', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assertCompatibleServer(environment(server.port), IDENTITY);
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});

test('nothing listening returns after one connection attempt', async () => {
    let requests = 0;
    await assertCompatibleServer(environment(await freePort()), IDENTITY, {
        fetchImpl: (...args) => {
            requests += 1;
            return fetch(...args);
        },
    });
    assert.equal(requests, 1);
});

test('connection refusal after a health timeout does not bypass the build check', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    const requests = [];
    const result = assert.rejects(
        assertCompatibleServer(environment(4388), IDENTITY, {
            fetchImpl: (url, { signal }) => {
                requests.push(new URL(url).pathname);
                if (requests.length === 1) {
                    return new Promise((resolve, reject) => {
                        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                    });
                }
                return Promise.reject(refused);
            },
        }),
        (error) => error === refused,
    );
    t.mock.timers.tick(700);
    await result;
    assert.deepEqual(requests, ['/health', '/health']);
});

for (const endpoint of ['/health', '/mb-info']) {
    test(`a ${endpoint} body cut off mid-read fails instead of being judged`, async () => {
        const cut = new TypeError('terminated');
        const truncated = { ok: true, json: () => Promise.reject(cut) };
        await assert.rejects(
            assertCompatibleServer(environment(4388), IDENTITY, {
                fetchImpl: async (url) => new URL(url).pathname === endpoint
                    ? truncated
                    : Response.json({ app: 'lavish-axi', state_dir: STATE }),
            }),
            (error) => error === cut,
        );
    });
}

test('a server from another build is refused without retrying', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assert.rejects(assertCompatibleServer(environment(server.port), 'other-build'), /another Bruvish build/);
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});

test('open discovery on loopback waits for a late health answer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    let upstream = 0;
    const result = discoverHealth('127.0.0.1', LOOPBACK_URL, () => { upstream += 1; return null; }, {
        fetchImpl: lateHealth(1000, requests),
    });
    await advance(t, 700, 1000);
    assert.deepEqual(await result, { app: 'lavish-axi', state_dir: STATE });
    assert.deepEqual(requests, ['/health', '/health']);
    assert.equal(upstream, 0);
});

test('open discovery reports a loopback that never answers as slow', async () => {
    const requests = [];
    await assert.rejects(
        discoverHealth('127.0.0.1', LOOPBACK_URL, () => null, {
            fetchImpl: () => {
                requests.push('/health');
                return aborted();
            },
        }),
        SlowServerError,
    );
    assert.equal(requests.length, 3);
});

test('open discovery takes a free loopback port as free after one attempt', async () => {
    let requests = 0;
    const port = await freePort();
    const health = await discoverHealth('127.0.0.1', `http://127.0.0.1:${port}`, () => assert.fail('upstream probe used'), {
        fetchImpl: (...args) => {
            requests += 1;
            return fetch(...args);
        },
    });
    assert.equal(health, null);
    assert.equal(requests, 1);
});

test('discovery keeps the upstream probe for other addresses and outside open', async () => {
    const upstreamAnswer = { app: 'lavish-axi', state_dir: STATE };
    const noFetch = () => assert.fail('Bruvish probe used');
    assert.equal(await discoverHealth('100.64.0.1', 'http://100.64.0.1:4388', () => upstreamAnswer, { fetchImpl: noFetch }), upstreamAnswer);
    retrySlowServer(false);
    assert.equal(await discoverHealth('127.0.0.1', LOOPBACK_URL, () => upstreamAnswer, { fetchImpl: noFetch }), upstreamAnswer);
});
