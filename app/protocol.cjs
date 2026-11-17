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
module.exports={toolsRoot,coreRoot,engineVersion,engineApp,validate,stateRoot,codeIdentity,codeFiles};
