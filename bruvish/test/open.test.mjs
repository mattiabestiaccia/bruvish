import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openingTarget, openSurface } from '../lib/opening.mjs';
test('normal Chrome tab is the default when no shared preference exists', t => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lavish-opening-'));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const env = {LAVISH_MB_OPENING_CONFIG: path.join(directory, 'absent.json')};
    assert.deepEqual(openingTarget('http://127.0.0.1:4388/session/test', '/tmp/a b.html', env), {
        command: '/usr/bin/open', args: ['-a', 'Google Chrome', 'http://127.0.0.1:4388/session/test']
    });
    assert.throws(() => openingTarget('file:///etc/passwd', '/tmp/a.html', env), /HTTP/);
});
test('the former adapter variable no longer chooses the program', t => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lavish-opening-'));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const env = {LAVISH_MB_OPENING_CONFIG: path.join(directory, 'absent.json'), LAVISH_MB_OPEN_ADAPTER: '/tmp/adapter'};
    assert.equal(openingTarget('http://127.0.0.1:4388/session/test', '/tmp/a.html', env).command, '/usr/bin/open');
});
test('openSurface reports the launch result without throwing', async t => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lavish-opening-'));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const env = {LAVISH_MB_OPENING_CONFIG: path.join(directory, 'absent.json')};
    const url = 'http://127.0.0.1:4388/session/0123456789abcdef', launches = [];
    const result = async (value) => openSurface(url, '/tmp/a.html', {env, run: async (command, args) => { launches.push([command, args]); return value; }});
    assert.deepEqual(await result({code: 0, stderr: ''}), {status: 'opened'});
    assert.deepEqual(launches[0], ['/usr/bin/open', ['-a', 'Google Chrome', url]]);
    assert.deepEqual(await result({code: 78, stderr: 'lavish-app: refused\n'}), {status: 'failed', reason: 'lavish-app: refused'});
    assert.deepEqual(await result({code: null, signal: 'SIGTERM', stderr: '', timedOut: true}), {status: 'failed', reason: 'The opening surface did not finish in time; it was stopped.'});
    assert.match((await result({code: 1, stderr: 'x'.repeat(5000)})).reason, /^…x{1000}$/);
    assert.deepEqual(await openSurface(url, '/tmp/a.html', {env, run: async () => { throw new Error('spawn EPERM'); }}), {status: 'failed', reason: 'Bruvish could not start the opening surface: spawn EPERM'});
    assert.match((await openSurface('file:///etc/passwd', '/tmp/a.html', {env, run: async () => ({code: 0})})).reason, /HTTP/);
});
