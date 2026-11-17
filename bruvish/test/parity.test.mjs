// Parity of the Bruvish build with the upstream build plus the delta, and (opt-in) with the
// former overlay's derived files: set BRUVISH_PARITY_CACHE to one overlay cache entry, the
// directory that holds its dist/ (for example ~/.cache/lavish-mb/<id>).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runtimeEnvironment } from '../lib/env.mjs';
import { builtCli, builtServer, buildSkip, freePort, isolatedEnvironment, loadArtifact, root, sourceCli, sourceServer, until } from '../test-helpers/runtime.mjs';

const read = (file) => readFile(path.join(root, file));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const cache = process.env.BRUVISH_PARITY_CACHE;
const cacheSkip = buildSkip || (cache ? false : 'set BRUVISH_PARITY_CACHE to an overlay cache entry');

test('the build is the upstream build plus the delta, byte for byte', { skip: buildSkip }, async () => {
    for (const [output, upstream] of [['chrome-client.js', 'src/chrome-client.js'], ['chrome.css', 'src/chrome.css']]) {
        assert.deepEqual(await read('dist/' + output), await read(upstream), output + ' stays the upstream file');
    }
    for (const [output, source] of [['mb-artifact.js', 'bruvish/assets/bridge.js'], ['mb-catalog.css', 'bruvish/assets/catalog.css'], ['mb-catalog.js', 'bruvish/assets/catalog.js'], ['mb-catalog-fonts.css', 'bruvish/assets/fonts.css'], ['mb-catalog.cjs', 'app/catalog.cjs'], ['chrome-addon.js', 'bruvish/assets/chrome-addon.js'], ['chrome-addon.css', 'bruvish/assets/chrome-addon.css']]) {
        assert.deepEqual(await read('dist/' + output), await read(source), output);
    }
    const manifest = JSON.parse(await read('dist/bruvish-manifest.json'));
    assert.equal(manifest.upstreamVersion, version);
    assert.equal(manifest.upstreamTag, 'lavish-axi-v' + version);
    for (const [name, hash] of Object.entries(manifest.outputs)) assert.equal(sha(await read('dist/' + name)), hash, name);
    assert.equal(manifest.identity, sha(JSON.stringify(manifest.outputs)).slice(0, 20));
});

