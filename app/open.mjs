#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import protocol from './protocol.cjs';import {resolveEngine} from './install.mjs';
// The server runs this opener inside its Seatbelt profile. A direct spawn of the Electron executable would
// inherit that profile and Chromium could not start its own sandbox, so the app is started through
// LaunchServices (/usr/bin/open -a <bundle>), like the Chrome surface: the app runs outside the caller's
// profile. LaunchServices ignores the arguments, environment and stdio of a sandboxed caller, so the request
// travels as a file in the app's state directory (protocol.cjs: requestPath, takeRequests); `open` only
// starts the app, or activates it when it is already running, and the app picks the file up.
const LAUNCHER='/usr/bin/open';
try{
 if(process.argv.length!==4)throw Error('Usage: lavish-app-open URL absoluteHTMLPath');
 const request=protocol.validate(process.argv[2],process.argv[3],protocol.stateRoot());
 const timeout=Number(process.env.LAVISH_APP_ACK_TIMEOUT_MS||15000);if(!Number.isFinite(timeout)||timeout<100||timeout>120000)throw Error('Invalid app acknowledgement timeout');
 const {bundle,appCode}=resolveEngine();
 fs.mkdirSync(path.join(request.root,'requests'),{recursive:true,mode:0o700});
 const id=randomUUID(),ack=path.join(request.root,'requests',id+'.json'),pending=protocol.requestPath(request.root,id);
 fs.writeFileSync(pending+'.tmp',JSON.stringify({url:request.url,file:request.file}),{mode:0o600});fs.renameSync(pending+'.tmp',pending);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const launcher=spawn(LAUNCHER,['-a',bundle],{env,stdio:['ignore','ignore','pipe']});
 let error,launched=false,stderr='';launcher.stderr.on('data',data=>stderr+=data);launcher.on('error',e=>error=e);
 launcher.on('close',(code,signal)=>{launched=true;if(code!==0)error=Error('macOS could not launch '+path.basename(bundle)+': '+(stderr.trim().slice(-1000)||'open exited with '+(signal||'code '+code))+'. Opening is not confirmed and no alternative browser was opened.');});
 const end=Date.now()+timeout;let result;
 try{while(Date.now()<end){if(error)throw error;try{result=JSON.parse(fs.readFileSync(ack,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,50));}}
 // A request the app has not taken is withdrawn, so the app never opens it later.
 finally{if(!result)fs.rmSync(pending,{force:true});if(!launched){launcher.stderr.destroy();launcher.unref();}}
 if(!result)throw Error('Lavish has not acknowledged the loaded review yet and was left running. It may be waiting for macOS consent: complete that dialog, then retry this opening; inspect app.log if needed. Opening is not confirmed and no alternative browser was opened.');
 fs.unlinkSync(ack);if(result.appCode!==appCode)throw Error('Running Lavish app code differs from maintained source. Quit and reopen it explicitly; no existing app was stopped.');if(result.status!=='opened'||result.url!==request.url||result.file!==request.file||result.profile!==path.join(request.root,'profile'))throw Error(result.error||'App acknowledgement does not match request');
 console.log(JSON.stringify(result));
}catch(error){console.error('lavish-app: '+error.message);process.exitCode=78;}
