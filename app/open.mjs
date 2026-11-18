#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import protocol from './protocol.cjs';import {resolveEngine} from './install.mjs';
// The server runs this opener inside its Seatbelt profile. A direct spawn of the Electron executable
// would inherit that profile and Chromium could not start its own sandbox, so the app is launched
// through LaunchServices (/usr/bin/open), like the Chrome surface: the app starts outside the caller's
// profile. `-n` is required: the app takes a request only from argv (main.cjs: requestSingleInstanceLock,
// then `second-instance` in the running app), while without `-n` LaunchServices only activates a running
// app and drops --args, --env, --stdout and --stderr.
const LAUNCHER='/usr/bin/open';
// What the app and its core read from the environment; sent explicitly so the request does not depend on
// LaunchServices passing the caller's environment down.
const FORWARDED=['LAVISH_APP_CORE_ROOT','BRUVISH_TOOLS_ROOT','LAVISH_AXI_PORT','LAVISH_AXI_STATE_DIR','LAVISH_AXI_HOST','LAVISH_AXI_LINK_HOST','LAVISH_AXI_ALLOWED_HOSTS','LAVISH_MB_REMOTE_CONFIG'];
try{
 if(process.argv.length!==4)throw Error('Usage: lavish-app-open URL absoluteHTMLPath');
 const request=protocol.validate(process.argv[2],process.argv[3],protocol.stateRoot());
 const timeout=Number(process.env.LAVISH_APP_ACK_TIMEOUT_MS||15000);if(!Number.isFinite(timeout)||timeout<100||timeout>120000)throw Error('Invalid app acknowledgement timeout');
 const {bundle,appCode}=resolveEngine();
 fs.mkdirSync(path.join(request.root,'requests'),{recursive:true,mode:0o700});
 const id=randomUUID(),ack=path.join(request.root,'requests',id+'.json'),log=path.join(request.root,'app.log');
 fs.closeSync(fs.openSync(log,'a',0o600));
 const env={...process.env,LAVISH_APP_STATE_DIR:request.root};delete env.ELECTRON_RUN_AS_NODE;
 const settings=['LAVISH_APP_STATE_DIR',...FORWARDED].filter(name=>env[name]!==undefined).flatMap(name=>['--env',name+'='+env[name]]);
 const argv=['-n','-a',bundle,...settings,'--stdout',log,'--stderr',log,'--args',request.url,request.file,id];
 const launcher=spawn(LAUNCHER,argv,{env,stdio:['ignore','ignore','pipe']});
 let error,launched=false,stderr='';launcher.stderr.on('data',data=>stderr+=data);launcher.on('error',e=>error=e);
 launcher.on('close',(code,signal)=>{launched=true;if(code!==0)error=Error('macOS could not launch '+path.basename(bundle)+': '+(stderr.trim().slice(-1000)||'open exited with '+(signal||'code '+code))+'. Opening is not confirmed and no alternative browser was opened.');});
 const end=Date.now()+timeout;let result;
 while(Date.now()<end){if(error)throw error;try{result=JSON.parse(fs.readFileSync(ack,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,50));}
 if(!launched){launcher.stderr.destroy();launcher.unref();}
 if(!result)throw Error('Lavish has not acknowledged the loaded review yet and was left running. It may be waiting for macOS consent: complete that dialog, then retry this opening; inspect app.log if needed. Opening is not confirmed and no alternative browser was opened.');
 fs.unlinkSync(ack);if(result.appCode!==appCode)throw Error('Running Lavish app code differs from maintained source. Quit and reopen it explicitly; no existing app was stopped.');if(result.status!=='opened'||result.url!==request.url||result.file!==request.file||result.profile!==path.join(request.root,'profile'))throw Error(result.error||'App acknowledgement does not match request');
 console.log(JSON.stringify(result));
}catch(error){console.error('lavish-app: '+error.message);process.exitCode=78;}
