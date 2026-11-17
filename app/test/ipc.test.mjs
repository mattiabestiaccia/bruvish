import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {authorizeUi}=require('../ipc.cjs');
test('only the exact trusted app main frame can invoke privileged operations',()=>{const url='file:///application/ui/index.html',frame={url},wc={mainFrame:frame,getURL:()=>url};assert.doesNotThrow(()=>authorizeUi({sender:wc,senderFrame:frame},wc,url));
 for(const event of [{sender:{},senderFrame:frame},{sender:wc,senderFrame:{url}},{sender:wc,senderFrame:null}])assert.throws(()=>authorizeUi(event,wc,url),/Untrusted/);
 frame.url='about:blank';assert.throws(()=>authorizeUi({sender:wc,senderFrame:frame},wc,url),/Untrusted/);
});
