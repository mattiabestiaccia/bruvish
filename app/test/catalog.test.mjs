import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {listReviews,findReview}=require('../catalog.cjs');
test('catalog reads only registered reviews, deduplicates aliases and preserves closed/missing states',async()=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'lavish-catalog-')));
 try{
  const file=path.join(dir,'Decisione.html'),alias=path.join(dir,'alias.html'),missing=path.join(dir,'missing.html');await writeFile(file,'<title>Never executed</title>');await symlink(file,alias);
  const state=path.join(dir,'state');await mkdir(state);
  const sessions={aaaaaaaaaaaaaaaa:{key:'aaaaaaaaaaaaaaaa',file,updated_at:'2026-01-01',status:'active'},bbbbbbbbbbbbbbbb:{key:'bbbbbbbbbbbbbbbb',file:alias,updated_at:'2026-02-01',status:'ended',ended_by:'user'},cccccccccccccccc:{key:'cccccccccccccccc',file:missing,status:'active'}};
  await writeFile(path.join(state,'state.json'),JSON.stringify({sessions}));const before=await readFile(path.join(state,'state.json'));
  const rows=await listReviews(state);assert.equal(rows.length,2);const row=rows.find(r=>r.available);assert.equal(row.file,file);assert.equal(row.key,'bbbbbbbbbbbbbbbb');assert.equal(row.endedBy,'user');assert.equal(row.status,'ended');assert.equal(rows.find(r=>!r.available).name,'missing');
  assert.equal((await findReview(state,'aaaaaaaaaaaaaaaa')).file,file,'an alias key still resolves its registered entry');
  await assert.rejects(findReview(state,'dddddddddddddddd'),/not registered/);assert.deepEqual(await readFile(path.join(state,'state.json')),before);
  assert.deepEqual(await listReviews(path.join(dir,'absent')),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
