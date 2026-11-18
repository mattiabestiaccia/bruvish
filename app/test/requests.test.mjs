import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import protocol from '../protocol.cjs';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
test('takeRequests takes each pending request once and leaves acknowledgements and partial writes alone',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'lavish-requests-'));try{
 assert.deepEqual(protocol.takeRequests(root),[],'no requests folder yet');
 const dir=path.join(root,'requests');fs.mkdirSync(dir);
 assert.equal(protocol.requestPath(root,ids[0]),path.join(dir,ids[0]+'.request.json'));
 fs.writeFileSync(protocol.requestPath(root,ids[1]),JSON.stringify({url:'http://127.0.0.1:4388/session/1234567890abcdef',file:'/tmp/b.html'}));
 fs.writeFileSync(protocol.requestPath(root,ids[0]),JSON.stringify({url:'http://127.0.0.1:4388/session/abcdef1234567890',file:'/tmp/a.html'}));
 fs.writeFileSync(protocol.requestPath(root,ids[2]),'{not json');
 const kept=[ids[0]+'.json',ids[1]+'.request.json.tmp','notes.request.json'];for(const name of kept)fs.writeFileSync(path.join(dir,name),'{}');
 assert.deepEqual(protocol.takeRequests(root),[
  {id:ids[0],url:'http://127.0.0.1:4388/session/abcdef1234567890',file:'/tmp/a.html'},
  {id:ids[1],url:'http://127.0.0.1:4388/session/1234567890abcdef',file:'/tmp/b.html'},
  {id:ids[2],error:'Malformed review request'}]);
 assert.deepEqual(fs.readdirSync(dir).sort(),kept.sort());
 assert.deepEqual(protocol.takeRequests(root),[],'a request is taken only once');
}finally{fs.rmSync(root,{recursive:true,force:true});}});
