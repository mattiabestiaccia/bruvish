// Preload (NODE_OPTIONS=--import=<this file>) for app/open.mjs. It replaces the launch through
// /usr/bin/open, so no real app opens and LaunchServices is not needed. The call is appended to
// FAKE_OPEN_RECORD as one JSON line; then, like LaunchServices for a sandboxed caller, the bundle
// executable starts detached with no arguments, no stdio and none of the caller's environment: only
// PATH, HOME and the app's own state directory (FAKE_APP_STATE_DIR). FAKE_OPEN_EXIT and
// FAKE_OPEN_STDERR make the launch fail without starting anything.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

const original = childProcess.spawn;

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
        const bundle = args[args.indexOf('-a') + 1];
        const info = JSON.parse(fs.readFileSync(bundle + '.lavish-build.json', 'utf8'));
        const app = original(path.join(bundle, 'Contents/MacOS', info.executable), [],
            { env: { PATH: process.env.PATH, HOME: process.env.HOME, LAVISH_APP_STATE_DIR: process.env.FAKE_APP_STATE_DIR }, detached: true, stdio: 'ignore' });
        app.unref();
    }
    setImmediate(() => {
        child.stdout.end();
        child.stderr.end(process.env.FAKE_OPEN_STDERR || '');
        child.emit('close', exit, null);
    });
    return child;
};
syncBuiltinESMExports();
