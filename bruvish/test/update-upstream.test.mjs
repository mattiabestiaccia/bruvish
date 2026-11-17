// bruvish/scripts/update-upstream, offline: a fake upstream repository with lavish-axi-v* tags, a
// fake fork whose carry branch has the hooks and the script, and a fake pnpm for the checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { HOOKS } from '../lib/hooks.mjs';
import { conflictHunks, latestTag, parseTag } from '../lib/update.mjs';
import { copyFromRepo, git, runScript, workspace, write } from '../test-helpers/scripts.mjs';

const LINES = 50;
const original = (file) => Array.from({ length: LINES }, (_, i) => `${file} line ${i + 1}`);

function writeLines(repo, file, lines) {
    write(path.join(repo, file), lines.join('\n') + '\n');
}

function commitAll(repo, env, message) {
    git(repo, env, 'add', '-A');
    git(repo, env, 'commit', '-q', '-m', message);
}

function release(ws, version, edit = () => {}) {
    edit(ws.upstream);
    write(path.join(ws.upstream, 'package.json'), JSON.stringify({ name: 'lavish-axi', version }) + '\n');
    commitAll(ws.upstream, ws.env, `release ${version}`);
    git(ws.upstream, ws.env, 'tag', `lavish-axi-v${version}`);
}

// Upstream at 0.1.8, and a fork whose carry adds one marker line per hook (after lines 10, 20, 30)
// plus the script.
function setup() {
    const ws = workspace('bruvish-update-');
    ws.upstream = path.join(ws.dir, 'upstream');
    ws.fork = path.join(ws.dir, 'fork');
    mkdirSync(ws.upstream);
    mkdirSync(ws.fork);
    git(ws.upstream, ws.env, 'init', '-q', '-b', 'main');
    for (const file of Object.keys(HOOKS)) writeLines(ws.upstream, file, original(file));
    write(path.join(ws.upstream, 'AGENTS.md'), '# Agents\n');
    write(path.join(ws.upstream, 'CLAUDE.md'), '@AGENTS.md\n');
    write(path.join(ws.upstream, 'README.md'), '# Lavish\n');
    release(ws, '0.1.8');

    git(ws.fork, ws.env, 'init', '-q', '-b', 'main');
    git(ws.fork, ws.env, 'remote', 'add', 'upstream', ws.upstream);
    git(ws.fork, ws.env, 'fetch', '-q', 'upstream', '--tags');
    git(ws.fork, ws.env, 'switch', '-q', '-c', 'carry', 'lavish-axi-v0.1.8');
    for (const [file, ids] of Object.entries(HOOKS)) {
        const lines = original(file);
        ids.forEach((id, index) => lines.splice(10 * (index + 1) + index, 0, `# BRUVISH:hook ${id}`));
        writeLines(ws.fork, file, lines);
    }
    copyFromRepo(ws.fork, ['bruvish/lib/update.mjs', 'bruvish/lib/hooks.mjs', 'bruvish/scripts/update-upstream']);
    commitAll(ws.fork, ws.env, 'carry delta');
    ws.carry = git(ws.fork, ws.env, 'rev-parse', 'carry');
    return ws;
}

const cleanup = (ws) => rmSync(ws.dir, { recursive: true, force: true });
const update = (ws, ...args) => runScript(ws.fork, ws.env, 'update-upstream', ...args);
const branch = (ws) => git(ws.fork, ws.env, 'branch', '--show-current');
const parents = (ws, ref = 'HEAD') => git(ws.fork, ws.env, 'rev-list', '--parents', '-n', '1', ref).split(' ').slice(1);
const checks = (ws) => ws.pnpmCalls().map(call => call.args.join(' '));
// The Bruvish-Agent-Config trailer of the merge commit, as git itself parses trailers.
const trailer = (ws) => git(ws.fork, ws.env, 'log', '-1', '--format=%(trailers:key=Bruvish-Agent-Config,valueonly)', 'HEAD');
const editLine = (file, number, text) => (repo) => {
    const lines = original(file);
    lines[number - 1] = text;
    writeLines(repo, file, lines);
};

