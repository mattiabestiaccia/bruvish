const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
// The one root of the hand-installed tools (~/tools, one folder per tool and version). Bruvish installs
// into <root>/bruvish (bruvish/scripts/install) and the app engine sits in <root>/electron.
// BRUVISH_TOOLS_ROOT overrides it, for tests.
function toolsRoot(env=process.env){return env.BRUVISH_TOOLS_ROOT||path.join(os.homedir(),'tools');}
// The installed Bruvish build: a stable link that bruvish/scripts/install moves between versions.
function coreRoot(env=process.env){return env.LAVISH_APP_CORE_ROOT||path.join(toolsRoot(env),'bruvish','current');}
// Official Electron 44.2.0, downloaded by hand (see app/README.md); BRUVISH_ELECTRON_APP overrides it.
const engineVersion='44.2.0';
function engineApp(env=process.env){return env.BRUVISH_ELECTRON_APP||path.join(toolsRoot(env),'electron',engineVersion,'Electron.app');}
function validate(url,file,root){const u=new URL(url);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||!u.port||u.hash||!/^\/session\/[a-f0-9]{16}$/.test(u.pathname))throw Error('Dedicated app requires an explicit loopback HTTP review URL');if(!path.isAbsolute(file)||!/\.html?$/i.test(file)||!fs.statSync(file).isFile())throw Error('An existing absolute HTML path is required');if(!path.isAbsolute(root))throw Error('LAVISH_APP_STATE_DIR must be absolute');return {url:u.href,file:fs.realpathSync(file),root:path.resolve(root)};}
function stateRoot(){return process.env.LAVISH_APP_STATE_DIR||path.join(os.homedir(),'.local/state/lavish-mb/app-personal');}
function codeFiles(directory){const names=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).lavishFiles;if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||path.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..')))throw Error('Invalid app file inventory');return names;}
function codeIdentity(directory){const crypto=require('node:crypto');return crypto.createHash('sha256').update(JSON.stringify(codeFiles(directory).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')]))).digest('hex');}
// Review requests from app/open.mjs. The opener runs inside the service's Seatbelt profile, and LaunchServices
// ignores the arguments, environment and stdio of a sandboxed caller, so a request cannot travel in argv:
// the opener leaves it in <root>/requests/<id>.request.json (written to a .tmp file, then renamed) and asks
// LaunchServices only to start or activate the app. The app takes each file once: it reads and deletes it
// before handling it, in arrival order (file modification time, then name). The acknowledgement stays
// <root>/requests/<id>.json.
const requestFile=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.request\.json$/;
function requestPath(root,id){return path.join(root,'requests',id+'.request.json');}
function takeRequests(root){
 const directory=path.join(root,'requests');let names;try{names=fs.readdirSync(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const pending=[];
 for(const name of names){
  const match=requestFile.exec(name);if(!match)continue;
  let stat;try{stat=fs.statSync(path.join(directory,name));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  pending.push({name,match,time:stat.mtimeMs});
 }
 pending.sort((a,b)=>a.time-b.time||(a.name<b.name?-1:a.name>b.name?1:0));
 const taken=[];
 for(const {name,match} of pending){
  const file=path.join(directory,name);let text;
  try{text=fs.readFileSync(file,'utf8');fs.unlinkSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  let data;try{data=JSON.parse(text);}catch{data=null;}
  taken.push(data&&typeof data.url==='string'&&typeof data.file==='string'?{id:match[1],url:data.url,file:data.file}:{id:match[1],error:'Malformed review request'});
 }
 return taken;
}
module.exports={toolsRoot,coreRoot,engineVersion,engineApp,validate,stateRoot,codeIdentity,codeFiles,requestPath,takeRequests};
