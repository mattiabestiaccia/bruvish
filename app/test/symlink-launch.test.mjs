import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const appDir=new URL('../',import.meta.url).pathname;
// The tools folder launches scripts through a `current` symlink: the guard must compare real paths.
test('adopt.mjs and deploy.mjs run when launched through a symlinked folder',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bruvish-symlink-'));try{const link=path.join(dir,'current');fs.symlinkSync(appDir.replace(/\/$/,''),link);
 const adopt=spawnSync(process.execPath,[path.join(link,'adopt.mjs'),'plan','chrome'],{encoding:'utf8',env:{...process.env,HOME:dir}});assert.equal(adopt.status,0,adopt.stderr);assert.equal(JSON.parse(adopt.stdout).surface,'chrome');
 const deploy=spawnSync(process.execPath,[path.join(link,'deploy.mjs'),'bogus'],{encoding:'utf8',env:{...process.env,HOME:dir}});assert.equal(deploy.status,1);assert.match(deploy.stderr,/Usage: node app\/deploy\.mjs/);
 const direct=spawnSync(process.execPath,[path.join(appDir,'adopt.mjs'),'plan','chrome'],{encoding:'utf8',env:{...process.env,HOME:dir}});assert.equal(direct.status,0,direct.stderr);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
