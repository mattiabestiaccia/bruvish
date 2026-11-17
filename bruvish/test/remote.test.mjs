import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeEnvironment } from '../lib/env.mjs';
import * as remote from '../lib/remote.mjs';

test('ordinary runtime adds exactly the configured tailnet host; isolated runtimes do not', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-remote-config-'));
    try {
        const config = path.join(dir, 'remote.json'), state = path.join(dir, 'ordinary');
        await writeFile(config, JSON.stringify({ origin: 'https://mac.test.ts.net:8443', localPort: 4388, stateDirectory: state }));
        const base = { LAVISH_MB_REMOTE_CONFIG: config, LAVISH_AXI_STATE_DIR: state, LAVISH_AXI_ALLOWED_HOSTS: 'existing.test' };
        const env = runtimeEnvironment(base);
        assert.equal(env.LAVISH_AXI_HOST, '127.0.0.1');
        assert.equal(env.LAVISH_AXI_LINK_HOST, '127.0.0.1');
        assert.equal(env.LAVISH_AXI_ALLOWED_HOSTS, 'existing.test mac.test.ts.net');
        assert.equal(runtimeEnvironment({ ...base, LAVISH_AXI_PORT: '4389' }).LAVISH_AXI_ALLOWED_HOSTS, 'existing.test');
        assert.equal(runtimeEnvironment({ ...base, LAVISH_AXI_STATE_DIR: dir }).LAVISH_AXI_ALLOWED_HOSTS, 'existing.test');
    } finally { await rm(dir, {recursive: true, force: true}); }
});

test('a remote URL is emitted only when both servers identify the same state and runtime', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-remote-probe-'));
    try {
        const config = path.join(dir, 'remote.json');
        await writeFile(config, JSON.stringify({ origin: 'https://mac.test.ts.net:8443', localPort: 4388, stateDirectory: dir }));
        const env = runtimeEnvironment({ LAVISH_MB_REMOTE_CONFIG: config, LAVISH_AXI_STATE_DIR: dir });
        const responses = new Map([
            ['http://127.0.0.1:4388/health', { ok: true, app: 'lavish-axi', state_id: 'same-state', state_dir: dir }],
            ['https://mac.test.ts.net:8443/health', { ok: true, app: 'lavish-axi', state_id: 'same-state', state_dir: dir }],
            ['http://127.0.0.1:4388/mb-info', { app: 'lavish-mb', identity: 'reviewed-core' }],
            ['https://mac.test.ts.net:8443/mb-info', { app: 'lavish-mb', identity: 'reviewed-core' }],
        ]);
        let targetStatus = 200;
        const fetchBoundary = async (url, options) => {
            assert.equal(options.redirect, 'error', 'the probe must not follow a proxy redirect');
            assert(options.signal instanceof AbortSignal, 'every request has a bounded signal');
            if (url === 'https://mac.test.ts.net:8443/session/0123456789abcdef')
                return new Response('<html>fixture</html>', {status: targetStatus, headers: {'content-type': 'text/html'}});
            if (url === 'https://mac.test.ts.net:8443/')
                return new Response('<html>catalog</html>', {headers: {'content-type': 'text/html', 'x-lavish-catalog': '1'}});
            assert(responses.has(url), 'unexpected request: ' + url);
            return Response.json(responses.get(url));
        };
        const check = () => remote.verifyRemoteUrl('http://127.0.0.1:4388/session/0123456789abcdef', env, 'reviewed-core', {fetchImpl: fetchBoundary});
        assert.deepEqual(await check(), { status: 'ready', url: 'https://mac.test.ts.net:8443/session/0123456789abcdef', catalog_url: 'https://mac.test.ts.net:8443/' });
        for (const [endpoint, field, value] of [
            ['health', 'state_id', 'different-state'], ['health', 'state_dir', '/different-root'],
            ['mb-info', 'identity', 'outdated-core'], ['health', 'app', 'another-service']
        ]) {
            const item = responses.get('https://mac.test.ts.net:8443/' + endpoint), previous = item[field];
            item[field] = value;
            const result = await check();
            assert.equal(result.status, 'unavailable'); assert.equal(result.url, undefined);
            item[field] = previous;
        }
        targetStatus = 404;
        assert.equal((await check()).url, undefined, 'missing remote artifact is not advertised');
    } finally { await rm(dir, {recursive: true, force: true}); }
});

