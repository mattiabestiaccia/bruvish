// Shared by bruvish/test and app/test. Kept outside test/ so `node --test` does not run it as a test.
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
// Source layout: the upstream server bootstrap and the Bruvish CLI entry, no build needed.
export const sourceServer = fileURLToPath(new URL('../../bin/lavish-axi-server.js', import.meta.url));
export const sourceCli = fileURLToPath(new URL('../bin/lavish-axi.js', import.meta.url));
// Built layout: `pnpm run build` (scripts/build.js plus scripts/bruvish-build.js).
export const builtServer = fileURLToPath(new URL('../../dist/server.mjs', import.meta.url));
export const builtCli = fileURLToPath(new URL('../../dist/bruvish.mjs', import.meta.url));
export const buildSkip = existsSync(new URL('../../dist/bruvish-manifest.json', import.meta.url)) ? false : 'needs the Bruvish build: pnpm run build';
export const chromeSkip = process.env.LAVISH_MB_TEST_CHROME ? false : 'set LAVISH_MB_TEST_CHROME to a Chrome for Testing executable';

export async function freePort() {
    const socket = net.createServer();
    await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).once('error', reject));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    return port;
}

// Environment for a test service: its own port and state, never the live Bruvish service, and no
// personal opening or remote configuration from the home directory.
export function isolatedEnvironment(directory, overrides = {}) {
    return {
        LAVISH_MB_OPENING_CONFIG: directory + '/opening.json',
        LAVISH_MB_REMOTE_CONFIG: directory + '/remote.json',
        LAVISH_APP_STATE_DIR: directory + '/app',
        LAVISH_AXI_HOST: '127.0.0.1',
        LAVISH_AXI_LINK_HOST: '127.0.0.1',
        LAVISH_AXI_TELEMETRY: 'off',
        LAVISH_AXI_IDLE_TIMEOUT_MS: '60000',
        ...overrides,
    };
}

export async function until(fn, message, attempts = 200) {
    let last;
    for (let i = 0; i < attempts; i++) {
        try { if ((last = await fn())) return last; } catch (error) { last = error.message; }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(message + ': ' + JSON.stringify(last));
}

// Loads a session's artifact document the way the review chrome does (upstream load protocol).
export async function loadArtifact(base, key) {
    const page = await (await fetch(`${base}/session/${key}`)).text();
    const data = JSON.parse(page.match(/<script id="lavish-session" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const begin = await fetch(`${base}/api/${key}/artifact-loads/begin`, {
        method: 'POST', headers: {'content-type': 'application/json', origin: base},
        body: JSON.stringify({request_id: 'bruvish-test', request_sequence: data.initialArtifactLoadSequence + 1, chrome_load_token: data.chromeLoadToken}),
    });
    if (!begin.ok) throw new Error('artifact load refused: ' + begin.status);
    const load = await begin.json();
    const response = await fetch(`${base}/artifact/${key}/index.html?artifact_revision=${load.artifact_revision}&artifact_load_token=${encodeURIComponent(load.artifact_load_token)}`);
    return {status: response.status, html: await response.text(), load};
}
