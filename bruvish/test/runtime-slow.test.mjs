import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { assertCompatibleServer, SlowServerError } from '../lib/runtime.mjs';
import { freePort } from '../test-helpers/runtime.mjs';

const IDENTITY = 'build-a';
const STATE = '/tmp/lavish-slow-test-state';

// A fake Lavish server. `silentHealth` is how many /health requests are left unanswered (the
// socket stays open) before it starts answering normally; Infinity means it never answers.
async function fakeServer({ silentHealth = 0 } = {}) {
    let healthRequests = 0;
    const open = new Set();
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/health') {
            healthRequests += 1;
            if (healthRequests <= silentHealth) return;
            res.end(JSON.stringify({ ok: true, app: 'lavish-axi', state_dir: STATE }));
        } else if (req.url === '/mb-info') res.end(JSON.stringify({ identity: IDENTITY }));
        else res.end('{}');
    });
    server.on('connection', (socket) => { open.add(socket); socket.on('close', () => open.delete(socket)); });
    const port = await freePort();
    await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
    return {
        port,
        healthRequests: () => healthRequests,
        close: () => new Promise((resolve) => { for (const socket of open) socket.destroy(); server.close(resolve); }),
    };
}

const environment = (port) => ({ LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: STATE });
const fast = (pauses = [], timeoutMs = 1500) => ({ timeoutMs, pauseMs: 5, sleep: async (ms) => { pauses.push(ms); } });

test('a server that answers late is accepted after a retry, with a growing wait', async () => {
    const server = await fakeServer({ silentHealth: 2 });
    const pauses = [];
    try {
        await assertCompatibleServer(environment(server.port), IDENTITY, fast(pauses, 60));
        assert.equal(server.healthRequests(), 3);
        assert.deepEqual(pauses, [5, 10]);
    } finally {
        await server.close();
    }
});

test('a server that never answers is reported as slow after three attempts, not as refused', async () => {
    const server = await fakeServer({ silentHealth: Infinity });
    try {
        await assert.rejects(
            assertCompatibleServer(environment(server.port), IDENTITY, fast([], 40)),
            (error) => {
                assert.ok(error instanceof SlowServerError);
                assert.match(error.message, /slow to answer/);
                assert.match(error.message, /3 health checks/);
                assert.match(error.message, /not refused/);
                assert.doesNotMatch(error.message, /refusing automatic replacement/);
                return true;
            },
        );
        assert.equal(server.healthRequests(), 3);
    } finally {
        await server.close();
    }
});

test('a compatible server answering at once costs a single health request', async () => {
    const server = await fakeServer();
    try {
        await assertCompatibleServer(environment(server.port), IDENTITY, fast());
        assert.equal(server.healthRequests(), 1);
    } finally {
        await server.close();
    }
});

test('nothing listening returns without retrying', async () => {
    const pauses = [];
    await assertCompatibleServer(environment(await freePort()), IDENTITY, fast(pauses));
    assert.deepEqual(pauses, []);
});

test('a server from another build is still refused, with no retry', async () => {
    const server = await fakeServer();
    try {
        await assert.rejects(assertCompatibleServer(environment(server.port), 'other-build', fast()), /another Bruvish build/);
        assert.equal(server.healthRequests(), 1);
    } finally {
        await server.close();
    }
});
