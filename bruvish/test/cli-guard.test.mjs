import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { builtCli, buildSkip, freePort, isolatedEnvironment, sourceCli } from '../test-helpers/runtime.mjs';

// A Lavish server for the same port and state, but from another Bruvish build (or the overlay
// in use): the CLI must refuse it instead of driving or stopping it.
async function foreignBuild(stateDir) {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/health') res.end(JSON.stringify({ ok: true, app: 'lavish-axi', version: '0.1.96', state_dir: stateDir, state_id: 'foreign', pid: process.pid }));
        else if (req.url === '/mb-info') res.end(JSON.stringify({ app: 'lavish-mb', product: 'bruvish', identity: 'another-build' }));
        else res.end('{}');
    });
    const port = await freePort();
    await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
    return { port, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

// The foreign server is reached through the environment port, or only through stop's own --port
// while the environment names a free port.
const TARGETS = {
    environment: async (port) => ({ envPort: port, args: [] }),
    '--port': async (port) => ({ envPort: await freePort(), args: ['--port', String(port)] }),
    '--port=': async (port) => ({ envPort: await freePort(), args: ['--port=' + port] }),
};

for (const [layout, cli] of [['source', sourceCli], ['built', builtCli]]) for (const [target, choose] of Object.entries(TARGETS)) {
    test(`stop refuses a server of another build and sends it nothing (${layout} CLI, port from ${target})`, { skip: layout === 'built' && buildSkip, timeout: 30000 }, async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-stop-'));
        const state = path.join(directory, 'state');
        const foreign = await foreignBuild(state);
        try {
            const { envPort, args } = await choose(foreign.port);
            const child = spawn(process.execPath, [cli, 'stop', ...args], { env: { ...process.env, ...isolatedEnvironment(directory), LAVISH_AXI_PORT: String(envPort), LAVISH_AXI_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', data => stderr += data);
            const code = await new Promise(resolve => child.once('exit', resolve));
            assert.equal(code, 1, stderr);
            assert.match(stderr, /another Bruvish build/);
            assert.deepEqual(foreign.requests, ['GET /health', 'GET /mb-info'], 'only the read-only identity checks reach the server');
        } finally {
            await foreign.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
}
