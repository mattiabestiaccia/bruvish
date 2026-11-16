// Every place where Bruvish touches an upstream file carries a `BRUVISH:hook <id>` marker. After a
// merge of a new upstream release, these tests say which hook moved or vanished, and that the
// hooks stay inert outside the Bruvish runtime (the upstream test suite runs without it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { injectLavishSdk } from '../../src/html-transform.js';
import { ARTIFACT_SCRIPT, injectBruvishArtifactScript } from '../lib/server.mjs';
import { RUNTIME_FLAG, runtimeEnvironment } from '../lib/env.mjs';
import { freePort, isolatedEnvironment, loadArtifact, root, sourceServer, until } from '../test-helpers/runtime.mjs';

// The full list of hooks. Keep it in step with BRUVISH.md.
export const HOOKS = {
    'src/server.js': ['server-import', 'server-routes', 'artifact-script'],
    'src/cli.js': ['open-import', 'open-present'],
    'scripts/build.js': ['build'],
    '.prettierignore': ['prettier'],
    '.github/workflows/ci.yml': ['workflow-ci'],
    '.github/workflows/release-please.yml': ['workflow-release'],
};
const MARKER = /BRUVISH:hook ([a-z0-9-]+)/g;
// Bruvish's own files may mention the marker; only upstream files carry hooks.
const OWN = new Set(['bruvish', 'app', 'node_modules', 'dist', '.git', 'BRUVISH.md', 'bruvish-build.js']);

async function upstreamFiles(directory = root, prefix = '') {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (OWN.has(entry.name)) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) files.push(...await upstreamFiles(path.join(directory, entry.name), relative + '/'));
        else if (entry.isFile()) files.push(relative);
    }
    return files;
}

test('every hook marker is present exactly once in its upstream file', async () => {
    for (const [file, ids] of Object.entries(HOOKS)) {
        const source = await readFile(path.join(root, file), 'utf8');
        for (const id of ids) {
            const count = source.split(`BRUVISH:hook ${id}`).length - 1;
            assert.equal(count, 1, `${file}: expected one BRUVISH:hook ${id}, found ${count}`);
        }
    }
});

test('no upstream file carries an unlisted hook', async () => {
    const found = {};
    for (const file of await upstreamFiles()) {
        const source = await readFile(path.join(root, file), 'utf8').catch(() => '');
        for (const match of source.matchAll(MARKER)) (found[file] ||= []).push(match[1]);
    }
    assert.deepEqual(found, HOOKS);
});

test('the artifact bridge follows the SDK tag exactly where upstream put it', () => {
    const on = { [RUNTIME_FLAG]: '1' };
    const sdk = '<script src="/sdk.js?key=abc123"></script>';
    const cases = [
        ['<html><body><h1>Hi</h1></body></html>', `<html><body><h1>Hi</h1>${sdk}${ARTIFACT_SCRIPT}</body></html>`],
        ['<h1>Hi</h1>', `<h1>Hi</h1>\n${sdk}${ARTIFACT_SCRIPT}`],
        ["<body><script>const s = '</body>';</script></body>", `<body><script>const s = '</body>';</script>${sdk}${ARTIFACT_SCRIPT}</body>`],
        ['<body><template></body></template>hi</body>', `<body><template></body></template>hi${sdk}${ARTIFACT_SCRIPT}</body>`],
        ['<!doctype html><p>hello</p></body>', `<!doctype html><p>hello</p></body>\n${sdk}${ARTIFACT_SCRIPT}`],
    ];
    for (const [html, expected] of cases) {
        assert.equal(injectBruvishArtifactScript(injectLavishSdk(html, 'abc123'), on), expected, html);
        assert.equal(injectBruvishArtifactScript(injectLavishSdk(html, 'abc123'), {}), injectLavishSdk(html, 'abc123'), 'inert without the runtime flag');
    }
});

async function startServer(directory, env) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [sourceServer, 'server', '--port', String(port)], {
        env: { ...env, LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: path.join(directory, 'state-' + port) },
        stdio: 'ignore',
    });
    await until(async () => (await fetch(base + '/health')).ok, 'server starts');
    return { base, async stop() { if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); } } };
}

test('server hooks change nothing without the Bruvish runtime and add the delta with it', { timeout: 60000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-hooks-'));
    const file = path.join(directory, 'page.html');
    await writeFile(file, '<!doctype html><html><body style="background:#222;color:#fff"><h1>Hook</h1></body></html>');
    const plainEnv = { ...process.env, ...isolatedEnvironment(directory) };
    delete plainEnv[RUNTIME_FLAG];
    const servers = [];
    try {
        const plain = await startServer(directory, plainEnv);
        servers.push(plain);
        const bruvish = await startServer(directory, runtimeEnvironment({ ...process.env, ...isolatedEnvironment(directory) }));
        servers.push(bruvish);
        for (const [server, active] of [[plain, false], [bruvish, true]]) {
            const root = await fetch(server.base + '/');
            assert.equal(root.headers.get('x-lavish-catalog'), active ? '1' : null);
            assert.equal((await fetch(server.base + '/mb-info')).status, active ? 200 : 404);
            assert.equal((await fetch(server.base + '/mb-artifact.js')).status, active ? 200 : 404);
            const created = await fetch(server.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, noGate: true }) });
            const { key } = await created.json();
            const artifact = await loadArtifact(server.base, key);
            assert.equal(artifact.status, 200);
            assert.equal(artifact.html.includes(ARTIFACT_SCRIPT), active, artifact.html);
            if (active) assert.match(artifact.html, /<script src="\/sdk\.js\?key=[^"]+"><\/script><script src="\/mb-artifact\.js"><\/script><\/body>/);
        }
    } finally {
        for (const server of servers) await server.stop();
        await rm(directory, { recursive: true, force: true });
    }
});
