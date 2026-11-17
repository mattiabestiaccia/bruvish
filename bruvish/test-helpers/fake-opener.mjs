// Preload (NODE_OPTIONS=--import=<this file>) for a test server. The server's opening runs as usual
// up to the launch of the surface program (Chrome through /usr/bin/open, or app/open.mjs); that
// launch is appended to TEST_OPENED as one JSON line instead, so no app or browser ever opens.
// TEST_OPEN_EXIT and TEST_OPEN_STDERR make the recorded launch fail.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

const original = childProcess.spawn;
export const isSurfaceLaunch = (command, args) => command === '/usr/bin/open' ||
    (command === process.execPath && /app[\\/]open\.mjs$/.test(String(args?.[0] || '')));

childProcess.spawn = function (command, args, ...rest) {
    if (!isSurfaceLaunch(command, args)) return original.call(this, command, args, ...rest);
    appendFileSync(process.env.TEST_OPENED, JSON.stringify({ command, args }) + '\n');
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
        child.stdout.end();
        child.stderr.end(process.env.TEST_OPEN_STDERR || '');
        child.emit('close', Number(process.env.TEST_OPEN_EXIT || 0), null);
    });
    return child;
};
syncBuiltinESMExports();