test('invalid origins and unavailable transports never advertise a remote URL or widen allowed hosts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-remote-refusal-'));
    try {
        const config = path.join(dir, 'remote.json');
        const input = {origin: 'https://mac.test.ts.net:8443', localPort: 4388, stateDirectory: dir};
        const base = {LAVISH_MB_REMOTE_CONFIG: config, LAVISH_AXI_STATE_DIR: dir};
        for (const origin of ['http://mac.test.ts.net', 'https://example.com', 'https://user@mac.test.ts.net',
            'https://mac.test.ts.net/path', 'https://mac.test.ts.net?x=1', 'https://mac.test.ts.net#x', 'https://*.ts.net']) {
            await writeFile(config, JSON.stringify({...input, origin}));
            const env = runtimeEnvironment(base);
            assert.equal(env.LAVISH_AXI_ALLOWED_HOSTS, undefined, origin);
            const result = await remote.verifyRemoteUrl('http://127.0.0.1:4388/session/0123456789abcdef', env, 'core', {
                fetchImpl: () => assert.fail('invalid configuration must not make requests')
            });
            assert.equal(result.status, 'unavailable'); assert.equal(result.url, undefined);
        }
        await writeFile(config, JSON.stringify(input));
        const env = runtimeEnvironment(base);
        for (const fetchImpl of [
            async () => { throw new Error('network unavailable'); },
            async () => new Response('unavailable', {status: 503}),
            async () => new Response('', {status: 302, headers: {location: 'https://elsewhere.test/'}}),
            (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}))
        ]) {
            const result = await remote.verifyRemoteUrl('http://127.0.0.1:4388/session/0123456789abcdef', env, 'core', {fetchImpl, timeoutMs: 20});
            assert.equal(result.status, 'unavailable'); assert.equal(result.url, undefined);
        }
    } finally { await rm(dir, {recursive: true, force: true}); }
});

test('the fixed catalog URL is independently verified without hiding a working session URL', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-catalog-remote-'));
    try {
        const config = path.join(dir, 'remote.json'), origin = 'https://mac.test.ts.net:8443';
        await writeFile(config, JSON.stringify({origin, localPort: 4388, stateDirectory: dir}));
        const env = runtimeEnvironment({LAVISH_MB_REMOTE_CONFIG: config, LAVISH_AXI_STATE_DIR: dir});
        let catalogMode = 'ready';
        const fetchBoundary = async url => {
            if (url.endsWith('/health')) return Response.json({ok: true, app: 'lavish-axi', state_id: 'same', state_dir: dir});
            if (url.endsWith('/mb-info')) return Response.json({app: 'lavish-mb', identity: 'core'});
            if (url === origin + '/') {
                if (catalogMode === 'offline') throw Error('Catalog transport failed');
                return new Response('<html>catalog</html>', {status: catalogMode === 'missing' ? 404 : 200,
                    headers: {'content-type': 'text/html', ...(catalogMode === 'ready' ? {'x-lavish-catalog': '1'} : {})}});
            }
            return new Response('<html>session</html>', {headers: {'content-type': 'text/html'}});
        };
        const check = () => remote.verifyRemoteUrl('http://127.0.0.1:4388/session/0123456789abcdef', env, 'core', {fetchImpl: fetchBoundary});
        assert.deepEqual(await check(), {status: 'ready', url: origin + '/session/0123456789abcdef', catalog_url: origin + '/'});
        for (catalogMode of ['missing', 'placeholder', 'offline']) {
            const result = await check();
            assert.equal(result.status, 'ready');
            assert.equal(result.url, origin + '/session/0123456789abcdef');
            assert.equal(result.catalog_url, undefined);
            assert(result.catalog_reason, 'the missing catalog has a reason distinct from session readiness');
        }
    } finally {await rm(dir, {recursive: true, force: true});}
});
