import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {makeBundle,acknowledgingApp,runOpener,reviewUrl} from '../test-helpers/opener.mjs';
function fixture(prefix,script){const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),bundle=makeBundle(dir,script),file=path.join(dir,'dummy.html');fs.writeFileSync(file,'dummy');return {dir,bundle,file};}

test('the app is started through LaunchServices and takes the request from its state directory, not from argv or environment',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-',acknowledgingApp());try{
 const result=runOpener(dir,bundle,file,{ELECTRON_RUN_AS_NODE:'1',LAVISH_AXI_PORT:'4390'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(result.calls,[{command:'/usr/bin/open',args:['-a',bundle],ELECTRON_RUN_AS_NODE:null}],'open only starts or activates the bundle');
 const ack=JSON.parse(result.stdout);assert.equal(ack.status,'opened');assert.equal(ack.url,reviewUrl);assert.equal(ack.file,fs.realpathSync(file));
 assert.deepEqual(ack.argv,[]);assert.deepEqual(ack.environment,{ELECTRON_RUN_AS_NODE:null,LAVISH_AXI_PORT:null});
 assert.deepEqual(fs.readdirSync(path.join(result.root,'requests')),[],'request and acknowledgement are both consumed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('a launch that LaunchServices refuses fails clearly, withdraws the request and opens nothing else',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-fail-',acknowledgingApp());try{
 const result=runOpener(dir,bundle,file,{FAKE_OPEN_EXIT:'1',FAKE_OPEN_STDERR:'LSOpenURLsWithRole() failed with error -10810'});
 assert.equal(result.status,78,result.stderr);assert.equal(result.calls.length,1);
 assert.match(result.stderr,/^lavish-app: macOS could not launch Bruvish\.app: LSOpenURLsWithRole\(\) failed with error -10810\. Opening is not confirmed and no alternative browser was opened\./);
 assert.deepEqual(fs.readdirSync(path.join(result.root,'requests')),[]);
}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('an acknowledgement from different app code is refused',{timeout:25000},()=>{const {dir,bundle,file}=fixture('lavish-launch-code-',acknowledgingApp('0'.repeat(64)));try{
 const result=runOpener(dir,bundle,file);
 assert.equal(result.status,78,result.stderr);assert.match(result.stderr,/differs from maintained source/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}});
