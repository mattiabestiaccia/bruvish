// `lavish-axi design` prints the personal style guide, which is never committed: a local copy
// (BRUVISH_DESIGN or the build's dist/bruvish-design.md) or a clear error when it is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DESIGN_MISSING } from '../lib/cli.mjs';
import { isolatedEnvironment, sourceCli } from '../test-helpers/runtime.mjs';

test('design prints the local guide and fails clearly without it', { timeout: 30000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bruvish-design-'));
    const run = (design) => spawnSync(process.execPath, [sourceCli, 'design'], {
        env: { ...process.env, ...isolatedEnvironment(directory), LAVISH_AXI_STATE_DIR: path.join(directory, 'state'), BRUVISH_DESIGN: design },
        encoding: 'utf8',
    });
    try {
        const guide = path.join(directory, 'DESIGN.md');
        await writeFile(guide, '# Guida locale\n');
        const present = run(guide);
        assert.equal(present.status, 0, present.stderr);
        assert.equal(present.stdout, '# Guida locale\n\n');
        const missing = run(path.join(directory, 'absent.md'));
        assert.equal(missing.status, 1);
        assert.equal(missing.stdout, '');
        assert.equal(missing.stderr.trim(), DESIGN_MISSING);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
