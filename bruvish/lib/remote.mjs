import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const expandHome = value => value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;

// The tailnet host is personal configuration: it lives in ~/.config/lavish-mb/remote.json
// (or LAVISH_MB_REMOTE_CONFIG), never in this repository.
// Invalid/missing configuration disables remote links without breaking local use.
export function remoteConfigPath(env) {
    return env.LAVISH_MB_REMOTE_CONFIG || path.join(os.homedir(), '.config/lavish-mb/remote.json');
}

export function remoteSettings(env) {
    try {
        const file = remoteConfigPath(env);
        const input = JSON.parse(readFileSync(file, 'utf8'));
        const origin = new URL(input.origin);
        if (origin.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/.test(origin.hostname) ||
            origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
            throw new Error('expected an HTTPS ts.net origin without credentials, path, query or fragment');
        if (!Number.isInteger(input.localPort) || input.localPort < 1 || input.localPort > 65535 ||
            typeof input.stateDirectory !== 'string' || !path.isAbsolute(expandHome(input.stateDirectory)))
            throw new Error('expected a local TCP port and an absolute or home-relative state directory');
        const stateDirectory = path.resolve(expandHome(input.stateDirectory));
        if (String(input.localPort) !== String(env.LAVISH_AXI_PORT) || path.resolve(env.LAVISH_AXI_STATE_DIR) !== stateDirectory)
            return { status: 'unavailable', reason: 'This port/state override is not the configured remote service.' };
        return { status: 'configured', origin: origin.origin, hostname: origin.hostname,
            localOrigin: `http://127.0.0.1:${input.localPort}`, stateDirectory };
    } catch {
        return { status: 'unavailable', reason: 'Remote configuration is missing or invalid; inspect the configured remote.json.' };
    }
}

export async function verifyRemoteUrl(localUrl, env, identity, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
    const settings = remoteSettings(env);
    if (settings.status !== 'configured') return settings;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const local = new URL(localUrl);
        if (local.origin !== settings.localOrigin || local.username || local.password || local.hash ||
            !/^\/session\/[a-f0-9]{16}$/.test(local.pathname))
            throw new Error('Expected a session URL from the configured local service.');
        /** @type {RequestInit} */
        const options = { signal: controller.signal, redirect: 'error' };
        const getJson = async url => {
            const response = await fetchImpl(url, options);
            if (!response.ok) throw new Error(`Remote verification received HTTP ${response.status}.`);
            return response.json();
        };
        const [localHealth, localInfo, remoteHealth, remoteInfo] = await Promise.all([
            getJson(settings.localOrigin + '/health'), getJson(settings.localOrigin + '/mb-info'),
            getJson(settings.origin + '/health'), getJson(settings.origin + '/mb-info')
        ]);
        for (const health of [localHealth, remoteHealth]) {
            if (health.ok !== true || health.app !== 'lavish-axi' || typeof health.state_id !== 'string' || !health.state_id ||
                typeof health.state_dir !== 'string' || path.resolve(health.state_dir) !== settings.stateDirectory)
                throw new Error('The proxy is not serving the configured Lavish state directory.');
        }
        if (localHealth.state_id !== remoteHealth.state_id)
            throw new Error('Local and remote Lavish state identities differ.');
        if (!identity || [localInfo, remoteInfo].some(info => info.app !== 'lavish-mb' || info.identity !== identity))
            throw new Error('Local and remote Lavish runtime identities differ.');
        const url = settings.origin + local.pathname + local.search;
        const response = await fetchImpl(url, options);
        const isHtml = response.headers.get('content-type')?.startsWith('text/html');
        await response.body?.cancel();
        if (!response.ok || !isHtml) throw new Error('The remote artifact is not available.');
        // The direct review remains usable even when a proxy serves an older
        // landing page or cannot reach the catalog. Never invent the bookmark.
        const result = { status: 'ready', url };
        try {
            const catalogUrl = settings.origin + '/';
            const catalog = await fetchImpl(catalogUrl, options);
            const valid = catalog.ok && catalog.headers.get('content-type')?.startsWith('text/html')
                && catalog.headers.get('x-lavish-catalog') === '1';
            await catalog.body?.cancel();
            if (!valid) throw Error('The remote catalog is not available from this service.');
            result.catalog_url = catalogUrl;
        } catch (error) {
            result.catalog_reason = controller.signal.aborted ? 'Catalog verification timed out; the direct review link was verified.' : error.message;
        }
        return result;
    } catch (error) {
        return { status: 'unavailable', reason: controller.signal.aborted ? 'Remote verification timed out; local access is unchanged.' : error.message };
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
}

export function printRemoteStatus(result) {
    console.log('remote:');
    console.log('  status: ' + result.status);
    console.log('  ' + (result.url ? 'url' : 'reason') + ': ' + JSON.stringify(result.url || result.reason));
    if (result.catalog_url) console.log('  catalog_url: ' + JSON.stringify(result.catalog_url));
    else if (result.catalog_reason) console.log('  catalog_reason: ' + JSON.stringify(result.catalog_reason));
}
