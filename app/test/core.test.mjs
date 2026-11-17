import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {createCore}=require('../core.cjs');
test('opening catalog review delegates only to canonical core and never silently reopens user-ended review',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lavish-core-'));try{
  const file=path.join(dir,'one.html');await writeFile(file,'<p>fixture</p>');await mkdir(path.join(dir,'state'));
  await writeFile(path.join(dir,'state/state.json'),JSON.stringify({sessions:{aaaaaaaaaaaaaaaa:{file,status:'ended',ended_by:'user'}}}));
  const calls=[];const core=createCore({stateDirectory:path.join(dir,'state'),port:4388,coreDirectory:dir,run:async args=>{calls.push(args);return {code:0,stdout:'session:\n  url: "http://127.0.0.1:4388/session/aaaaaaaaaaaaaaaa"\n  status: opened\n'};}});
  assert.deepEqual(await core.openRegistered('aaaaaaaaaaaaaaaa'),{requiresReopen:true});assert.equal(calls.length,0);
  const opened=await core.openRegistered('aaaaaaaaaaaaaaaa',{reopen:true});assert.equal(opened.url,'http://127.0.0.1:4388/session/aaaaaaaaaaaaaaaa');assert.deepEqual(calls[0],[file,'--no-open','--reopen']);
  await assert.rejects(core.openRegistered('bbbbbbbbbbbbbbbb'),/not registered/);assert.equal(calls.length,1);
  const blocked=createCore({stateDirectory:path.join(dir,'state'),port:4388,coreDirectory:dir,run:async()=>({code:0,stdout:'session:\n  status: user-ended\n'})});assert.deepEqual(await blocked.openFile(file),{requiresReopen:true});
 }finally{await rm(dir,{recursive:true,force:true});}
});
