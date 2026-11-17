// Shared by the tests of bruvish/scripts (update-upstream, install, rollback). Kept outside test/ so
// `node --test` does not run it as a test. Everything runs offline in a temporary directory: fake
// git repositories, a fake HOME, and a fake `pnpm` first on PATH that records its calls.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

const FAKE_PNPM = `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
if (process.env.FAKE_PNPM_FAIL && args.join(' ') === process.env.FAKE_PNPM_FAIL) process.exit(1);
if (args.join(' ') === 'run build') {
    mkdirSync('dist', { recursive: true });
    for (const name of ['cli.mjs', 'server.mjs']) writeFileSync('dist/' + name, '// upstream ' + name + '\\n');
}
if (args[0] === 'install' && args.includes('--prod')) {
    mkdirSync('node_modules/fake-dep', { recursive: true });
    writeFileSync('node_modules/fake-dep/index.js', '');
}
`;

// Stands in for scripts/bruvish-build.js: a command that needs its production dependency and
// prints the version, and a manifest in the same shape as the real one.
const FAKE_BRUVISH_BUILD = `import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const sha = (data) => createHash('sha256').update(data).digest('hex');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/bruvish.mjs', [
    '#!/usr/bin/env node',
    "import { existsSync } from 'node:fs';",
    "if (!existsSync(new URL('../node_modules/fake-dep/index.js', import.meta.url))) { console.error('fake-dep missing'); process.exit(1); }",
    "if (process.argv[2] === '--version') console.log(" + JSON.stringify(version) + ');',
    '',
].join('\\n'));
chmodSync('dist/bruvish.mjs', 0o755);
const outputs = {};
for (const name of ['cli.mjs', 'server.mjs', 'bruvish.mjs']) outputs[name] = sha(readFileSync('dist/' + name));
if (process.env.FAKE_BUILD_CORRUPT) outputs['bruvish.mjs'] = '0'.repeat(64);
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const manifest = {
    product: 'bruvish',
    identity: sha(JSON.stringify(outputs)).slice(0, 20),
    upstreamVersion: version,
    upstreamTag: 'lavish-axi-v' + version,
    carryCommit: git(['rev-parse', 'HEAD']),
    carryDirty: git(['status', '--porcelain']) !== '',
    outputs,
};
writeFileSync('dist/bruvish-manifest.json', JSON.stringify(manifest, null, 2) + '\\n');
`;

export function workspace(prefix) {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
    const home = path.join(dir, 'home');
    const bin = path.join(dir, 'fake-bin');
    mkdirSync(home);
    mkdirSync(bin);
    writeFileSync(path.join(dir, 'fake-pnpm.mjs'), FAKE_PNPM);
    writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake-pnpm.mjs')}" "$@"\n`);
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    const pnpmLog = path.join(dir, 'pnpm.log');
    writeFileSync(pnpmLog, '');
    // A fresh environment: nothing from the caller's git hooks, git config, HOME or tools root.
    const env = {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        TMPDIR: os.tmpdir(),
        XDG_CONFIG_HOME: path.join(home, '.config'),
        LC_ALL: 'C',
        LANG: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        FAKE_PNPM_LOG: pnpmLog,
    };
    return {
        dir, home, env,
        pnpmCalls: () => readFileSync(pnpmLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    };
}

export function git(cwd, env, ...args) {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function runScript(cwd, env, script, ...args) {
    const result = spawnSync(process.execPath, [path.join(cwd, 'bruvish/scripts', script), ...args], { cwd, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr };
}

export function write(file, content) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
}

// Copies files of this repository (the code under test) into a fake checkout.
export function copyFromRepo(target, files) {
    for (const file of files) {
        mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
        cpSync(path.join(root, file), path.join(target, file));
    }
}

// A committed checkout with the install and rollback scripts and a fake build.
export function installCheckout(ws, version = '0.1.96') {
    const repo = path.join(ws.dir, 'checkout');
    mkdirSync(repo);
    git(repo, ws.env, 'init', '-q', '-b', 'carry');
    write(path.join(repo, 'package.json'), JSON.stringify({ name: 'lavish-axi', version }, null, 2) + '\n');
    write(path.join(repo, '.gitignore'), 'dist/\nnode_modules/\n');
    write(path.join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    write(path.join(repo, 'LICENSE'), 'MIT\n');
    write(path.join(repo, 'scripts/bruvish-build.js'), FAKE_BRUVISH_BUILD);
    copyFromRepo(repo, ['bruvish/lib/install.mjs', 'bruvish/scripts/install', 'bruvish/scripts/rollback', 'app/protocol.cjs']);
    git(repo, ws.env, 'add', '-A');
    git(repo, ws.env, 'commit', '-q', '-m', 'carry');
    return repo;
}

export function exists(...parts) {
    return existsSync(path.join(...parts));
}
