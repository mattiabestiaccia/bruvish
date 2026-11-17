// Preload (NODE_OPTIONS=--import=<this file>) for app/open.mjs. It replaces the launch through
// /usr/bin/open, so no real app opens and LaunchServices is not needed. The call is appended to
// FAKE_OPEN_RECORD as one JSON line; then, like LaunchServices with `-n -a <bundle>`, the bundle
// executable starts detached with the --args argv, only the --env variables (plus PATH and HOME:
// the caller's environment does not reach it) and stdout/stderr appended to the --stdout/--stderr
// files. FAKE_OPEN_EXIT and FAKE_OPEN_STDERR make the launch fail without starting anything.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

const original = childProcess.spawn;

export function parseOpen(args) {
    const parsed = { flags: [], env: {}, args: [] };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--args') { parsed.args = args.slice(i + 1); break; }
        if (arg === '-a') parsed.app = args[++i];
        else if (arg === '--env') { const [name, ...value] = args[++i].split('='); parsed.env[name] = value.join('='); }
        else if (arg === '--stdout') parsed.stdout = args[++i];
        else if (arg === '--stderr') parsed.stderr = args[++i];
        else parsed.flags.push(arg);
    }
    return parsed;
}

childProcess.spawn = function (command, args, options, ...rest) {
    if (command !== '/usr/bin/open') return original.call(this, command, args, options, ...rest);
    fs.appendFileSync(process.env.FAKE_OPEN_RECORD, JSON.stringify({ command, args, ELECTRON_RUN_AS_NODE: options?.env?.ELECTRON_RUN_AS_NODE ?? null }) + '\n');
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.unref = () => {};
    child.kill = () => true;
    const exit = Number(process.env.FAKE_OPEN_EXIT || 0);
    if (!exit) {
        const open = parseOpen(args);
        const info = JSON.parse(fs.readFileSync(open.app + '.lavish-build.json', 'utf8'));
        const out = fs.openSync(open.stdout, 'a'), err = fs.openSync(open.stderr, 'a');
        const app = original(path.join(open.app, 'Contents/MacOS', info.executable), open.args,
            { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...open.env }, detached: true, stdio: ['ignore', out, err] });
        fs.closeSync(out); fs.closeSync(err); app.unref();
    }
    setImmediate(() => {
        child.stdout.end();
        child.stderr.end(process.env.FAKE_OPEN_STDERR || '');
        child.emit('close', exit, null);
    });
    return child;
};
syncBuiltinESMExports();