test('tag helpers: numeric order, accepted spellings, conflict hunk size', () => {
    assert.equal(latestTag(['lavish-axi-v0.1.9', 'lavish-axi-v0.1.10', 'lavish-axi-v0.1.8', 'v9.9.9', 'lavish-axi-v1.0.0-rc.1']), 'lavish-axi-v0.1.10');
    assert.equal(latestTag([]), null);
    for (const value of ['0.1.97', 'v0.1.97', 'lavish-axi-v0.1.97']) assert.equal(parseTag(value), 'lavish-axi-v0.1.97');
    assert.throws(() => parseTag('main'));
    const text = ['a', '<<<<<<< HEAD', 'ours 1', 'ours 2', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> tag', 'b'].join('\n');
    assert.deepEqual(conflictHunks(text), [{ line: 2, lines: 3 }]);
});

test('merges the latest release into update/vX.Y.Z with --no-ff and rerere, runs the checks, pushes nothing', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', (repo) => write(path.join(repo, 'README.md'), '# Lavish 0.1.9\n'));
        release(ws, '0.1.10', editLine('src/cli.js', 40, 'upstream change far from the hooks'));
        const result = update(ws);
        assert.equal(result.status, 0, result.output);
        assert.equal(branch(ws), 'update/v0.1.10', 'numeric order: 0.1.10 is newer than 0.1.9');
        assert.deepEqual(parents(ws), [ws.carry, git(ws.fork, ws.env, 'rev-parse', 'lavish-axi-v0.1.10^{commit}')]);
        assert.equal(git(ws.fork, ws.env, 'rev-parse', 'carry'), ws.carry, 'carry is untouched');
        assert.equal(git(ws.fork, ws.env, 'config', 'rerere.enabled'), 'true');
        assert.match(readFileSync(path.join(ws.fork, 'src/cli.js'), 'utf8'), /upstream change far from the hooks/);
        assert.deepEqual(checks(ws), ['install --frozen-lockfile', 'run check']);
        assert.match(result.stdout, /Nothing was pushed or installed/);
        assert.equal(trailer(ws), '', 'no agent-configuration trailer');
        assert.equal(git(ws.fork, ws.env, 'status', '--porcelain'), '');

        const again = update(ws, '0.1.10');
        assert.equal(again.status, 1, 'the branch already exists');
        assert.match(again.stderr, /already exists/);
    } finally {
        cleanup(ws);
    }
});

test('a small conflict at a hook stops for resolution; --continue commits and checks; rerere remembers it', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', editLine('src/cli.js', 10, 'upstream rewrote line 10'));
        git(ws.fork, ws.env, 'fetch', '-q', 'upstream', '--tags');
        let result = update(ws, '--no-fetch', '0.1.9');
        assert.equal(result.status, 3, result.output);
        assert.match(result.stderr, /Conflicts to resolve at hooks:\n {2}src\/cli\.js: line \d+/);
        assert.ok(existsSync(path.join(ws.fork, '.git/MERGE_HEAD')), 'the merge is left in progress');
        assert.deepEqual(checks(ws), [], 'no checks before the resolution');

        result = update(ws, '--continue');
        assert.equal(result.status, 3, 'still unresolved');
        assert.match(result.stderr, /Still unresolved:\n {2}src\/cli\.js/);

        // The resolution an agent makes: upstream's new line, then the hook back.
        const resolved = original('src/cli.js');
        resolved[9] = 'upstream rewrote line 10';
        resolved.splice(10, 0, '# BRUVISH:hook open-import');
        resolved.splice(21, 0, '# BRUVISH:hook open-present');
        writeLines(ws.fork, 'src/cli.js', resolved);
        git(ws.fork, ws.env, 'add', 'src/cli.js');
        result = update(ws, '--continue');
        assert.equal(result.status, 0, result.output);
        assert.equal(parents(ws).length, 2, 'a merge commit');
        assert.deepEqual(checks(ws), ['install --frozen-lockfile', 'run check']);

        // The same conflict again (a fresh branch from carry): rerere replays the resolution.
        git(ws.fork, ws.env, 'switch', '-q', 'carry');
        git(ws.fork, ws.env, 'branch', '-q', '-D', 'update/v0.1.9');
        result = update(ws, '--no-fetch', '0.1.9');
        assert.equal(result.status, 0, result.output);
        assert.equal(readFileSync(path.join(ws.fork, 'src/cli.js'), 'utf8'), resolved.join('\n') + '\n');
    } finally {
        cleanup(ws);
    }
});

test('a conflict resolved without its hook marker needs a decision', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', editLine('src/cli.js', 10, 'upstream rewrote line 10'));
        assert.equal(update(ws).status, 3);
        git(ws.fork, ws.env, 'checkout', '--theirs', 'src/cli.js');
        git(ws.fork, ws.env, 'add', 'src/cli.js');
        const result = update(ws, '--continue');
        assert.equal(result.status, 2, result.output);
        assert.match(result.stderr, /^needs-decision: a BRUVISH:hook marker moved or vanished/m);
        assert.match(result.stderr, /src\/cli\.js: expected one BRUVISH:hook open-import, found 0/);
        assert.deepEqual(checks(ws), [], 'no checks after a vanished hook');
    } finally {
        cleanup(ws);
    }
});

test('a conflict over the line limit at a hook needs a decision', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', (repo) => {
            const lines = original('src/server.js');
            for (let i = 0; i < 45; i++) lines[i] = `rewritten upstream ${i}`;
            writeLines(repo, 'src/server.js', lines);
        });
        const result = update(ws);
        assert.equal(result.status, 2, result.output);
        assert.match(result.stderr, /^needs-decision: the merge needs more than putting hooks back/m);
        assert.match(result.stderr, /src\/server\.js:\d+: conflict of \d+ lines \(limit 30 at a hook\)/);
        assert.match(result.stderr, /git merge --abort/);
    } finally {
        cleanup(ws);
    }
});

