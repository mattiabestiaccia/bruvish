import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openingTarget } from '../lib/open.mjs';
test('normal Chrome tab is the default when no shared preference exists', t => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lavish-opening-'));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const env = {LAVISH_MB_OPENING_CONFIG: path.join(directory, 'absent.json')};
    assert.deepEqual(openingTarget('http://127.0.0.1:4388/session/test', '/tmp/a b.html', undefined, env), {
        command: '/usr/bin/open', args: ['-a', 'Google Chrome', 'http://127.0.0.1:4388/session/test']
    });
    assert.throws(() => openingTarget('file:///etc/passwd', '/tmp/a.html'), /HTTP/);
});
test('an explicit adapter receives URL and path as separate arguments', () => {
    assert.deepEqual(openingTarget('http://127.0.0.1:4388/session/test', '/tmp/a b.html', '/tmp/adapter'), {
        command: '/tmp/adapter', args: ['http://127.0.0.1:4388/session/test', '/tmp/a b.html']
    });
});
