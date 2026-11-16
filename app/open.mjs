#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import protocol from './protocol.cjs';import {resolveEngine} from './install.mjs';
try{
 if(process.argv.length!==4)throw Error('Usage: lavish-app-open URL absoluteHTMLPath');
 const request=protocol.validate(process.argv[2],process.argv[3],protocol.stateRoot());
 const timeout=Number(process.env.LAVISH_APP_ACK_TIMEOUT_MS||15000);if(!Number.isFinite(timeout)||timeout<100||timeout>120000)throw Error('Invalid app acknowledgement timeout');
 const {executable,appCode}=resolveEngine();
 fs.mkdirSync(path.join(request.root,'requests'),{recursive:true,mode:0o700});
 const id=randomUUID(),ack=path.join(request.root,'requests',id+'.json'),log=fs.openSync(path.join(request.root,'app.log'),'a',0o600);
 const env={...process.env,LAVISH_APP_STATE_DIR:request.root};delete env.ELECTRON_RUN_AS_NODE;
 const argv=[request.url,request.file,id];
 const child=spawn(executable,argv,{env,detached:true,stdio:['ignore',log,log]});fs.closeSync(log);
 let error;child.on('error',e=>error=e);child.unref();
 const end=Date.now()+timeout;let result;
 while(Date.now()<end){if(error)throw error;try{result=JSON.parse(fs.readFileSync(ack,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,50));}
 if(!result)throw Error('Lavish has not acknowledged the loaded review yet and was left running. It may be waiting for macOS consent: complete that dialog, then retry this opening; inspect app.log if needed. Opening is not confirmed and no alternative browser was opened.');
 fs.unlinkSync(ack);if(result.appCode!==appCode)throw Error('Running Lavish app code differs from maintained source. Quit and reopen it explicitly; no existing app was stopped.');if(result.status!=='opened'||result.url!==request.url||result.file!==request.file||result.profile!==path.join(request.root,'profile'))throw Error(result.error||'App acknowledgement does not match request');
 console.log(JSON.stringify(result));
}catch(error){console.error('lavish-app: '+error.message);process.exitCode=78;}
