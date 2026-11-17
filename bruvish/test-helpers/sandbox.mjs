// Preload (NODE_OPTIONS=--import=<this file>) for a CLI run that stands in for an agent sandbox. Every
// program launch and every request to a host other than loopback is appended to TEST_SANDBOX_LOG.
// Surface programs (Chrome through /usr/bin/open, app/open.mjs) and non-loopback requests fail the
// way the sandbox makes them fail; a test that expects a sandbox-safe command asserts an empty log.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const record = (entry) => appendFileSync(process.env.TEST_SANDBOX_LOG, JSON.stringify(entry) + '\n');
const surface = (command, args) => command === '/usr/bin/open' || /app[\\/]open\.mjs$/.test(String(args?.[0] || ''));

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    const original = childProcess[name];
    childProcess[name] = function (command, args, ...rest) {
        record({ launch: name, command, args: Array.isArray(args) ? args : [] });
        if (surface(command, args)) throw Object.assign(new Error('sandbox: launching ' + command + ' is not permitted'), { code: 'EPERM' });
        return original.call(this, command, args, ...rest);
    };
}
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
    record({ fetch: url.origin });
    return Promise.reject(new TypeError('sandbox: network access to ' + url.origin + ' is not permitted'));
};