test('a hook file deleted upstream needs a decision', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', (repo) => rmSync(path.join(repo, '.github/workflows/release-please.yml')));
        const result = update(ws);
        assert.equal(result.status, 2, result.output);
        assert.match(result.stderr, /\.github\/workflows\/release-please\.yml: the file was deleted, renamed or replaced upstream/);
    } finally {
        cleanup(ws);
    }
});

test('a release that changes agent configuration stops before merging and shows the differences', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', (repo) => {
            write(path.join(repo, 'AGENTS.md'), '# Agents\nNew upstream instruction.\n');
            write(path.join(repo, 'docs/.claude/settings.json'), '{}\n');
        });
        let result = update(ws);
        assert.equal(result.status, 2, result.output);
        assert.match(result.stderr, /^needs-decision: lavish-axi-v0\.1\.9 changes AGENTS\.md, docs\/\.claude\/settings\.json\. Nothing was merged/m);
        assert.match(result.stdout, /\+New upstream instruction\./, 'the full diff is shown');
        assert.equal(branch(ws), 'carry');
        assert.equal(git(ws.fork, ws.env, 'branch', '--list', 'update/*'), '', 'no branch was created');

        for (const reason of [[], [''], ['--no-fetch'], ['two\nlines']]) {
            result = update(ws, '--no-fetch', '0.1.9', '--allow-agent-config', ...reason);
            assert.equal(result.status, 1, `a reason is required: ${JSON.stringify(reason)}`);
            assert.match(result.stderr, /--allow-agent-config needs a reason/);
        }
        assert.equal(branch(ws), 'carry');

        // merge.log would append a shortlog after the trailer paragraph; the trailer must stay last.
        git(ws.fork, ws.env, 'config', 'merge.log', 'true');
        result = update(ws, '--no-fetch', '--allow-agent-config', 'reviewed by Mattia: new upstream instruction is fine');
        assert.equal(result.status, 0, result.output);
        assert.equal(branch(ws), 'update/v0.1.9');
        const expected = 'AGENTS.md, docs/.claude/settings.json; reason: reviewed by Mattia: new upstream instruction is fine';
        assert.equal(trailer(ws), expected);
        assert.match(result.stdout, /the pull request must cite Bruvish-Agent-Config:/);
    } finally {
        cleanup(ws);
    }
});

test('the agent-configuration trailer survives a conflict resolved with --continue', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9', (repo) => {
            write(path.join(repo, 'AGENTS.md'), '# Agents\nNew upstream instruction.\n');
            editLine('src/cli.js', 10, 'upstream rewrote line 10')(repo);
        });
        git(ws.fork, ws.env, 'config', 'merge.log', 'true');
        let result = update(ws, '--allow-agent-config', 'reviewed');
        assert.equal(result.status, 3, result.output);
        const resolved = original('src/cli.js');
        resolved[9] = 'upstream rewrote line 10';
        resolved.splice(10, 0, '# BRUVISH:hook open-import');
        resolved.splice(21, 0, '# BRUVISH:hook open-present');
        writeLines(ws.fork, 'src/cli.js', resolved);
        git(ws.fork, ws.env, 'add', 'src/cli.js');
        result = update(ws, '--continue');
        assert.equal(result.status, 0, result.output);
        assert.equal(trailer(ws), 'AGENTS.md; reason: reviewed');
        assert.match(result.stdout, /the pull request must cite Bruvish-Agent-Config: AGENTS\.md; reason: reviewed/);
    } finally {
        cleanup(ws);
    }
});

test('the base is the local carry branch only', () => {
    const ws = setup();
    try {
        release(ws, '0.1.9');
        let result = update(ws, '--base', 'carry');
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Unexpected argument: --base/);

        git(ws.fork, ws.env, 'switch', '-q', '-c', 'other');
        git(ws.fork, ws.env, 'branch', '-q', '-D', 'carry');
        result = update(ws);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /No local carry branch/);
    } finally {
        cleanup(ws);
    }
});

test('failing checks stop with exit 4; refuses a dirty tree; nothing to do when carry has the tag', () => {
    const ws = setup();
    try {
        let result = update(ws, '0.1.8');
        assert.equal(result.status, 0, result.output);
        assert.match(result.stdout, /already contains lavish-axi-v0\.1\.8/);

        release(ws, '0.1.9');
        write(path.join(ws.fork, 'scratch.txt'), 'x\n');
        result = update(ws);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /not clean/);
        rmSync(path.join(ws.fork, 'scratch.txt'));

        result = runScript(ws.fork, { ...ws.env, FAKE_PNPM_FAIL: 'run check' }, 'update-upstream');
        assert.equal(result.status, 4, result.output);
        assert.match(result.stderr, /checks failed at: pnpm run check/);
        assert.equal(branch(ws), 'update/v0.1.9');

        result = update(ws, '--continue');
        assert.equal(result.status, 0, 'rerun of the checks once fixed');
    } finally {
        cleanup(ws);
    }
});
