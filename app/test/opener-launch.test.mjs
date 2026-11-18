import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {makeBundle,acknowledgingApp,runOpener,reviewUrl} from '../test-helpers/opener.mjs';import {parseOpen} from '../test-helpers/fake-launchservices.mjs';
function fixture(prefix,script){const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),bundle=makeBundle(dir,script),file=path.join(dir,'dummy.html');fs.writeFileSync(file,'dummy');return {dir,bundle,file};}

test('the app is launched through LaunchServices, outside the caller, with the request in argv',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-',acknowledgingApp());try{
 const result=runOpener(dir,bundle,file,{ELECTRON_RUN_AS_NODE:'1',LAVISH_AXI_PORT:'4390',LAVISH_AXI_HTML_APP_TOKEN:'not-for-the-app',LAVISH_APP_TEST_CDP:'1'});
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.calls.length,1);const [call]=result.calls,open=parseOpen(call.args),log=path.join(result.root,'app.log');
 assert.equal(call.command,'/usr/bin/open');
 assert.deepEqual(open.flags,['-n'],'a new instance hands the request to a running app through second-instance');
 assert.equal(open.app,bundle);
 assert.equal(open.args.length,3);assert.equal(open.args[0],reviewUrl);assert.equal(open.args[1],fs.realpathSync(file));assert.match(open.args[2],/^[0-9a-f-]{36}$/);
 assert.deepEqual(open.env,{LAVISH_APP_STATE_DIR:result.root,LAVISH_AXI_PORT:'4390'},'only the state directory and the settings the app reads are forwarded');
 assert.equal(open.stdout,log);assert.equal(open.stderr,log);
 assert.equal(call.ELECTRON_RUN_AS_NODE,null,'Node mode never reaches the launcher');
 const ack=JSON.parse(result.stdout);assert.equal(ack.status,'opened');assert.equal(ack.url,reviewUrl);assert.equal(ack.file,fs.realpathSync(file));
 assert.deepEqual(ack.environment,{ELECTRON_RUN_AS_NODE:null,LAVISH_AXI_PORT:'4390',LAVISH_AXI_HTML_APP_TOKEN:null});
 assert.match(fs.readFileSync(log,'utf8'),new RegExp('fixture app started for '+open.args[2]));
 assert.equal(fs.statSync(log).mode&0o777,0o600);
 assert.deepEqual(fs.readdirSync(path.join(result.root,'requests')),[],'the acknowledgement is consumed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('a launch that LaunchServices refuses fails clearly and opens nothing else',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-fail-',acknowledgingApp());try{
 const result=runOpener(dir,bundle,file,{FAKE_OPEN_EXIT:'1',FAKE_OPEN_STDERR:'LSOpenURLsWithRole() failed with error -10810'});
 assert.equal(result.status,78,result.stderr);assert.equal(result.calls.length,1);
 assert.match(result.stderr,/^lavish-app: macOS could not launch Bruvish\.app: LSOpenURLsWithRole\(\) failed with error -10810\. Opening is not confirmed and no alternative browser was opened\./);
}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('an acknowledgement from different app code is refused',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-code-',acknowledgingApp('0'.repeat(64)));try{
 const result=runOpener(dir,bundle,file);
 assert.equal(result.status,78,result.stderr);assert.match(result.stderr,/differs from maintained source/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}});
