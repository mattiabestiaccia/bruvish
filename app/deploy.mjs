#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash,randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {verifyBundle,defaultBundle} from './install.mjs';import protocol from './protocol.cjs';
export function receiptHash(bundle){return createHash('sha256').update(fs.readFileSync(bundle+'.lavish-build.json')).digest('hex');}
export function deployBundle(source,{expectedReceipt,target=defaultBundle,instanceFile=path.join(protocol.stateRoot(),'instance.json'),validate=verifyBundle,copy=(a,b)=>execFileSync('/usr/bin/ditto',[a,b]),verifySignature=b=>execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',b],{stdio:'pipe'})}={}){
 if(!expectedReceipt||receiptHash(source)!==expectedReceipt)throw Error('Build receipt differs from the approved receipt');
 if(path.resolve(source)===path.resolve(target))throw Error('Build source and installed target must differ');
 try{const {pid}=JSON.parse(fs.readFileSync(instanceFile,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid app instance record');try{process.kill(pid,0);throw Error('Quit Lavish before installing an update');}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
 validate(source);verifySignature(source);
 const suffix=randomUUID(),staging=target+'.staging-'+suffix,backup=fs.existsSync(target)?target+'.backup-'+suffix:null,receipt=target+'.lavish-build.json';
 if(fs.existsSync(receipt)&&!backup)throw Error('Orphan install receipt: inspect it before installing');
 fs.mkdirSync(path.dirname(target),{recursive:true});let backed=false,installed=false;
 try{copy(source,staging);fs.copyFileSync(source+'.lavish-build.json',staging+'.lavish-build.json');validate(staging);verifySignature(staging);
  if(backup){fs.renameSync(target,backup);backed=true;if(fs.existsSync(receipt))fs.renameSync(receipt,backup+'.lavish-build.json');}
  fs.renameSync(staging,target);installed=true;fs.renameSync(staging+'.lavish-build.json',receipt);validate(target);verifySignature(target);
  return {target,receipt,backup,openingSurfaceChanged:false};
 }catch(error){if(installed){fs.renameSync(target,staging);if(fs.existsSync(receipt))fs.renameSync(receipt,staging+'.lavish-build.json');}if(backed){fs.renameSync(backup,target);if(fs.existsSync(backup+'.lavish-build.json'))fs.renameSync(backup+'.lavish-build.json',receipt);}throw error;
 }finally{fs.rmSync(staging,{recursive:true,force:true});fs.rmSync(staging+'.lavish-build.json',{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const [action,bundle,flag,hash,...rest]=process.argv.slice(2);if(!bundle||!['plan','apply'].includes(action)||rest.length||action==='apply'&&(flag!=='--receipt-sha256'||!hash)||action==='plan'&&flag)throw Error('Usage: node app/deploy.mjs plan BUILD.app | apply BUILD.app --receipt-sha256 SHA256');verifyBundle(bundle);console.log(JSON.stringify(action==='plan'?{source:path.resolve(bundle),target:path.join(os.homedir(),'Applications/Lavish.app'),receiptSha256:receiptHash(bundle),surfaceUnchanged:true}:deployBundle(bundle,{expectedReceipt:hash}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
