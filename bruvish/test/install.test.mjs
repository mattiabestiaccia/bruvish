// bruvish/scripts/install and bruvish/scripts/rollback, offline, against a fake checkout and a fake
// HOME: the default tools root is $HOME/tools, so nothing is written to the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import protocol from '../../app/protocol.cjs';
import { installRoot } from '../lib/install.mjs';
import { exists, git, installCheckout, runScript, workspace, write } from '../test-helpers/scripts.mjs';

function tools(ws) {
    return path.join(ws.home, 'tools/bruvish');
}

function link(ws, name) {
    try { return readlinkSync(path.join(tools(ws), name)); } catch { return null; }
}

// The installed command, through the links, answers the upstream version.
function versionOf(command, env) {
    const result = spawnSync(process.execPath, [command, '--version'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function commitChange(ws, repo, file, content) {
    write(path.join(repo, file), content);
    git(repo, ws.env, 'add', '-A');
    git(repo, ws.env, 'commit', '-q', '-m', 'change ' + file);
    return git(repo, ws.env, 'rev-parse', 'HEAD').slice(0, 7);
}

test('install builds, installs under $HOME/tools/bruvish, verifies and links current', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        const sha = git(repo, ws.env, 'rev-parse', 'HEAD').slice(0, 7);
        const result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        const name = `0.1.96-${sha}`;
        const target = path.join(tools(ws), name);
        for (const part of ['dist/bruvish-manifest.json', 'dist/bruvish.mjs', 'bin/lavish-axi', 'bruvish/scripts/rollback', 'app/protocol.cjs', 'node_modules/fake-dep', 'package.json', 'LICENSE']) {
            assert.ok(exists(target, part), part);
        }
        // The plugin root the bundle resolves (dist/..) holds what package.json "files" ships for it.
        for (const part of ['plugin.json', 'skills/lavish/SKILL.md']) {
            assert.ok(exists(target, part), `${part}: lavish-axi setup plugin needs it beside dist/`);
        }
        assert.ok(!exists(target, 'scripts'), 'only the delta and the build are installed');
        assert.equal(link(ws, 'current'), name, 'relative link');
        assert.equal(link(ws, 'previous'), null);
        assert.equal(versionOf(path.join(tools(ws), 'current/bin/lavish-axi'), ws.env), '0.1.96');
        // Only the tools root was written in HOME, and no staging folder is left behind.
        assert.deepEqual(readdirSync(ws.home), ['tools']);
        assert.deepEqual(readdirSync(tools(ws)).sort(), [name, 'current'].sort());
        const calls = ws.pnpmCalls();
        assert.deepEqual(calls[0], { cwd: repo, args: ['run', 'build'] });
        assert.deepEqual(calls[1].args, ['install', '--prod', '--frozen-lockfile', '--offline', '--ignore-scripts']);
        assert.ok(calls[1].cwd.startsWith(tools(ws) + path.sep), 'production dependencies are installed in the staging folder');
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('install --no-switch leaves current; a later install switches and keeps previous; rollback swaps back', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        const first = `0.1.96-${git(repo, ws.env, 'rev-parse', 'HEAD').slice(0, 7)}`;
        assert.equal(runScript(repo, ws.env, 'install').status, 0);
        const second = `0.1.97-${commitChange(ws, repo, 'package.json', JSON.stringify({ name: 'lavish-axi', version: '0.1.97' }) + '\n')}`;

        let result = runScript(repo, ws.env, 'install', '--no-switch');
        assert.equal(result.status, 0, result.output);
        assert.ok(exists(tools(ws), second, 'bin/lavish-axi'));
        assert.equal(link(ws, 'current'), first, '--no-switch keeps current');
        assert.equal(link(ws, 'previous'), null);

        result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /already installed and verified/);
        assert.equal(link(ws, 'current'), second);
        assert.equal(link(ws, 'previous'), first);
        assert.equal(versionOf(path.join(tools(ws), 'current/bin/lavish-axi'), ws.env), '0.1.97');

        result = runScript(repo, ws.env, 'rollback');
        assert.equal(result.status, 0, result.output);
        assert.equal(link(ws, 'current'), first);
        assert.equal(link(ws, 'previous'), second, 'a second rollback returns to the newer build');
        assert.equal(versionOf(path.join(tools(ws), 'current/bin/lavish-axi'), ws.env), '0.1.96');
        assert.ok(exists(tools(ws), first) && exists(tools(ws), second), 'rollback deletes nothing');
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('another build of the same commit (a regenerated style guide) installs beside the existing folder', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        const first = `0.1.96-${git(repo, ws.env, 'rev-parse', 'HEAD').slice(0, 7)}`;
        assert.equal(runScript(repo, ws.env, 'install').status, 0);
        const firstManifest = readFileSync(path.join(tools(ws), first, 'dist/bruvish-manifest.json'), 'utf8');

        write(path.join(repo, 'bruvish/DESIGN.md'), '# Style guide\n');
        let result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        const identity = JSON.parse(readFileSync(path.join(repo, 'dist/bruvish-manifest.json'), 'utf8')).identity;
        const second = `${first}-${identity.slice(0, 6)}`;
        assert.ok(exists(tools(ws), second, 'dist/bruvish-design.md'));
        assert.equal(link(ws, 'current'), second);
        assert.equal(link(ws, 'previous'), first);
        assert.equal(readFileSync(path.join(tools(ws), first, 'dist/bruvish-manifest.json'), 'utf8'), firstManifest, 'the existing folder is untouched');
        assert.ok(!exists(tools(ws), first, 'dist/bruvish-design.md'));

        result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /already installed and verified/);
        assert.equal(link(ws, 'current'), second);
        assert.equal(link(ws, 'previous'), first);
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('install checks that the installed lavish-axi design prints the guide, and warns with the remedy when it does not', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        // No guide: the install still succeeds, and says what is missing and how to fix it.
        let result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        const first = link(ws, 'current');
        assert.match(result.stderr, /Warning: lavish-axi design does not print the style guide/);
        assert.match(result.stderr, /Bruvish style guide missing/);
        assert.match(result.stderr, /bruvish\/DESIGN\.placeholder\.md/);
        assert.doesNotMatch(result.stdout, /prints the style guide/);

        // With the guide: no warning, and the installed command prints it.
        write(path.join(repo, 'bruvish/DESIGN.md'), '# Style guide\n');
        result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 0, result.output);
        assert.doesNotMatch(result.stderr, /style guide/);
        assert.match(result.stdout, /lavish-axi design prints the style guide\./);
        const printed = spawnSync(process.execPath, [path.join(tools(ws), 'current/bin/lavish-axi'), 'design'], { env: ws.env, encoding: 'utf8' });
        assert.equal(printed.status, 0, printed.stderr);
        assert.match(printed.stdout, /# Style guide/);
        assert.notEqual(link(ws, 'current'), first, 'the guide makes another build of the same commit');
        assert.equal(link(ws, 'previous'), first);
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('the guide check ignores BRUVISH_DESIGN: it is about the installed copy', () => {
    const ws = workspace('bruvish-install-');
    try {
        const outside = path.join(ws.dir, 'elsewhere.md');
        write(outside, '# Not installed\n');
        const env = { ...ws.env, BRUVISH_DESIGN: outside };
        const result = runScript(installCheckout(ws), env, 'install');
        assert.equal(result.status, 0, result.output);
        assert.match(result.stderr, /Warning: lavish-axi design does not print the style guide/);
        const printed = spawnSync(process.execPath, [path.join(tools(ws), 'current/bin/lavish-axi'), 'design'], { env, encoding: 'utf8' });
        assert.equal(printed.status, 0, printed.stderr);
        assert.match(printed.stdout, /# Not installed/, 'the installed command honours BRUVISH_DESIGN');
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('BRUVISH_TOOLS_ROOT replaces ~/tools', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        const other = path.join(ws.dir, 'other-tools');
        const result = runScript(repo, { ...ws.env, BRUVISH_TOOLS_ROOT: other }, 'install');
        assert.equal(result.status, 0, result.output);
        assert.ok(exists(other, 'bruvish/current/bin/lavish-axi'));
        assert.deepEqual(readdirSync(ws.home), []);
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('install refuses a dirty checkout and a build that does not match its manifest', () => {
    const ws = workspace('bruvish-install-');
    try {
        const repo = installCheckout(ws);
        write(path.join(repo, 'bruvish/extra.mjs'), '// not committed\n');
        let result = runScript(repo, ws.env, 'install');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /not clean/);
        assert.deepEqual(ws.pnpmCalls(), [], 'nothing is built');
        unlinkSync(path.join(repo, 'bruvish/extra.mjs'));

        result = runScript(repo, { ...ws.env, FAKE_BUILD_CORRUPT: '1' }, 'install');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /does not match dist\/bruvish-manifest\.json/);
        assert.ok(!exists(ws.home, 'tools'), 'a build that fails verification installs nothing');
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('rollback refuses without previous and when previous does not verify, leaving current alone', () => {
    const ws = workspace('bruvish-install-');
    try {
        let result = runScript(installCheckout(ws), ws.env, 'rollback');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /No previous installation/);
        assert.ok(!exists(ws.home, 'tools'), 'rollback creates nothing');

        const repo = path.join(ws.dir, 'checkout');
        const first = `0.1.96-${git(repo, ws.env, 'rev-parse', 'HEAD').slice(0, 7)}`;
        assert.equal(runScript(repo, ws.env, 'install').status, 0);
        const second = `0.1.96-${commitChange(ws, repo, 'bruvish/note.md', 'second\n')}`;
        assert.equal(runScript(repo, ws.env, 'install').status, 0);
        rmSync(path.join(tools(ws), first, 'node_modules'), { recursive: true });

        result = runScript(repo, ws.env, 'rollback');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /node_modules missing/);
        assert.equal(link(ws, 'current'), second);
        assert.equal(link(ws, 'previous'), first);
    } finally {
        rmSync(ws.dir, { recursive: true, force: true });
    }
});

test('one tools root, ~/tools or BRUVISH_TOOLS_ROOT, for the installation, the app core and the engine', () => {
    assert.equal(protocol.toolsRoot({}), path.join(os.homedir(), 'tools'));
    const env = { BRUVISH_TOOLS_ROOT: '/opt/test-tools' };
    assert.equal(installRoot(env), '/opt/test-tools/bruvish');
    assert.equal(protocol.coreRoot(env), '/opt/test-tools/bruvish/current');
    assert.equal(protocol.engineApp(env), '/opt/test-tools/electron/44.2.0/Electron.app');
    assert.equal(protocol.coreRoot({ ...env, LAVISH_APP_CORE_ROOT: '/elsewhere' }), '/elsewhere');
});
