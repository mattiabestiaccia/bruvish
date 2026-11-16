import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import protocol from './protocol.cjs';
const source=fileURLToPath(new URL('.',import.meta.url));
export function verifyBundle(bundle,{sourceDirectory=source}={}){
 let manifest;try{manifest=JSON.parse(fs.readFileSync(bundle+'.lavish-build.json','utf8'));}catch{throw Error('Bruvish.app build receipt missing. Build and explicitly adopt the private app first.');}
 if(manifest.executable!=='Bruvish'||manifest.electron!=='44.2.0'||typeof manifest.identity!=='string'||!manifest.identity||manifest.identity==='-')throw Error('Invalid private app build receipt or stable signing identity');
 const names=protocol.codeFiles(sourceDirectory),hash=x=>createHash('sha256').update(x).digest('hex');
 if(JSON.stringify(Object.keys(manifest.code||{}).sort())!==JSON.stringify([...names].sort()))throw Error('App inventory changed; rebuild the bundle');
 for(const name of names){if(hash(fs.readFileSync(path.join(bundle,'Contents/Resources/app',name)))!==manifest.code[name]||hash(fs.readFileSync(path.join(sourceDirectory,name)))!==manifest.code[name])throw Error('Dedicated app source changed or bundle integrity failed; rebuild before opening');}
 const executable=path.join(bundle,'Contents/MacOS',manifest.executable);
 if(hash(fs.readFileSync(executable))!==manifest.executableSha256)throw Error('Electron engine integrity failed');
 return {executable,development:false,bundle,appCode:protocol.codeIdentity(sourceDirectory),manifest};
}
export const defaultBundle=path.join(os.homedir(),'Applications/Bruvish.app');
export function resolveEngine(env=process.env){return verifyBundle(env.LAVISH_APP_BUNDLE||defaultBundle);}
