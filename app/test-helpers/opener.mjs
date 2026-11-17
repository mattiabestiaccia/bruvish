// Fixtures for the app opener tests: a private Bruvish.app whose executable is a Node script, with a
// build receipt that verifyBundle accepts, and a run of app/open.mjs whose /usr/bin/open is replaced by
// fake-launchservices.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import protocol from '../protocol.cjs';

export const source = new URL('../', import.meta.url).pathname;
export const opener = new URL('../open.mjs', import.meta.url).pathname;
export const fakeLaunchServices = new URL('./fake-launchservices.mjs', import.meta.url).pathname;
export const reviewUrl = 'http://127.0.0.1:4389/session/1234567890abcdef';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// `script` is the CommonJS body of the app executable.
export function makeBundle(dir, script) {
    const bundle = path.join(dir, 'Bruvish.app'), executable = path.join(bundle, 'Contents/MacOS/Bruvish');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!' + process.execPath + '\n' + script + '\n', { mode: 0o755 });
    const code = {};
    for (const name of protocol.codeFiles(source)) {
        const target = path.join(bundle, 'Contents/Resources/app', name), bytes = fs.readFileSync(path.join(source, name));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
        code[name] = hash(bytes);
    }
    fs.writeFileSync(bundle + '.lavish-build.json', JSON.stringify({ electron: '44.2.0', identity: 'fixture', executable: 'Bruvish', executableSha256: hash(fs.readFileSync(executable)), code }));
    return bundle;
}

// An app that acknowledges the request in argv the way main.cjs does, with `appCode`, and reports
// what it received from its environment.
export function acknowledgingApp(appCode = protocol.codeIdentity(source)) {
    return `const fs=require('node:fs'),path=require('node:path');const [url,file,id]=process.argv.slice(-3),root=process.env.LAVISH_APP_STATE_DIR;
console.log('fixture app started for '+id);
const ack=path.join(root,'requests',id+'.json');
fs.writeFileSync(ack+'.tmp',JSON.stringify({status:'opened',surface:'dedicated-electron',pid:process.pid,appCode:${JSON.stringify(appCode)},url,file,profile:path.join(root,'profile'),
  environment:Object.fromEntries(['ELECTRON_RUN_AS_NODE','LAVISH_AXI_PORT','LAVISH_AXI_HTML_APP_TOKEN'].map(name=>[name,process.env[name]??null]))}));
fs.renameSync(ack+'.tmp',ack);`;
}

export function runOpener(dir, bundle, file, env = {}) {
    const root = path.join(dir, 'state'), record = path.join(dir, 'open-calls.jsonl');
    fs.mkdirSync(root, { recursive: true });
    const result = spawnSync(process.execPath, [opener, reviewUrl, file], {
        env: { ...process.env, NODE_OPTIONS: '--import=' + fakeLaunchServices, FAKE_OPEN_RECORD: record, LAVISH_APP_BUNDLE: bundle, LAVISH_APP_STATE_DIR: root, LAVISH_APP_ACK_TIMEOUT_MS: '5000', ...env },
        encoding: 'utf8', timeout: 20000
    });
    const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    return { ...result, root, calls };
}
