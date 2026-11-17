import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = new URL('../bin/bruvish.mjs', import.meta.url).pathname;
test('state applies an explicit answer delta and preserves other decisions and comments', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-mb-state-'));
    try {
        const state = path.join(dir, 'state.json'), delta = path.join(dir, 'delta.json');
        await writeFile(state, JSON.stringify({ revision: 2, answers: { a: { choice: 'yes' }, b: { note: 'keep' } }, comments: [{ id: 'c', text: 'old' }] }));
        await writeFile(delta, JSON.stringify({ answers: { a: { choice: 'no' } }, comments: [{ id: 'd', text: 'new' }] }));
        const r = spawnSync(process.execPath, [cli, 'state', 'apply', state, delta], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const saved = JSON.parse(await readFile(state, 'utf8'));
        assert.equal(saved.revision, 3);
        assert.deepEqual(saved.answers.b, { note: 'keep' });
        assert.deepEqual(saved.answers.a, { choice: 'no' });
        assert.equal(saved.comments.length, 2);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('render produces a standalone portable document from one content/state source', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lavish-mb-render-'));
    try {
        const input = path.join(dir, 'input.json'), output = path.join(dir, 'page.html');
        await writeFile(input, JSON.stringify({ title: 'A <review>', guide: 'Read, then respond.', state: { revision: 4, answers: { q: { choice: 'yes', note: 'Saved' } } }, sections: [{ id: 's', title: 'Section', cards: [{ id: 'q', title: 'Question', status: 'waiting', paragraphs: [['First sentence.', 'Second sentence.']], question: { options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } }] }] }));
        const r = spawnSync(process.execPath, [cli, 'render', input, '--output', output], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const html = await readFile(output, 'utf8');
        assert(html.startsWith('<!doctype html>'));
        assert(html.includes('A &lt;review&gt;'));
        assert(html.includes('data:font/'));
        assert(!html.includes('fonts.googleapis.com'));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('dark mode paints #1f2023, transparent mode leaves html/body without a full background, surfaces stay translucent', async () => {
  const css = await readFile(new URL('../assets/artifact.css', import.meta.url), 'utf8');
  assert.match(css.match(/:root\{([^}]*)\}/)[1], /--paper:#1f2023/);
  assert.match(css, /:root\[data-mb-mode=transparent\]\{--paper:transparent\}/);
  assert.match(css, /html\{background:var\(--paper\)\}/);
  assert.match(css, /body\{[^}]*background:var\(--paper\)/);
  assert.match(css, /:root:not\(\[data-mb-mode=transparent\]\) body::before\{[^}]*position:fixed[^}]*background:var\(--paper\)/);
  // An external html,body{background:#2a2b2e !important} (old manual fix) must not break the switch.
  assert.match(css, /:root\[data-mb-mode=transparent\],:root\[data-mb-mode=transparent\] body\{background:transparent!important\}/);
  assert.doesNotMatch(css, /data-mb-theme=light/, 'the light theme was removed by decision');
  for (const block of css.matchAll(/:root(?:\[data-mb-family=\w+\])?\{([^}]*)\}/g))
    for (const name of ['card', 'field']) {
      const value = block[1].match(new RegExp('--' + name + ':([^;}]*)'));
      if (value) assert.match(value[1], /^rgba\([^)]*,\s*0?\.\d+\)$/, name + ' must stay translucent');
    }
});
