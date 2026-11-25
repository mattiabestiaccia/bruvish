import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runtimeIdentity } from '../lib/identity.mjs';
import { assertCompatibleServer, SlowServerError } from '../lib/runtime.mjs';
import { freePort, isolatedEnvironment, sourceCli } from '../test-helpers/runtime.mjs';

const IDENTITY = 'build-a';
const STATE = '/tmp/lavish-slow-test-state';
const runCli = promisify(execFile);

async function fakeServer({ delayHealth = 0, state = STATE, identity = IDENTITY } = {}) {
    const requests = [];
    const openedFiles = [];
    let healthCount = 0;
    const open = new Set();
    const server = http.createServer(async (req, res) => {
        const endpoint = req.url.split('?')[0];
        requests.push(endpoint);
        res.setHeader('content-type', 'application/json');
        if (endpoint === '/health') {
            healthCount += 1;
            const body = JSON.stringify({
                ok: true, app: 'lavish-axi', version: '999.0.0', state_dir: state, hosts: ['127.0.0.1'],
            });
            if (healthCount <= 2 && delayHealth) {
                const reply = setTimeout(() => res.end(body), delayHealth);
                res.once('close', () => clearTimeout(reply));
            } else res.end(body);
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

const environment = (port) => ({ LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: STATE });
const fast = (timeoutMs = 1500) => ({ timeoutMs, sleep: async () => {} });

test('open registers the session after a health answer that needs the second probe window', { timeout: 15000 }, async (t) => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const directory = await mkdtemp(path.join(root, '.bruvish-open-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'review.html');
    await writeFile(file, '<!doctype html><h1>Prova</h1>');
    const state = path.join(directory, 'state');
    const server = await fakeServer({ delayHealth: 1000, state, identity: runtimeIdentity() });
    t.after(server.close);
    await runCli(process.execPath, [sourceCli, 'open', file, '--no-open'], {
        timeout: 12000,
        env: {
            ...process.env,
            ...isolatedEnvironment(directory),
            LAVISH_AXI_PORT: String(server.port),
            LAVISH_AXI_STATE_DIR: state,
        },
    });
    assert.deepEqual(server.requests.slice(0, 3), ['/health', '/health', '/mb-info']);
    assert.deepEqual(server.openedFiles, [await realpath(file)]);
});

test('the second health probe accepts an answer beyond the first deadline', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [];
    const result = assertCompatibleServer(environment(4388), IDENTITY, {
        ...fast(80),
        fetchImpl: (url, { signal }) => {
            const endpoint = new URL(url).pathname;
            requests.push(endpoint);
            if (endpoint === '/mb-info') return Response.json({ identity: IDENTITY });
            return new Promise((resolve, reject) => {
                const reply = setTimeout(() => resolve(Response.json({ app: 'lavish-axi', state_dir: STATE })), 120);
                signal.addEventListener('abort', () => {
                    clearTimeout(reply);
                    reject(signal.reason);
                }, { once: true });
            });
        },
    });
    t.mock.timers.tick(80);
    await setImmediate();
    t.mock.timers.tick(120);
    await setImmediate();
    assert.deepEqual(requests, ['/health', '/health', '/mb-info']);
    await result;
});

for (const endpoint of ['/health', '/mb-info']) {
    test(`three unanswered ${endpoint} requests identify the slow endpoint in Italian`, async () => {
        const requests = [];
        await assert.rejects(
            assertCompatibleServer(environment(4388), IDENTITY, {
                ...fast(),
                fetchImpl: async (url) => {
                    const requested = new URL(url).pathname;
                    requests.push(requested);
                    if (requested === endpoint) throw new DOMException('The operation was aborted', 'AbortError');
                    return Response.json({ app: 'lavish-axi', state_dir: STATE });
                },
            }),
            (error) => {
                assert.ok(error instanceof SlowServerError);
                assert.match(error.message, /server Lavish risponde lentamente/);
                assert.ok(error.message.includes(`Il controllo ${endpoint} è scaduto dopo 3 tentativi`));
                assert.match(error.message, /Riprova tra qualche secondo/);
                return true;
            },
        );
        assert.deepEqual(requests, endpoint === '/health'
            ? ['/health', '/health', '/health']
            : ['/health', '/mb-info', '/mb-info', '/mb-info']);
    });
}

test('a compatible server answering at once gets one request per endpoint', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assertCompatibleServer(environment(server.port), IDENTITY, fast());
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});

test('nothing listening returns after one connection attempt', async () => {
    let requests = 0;
    await assertCompatibleServer(environment(await freePort()), IDENTITY, {
        ...fast(),
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
            ...fast(80),
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
        { cause: { code: 'ECONNREFUSED' } },
    );
    t.mock.timers.tick(80);
    await result;
    assert.deepEqual(requests, ['/health', '/health']);
});

test('a server from another build is refused without retrying', async (t) => {
    const server = await fakeServer();
    t.after(server.close);
    await assert.rejects(assertCompatibleServer(environment(server.port), 'other-build', fast()), /another Bruvish build/);
    assert.deepEqual(server.requests, ['/health', '/mb-info']);
});