test('--version prints only the upstream version and touches no state', { timeout: 30000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-version-'));
    try {
        for (const cli of [sourceCli, ...(buildSkip ? [] : [builtCli])]) {
            const state = path.join(directory, 'state');
            const result = spawnSync(process.execPath, [cli, '--version'], { env: { ...process.env, LAVISH_AXI_STATE_DIR: state }, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout, version + '\n', 'Firstmate reads the first x.y.z: there must be exactly one');
            assert.equal(existsSync(state), false);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('derived files equal the former overlay', { skip: cacheSkip }, async () => {
    for (const name of ['mb-artifact.js', 'mb-catalog.css', 'mb-catalog.js', 'mb-catalog-fonts.css', 'mb-catalog.cjs']) {
        assert.equal(sha(await read('dist/' + name)), sha(await readFile(path.join(cache, 'dist', name))), name);
    }
});

async function serve(entry, directory, name, { bruvish = true } = {}) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const { LAVISH_BRUVISH: _flag, ...inherited } = process.env;
    const plain = { ...inherited, ...isolatedEnvironment(directory), LAVISH_AXI_PORT: String(port), LAVISH_AXI_STATE_DIR: path.join(directory, name) };
    const env = bruvish ? runtimeEnvironment(plain) : plain;
    const child = spawn(process.execPath, [entry, 'server', '--port', String(port)], { env, stdio: 'ignore' });
    await until(async () => (await fetch(base + '/health')).ok, name + ' server starts');
    // A child killed by a signal keeps exitCode null and sets signalCode: check both, or a second
    // stop() waits forever for an 'exit' that already fired.
    return { base, async stop() { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } } };
}

const HEADERS = ['content-type', 'cache-control', 'content-security-policy', 'x-lavish-catalog', 'x-frame-options'];
async function snapshot(base, url) {
    const response = await fetch(base + url);
    return { status: response.status, headers: Object.fromEntries(HEADERS.map(name => [name, response.headers.get(name)])), body: await response.text() };
}

test('the interface addon is served only in the Bruvish runtime, from source and from the build', { timeout: 90000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-chrome-'));
    const servers = [];
    try {
        for (const [layout, entry] of [['source', sourceServer], ...(buildSkip ? [] : [['built', builtServer]])]) {
            for (const bruvish of [false, true]) {
                const server = await serve(entry, directory, `${layout}-${bruvish}`, { bruvish });
                servers.push(server);
                for (const [url, upstream, addon] of [['/chrome-client.js', 'src/chrome-client.js', 'bruvish/assets/chrome-addon.js'], ['/chrome.css', 'src/chrome.css', 'bruvish/assets/chrome-addon.css']]) {
                    const served = Buffer.from(await (await fetch(server.base + url)).arrayBuffer());
                    const expected = bruvish ? Buffer.concat([await read(upstream), Buffer.from('\n'), await read(addon)]) : await read(upstream);
                    assert.deepEqual(served, expected, `${layout} ${url} with LAVISH_BRUVISH ${bruvish ? 'on' : 'off'}`);
                }
                assert.equal((await fetch(server.base + '/mb-info')).ok, bruvish, `${layout} /mb-info only in the runtime`);
                await server.stop();
            }
        }
    } finally {
        for (const server of servers) await server.stop();
        await rm(directory, { recursive: true, force: true });
    }
});

test('the Bruvish server answers like the overlay server', { skip: cacheSkip, timeout: 90000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-parity-'));
    const servers = [];
    try {
        const files = ['Prima scelta', 'Conclusa', '<b>Nome & "x"'].map(name => path.join(directory, name + '.html'));
        for (const file of files) await writeFile(file, '<!doctype html><html><head><title>Parità</title></head><body style="background:#222;color:#fff"><h1>Parità</h1></body></html>');
        const overlay = await serve(path.join(cache, 'dist/server.mjs'), directory, 'overlay');
        servers.push(overlay);
        const bruvish = await serve(builtServer, directory, 'bruvish');
        servers.push(bruvish);
        const keys = [];
        for (const server of [overlay, bruvish]) {
            const registered = [];
            for (const file of files) {
                const response = await fetch(server.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, noGate: true }) });
                registered.push((await response.json()).key);
            }
            await fetch(`${server.base}/api/${registered[1]}/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            keys.push(registered);
        }
        assert.deepEqual(keys[0], keys[1], 'the session key is the canonical path in both');
        for (const url of ['/', '/mb-artifact.js', '/mb-catalog.css', '/mb-catalog.js', '/mb-catalog-fonts.css', '/chrome-client.js', '/chrome.css', '/sdk.js?key=' + keys[0][0]]) {
            const [a, b] = [await snapshot(overlay.base, url), await snapshot(bruvish.base, url)];
            // Catalog dates come from each server's own state: compare them as structure only.
            const normalize = (s) => ({ ...s, body: url === '/' ? s.body.replace(/<time[^>]*>[^<]*<\/time>/g, '<time/>') : s.body });
            assert.deepEqual(normalize(b), normalize(a), url);
        }
        for (const name of ['chrome-client.js', 'chrome.css']) {
            const served = Buffer.from(await (await fetch(bruvish.base + '/' + name)).arrayBuffer());
            assert.equal(sha(served), sha(await readFile(path.join(cache, 'dist', name))), name + ' served equals the overlay derived file');
        }
        const [infoA, infoB] = [await (await fetch(overlay.base + '/mb-info')).json(), await (await fetch(bruvish.base + '/mb-info')).json()];
        assert.equal(infoB.app, infoA.app);
        assert.equal(infoB.upstreamVersion, infoA.upstreamVersion);
        const tokens = (html, load) => html.replaceAll(encodeURIComponent(load.artifact_load_token), 'TOKEN').replaceAll(load.artifact_load_token, 'TOKEN');
        const [artifactA, artifactB] = [await loadArtifact(overlay.base, keys[0][0]), await loadArtifact(bruvish.base, keys[0][0])];
        assert.equal(artifactB.status, artifactA.status);
        assert.equal(tokens(artifactB.html, artifactB.load), tokens(artifactA.html, artifactA.load), 'artifact document with SDK and bridge');
        const foreign = await new Promise((resolve, reject) => {
            import('node:http').then(({ get }) => get(bruvish.base + '/', { headers: { host: 'foreign.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
        });
        assert.equal(foreign, 403);
        if (process.env.BRUVISH_PARITY_EVIDENCE) {
            const catalog = await snapshot(bruvish.base, '/');
            await writeFile(path.join(process.env.BRUVISH_PARITY_EVIDENCE, 'catalog-bruvish.html'), catalog.body);
            await writeFile(path.join(process.env.BRUVISH_PARITY_EVIDENCE, 'artifact-bruvish.html'), tokens(artifactB.html, artifactB.load));
            await writeFile(path.join(process.env.BRUVISH_PARITY_EVIDENCE, 'mb-info.json'), JSON.stringify({ overlay: infoA, bruvish: infoB }, null, 2) + '\n');
        }
    } finally {
        for (const server of servers) await server.stop();
        await rm(directory, { recursive: true, force: true });
    }
});
