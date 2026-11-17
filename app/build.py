#!/usr/bin/env python3
"""Build Bruvish.app from the official Electron 44.2.0, signed with an explicit stable identity; no downloads."""
import argparse,hashlib,json,os,pathlib,plistlib,stat,subprocess
VERSION='44.2.0'
# Tree fingerprint (tree_sha) of the whole Electron.app extracted from the official electron-v44.2.0-darwin-arm64.zip,
# whose zip matched the release's SHASUMS256.txt. The official zip is not signed by Electron (no _CodeSignature, only
# the linker's ad-hoc signature), so integrity rests on this fingerprint, not on codesign. It covers every entry of
# the app: launcher, frameworks, helper apps and resources. --electron-sha256 / BRUVISH_ELECTRON_SHA256 replaces it
# for another platform or build.
OFFICIAL_ELECTRON_SHA256='8d0af25038335d770e33b8344057bf3e884f14734a59511a67c6445563ddc60f'
# Official Electron, downloaded by hand from the Electron release page into the tools folder. The
# default path comes from protocol.cjs (engineApp: $BRUVISH_ELECTRON_APP, else <tools root>/electron),
# the one place that names the tools root.
def default_source():
 script="process.stdout.write(require(process.argv[1]).engineApp())"
 return pathlib.Path(subprocess.run(['node','-e',script,str(pathlib.Path(__file__).parent/'protocol.cjs')],check=True,capture_output=True,text=True).stdout)
NAME='Bruvish'
# The bundle id, app.setName('Lavish') and the profile stay as before, so drafts and the Keychain item carry over.
IDENTIFIER='local.lavish.mb'
def sha(data):return hashlib.sha256(data).hexdigest()
# SHA-256 over every entry below root, sorted by relative path; each entry contributes its type (f/d/l), relative
# path, owner executable bit (files only), and content SHA-256 (files) or link target (symlinks), NUL-separated.
# Symlinks are recorded, never followed. Any other file type is refused.
def tree_sha(root):
 h=hashlib.sha256();entries=[]
 for d,dirs,files in os.walk(root):entries+=[pathlib.Path(d)/n for n in dirs+files]
 for p in sorted(entries,key=lambda p:os.fsencode(p.relative_to(root).as_posix())):
  rel=os.fsencode(p.relative_to(root).as_posix());mode=p.lstat().st_mode
  if stat.S_ISLNK(mode):record=[b'l',rel,b'-',os.fsencode(os.readlink(p))]
  elif stat.S_ISDIR(mode):record=[b'd',rel,b'-',b'']
  elif stat.S_ISREG(mode):
   with open(p,'rb') as f:record=[b'f',rel,b'x' if mode&stat.S_IXUSR else b'-',hashlib.file_digest(f,'sha256').hexdigest().encode()]
  else:raise ValueError('Unexpected file type in the Electron app: '+str(p))
  h.update(b'\0'.join(record)+b'\0')
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--output',type=pathlib.Path,required=True)
 p.add_argument('--identity',default=os.environ.get('BRUVISH_SIGN_IDENTITY'),help='code-signing identity (default: $BRUVISH_SIGN_IDENTITY)')
 p.add_argument('--electron',type=pathlib.Path,help='official Electron.app (default: $BRUVISH_ELECTRON_APP or ~/tools/electron/44.2.0/Electron.app; $BRUVISH_TOOLS_ROOT replaces ~/tools)')
 p.add_argument('--electron-sha256',default=os.environ.get('BRUVISH_ELECTRON_SHA256'),help='tree fingerprint the whole Electron.app must match (default: the official 44.2.0 darwin-arm64 value, or $BRUVISH_ELECTRON_SHA256)')
 p.add_argument('--dry-run',action='store_true')
 a=p.parse_args();out=a.output.absolute();receipt_path=pathlib.Path(str(out)+'.lavish-build.json');source_app=(a.electron or default_source()).absolute()
 if not a.identity or a.identity=='-':raise ValueError('An explicit stable code-signing identity is required (--identity or BRUVISH_SIGN_IDENTITY); there is no ad-hoc fallback')
 if out.suffix!='.app' or out.exists() or out.is_symlink() or receipt_path.exists() or receipt_path.is_symlink():raise ValueError('Output and receipt must be new paths; existing destinations are never replaced')
 info=plistlib.loads((source_app/'Contents/Info.plist').read_bytes())
 if info.get('CFBundleIdentifier')!='com.github.Electron' or info.get('CFBundleVersion')!=VERSION:raise ValueError('Expected the official Electron '+VERSION+' app at '+str(source_app))
 engine_sha=tree_sha(source_app)
 pin=(a.electron_sha256 or OFFICIAL_ELECTRON_SHA256).strip().lower()
 if engine_sha!=pin:raise ValueError('Electron app tree SHA-256 '+engine_sha+' differs from the pinned '+pin)
 source=pathlib.Path(__file__).parent;names=json.loads((source/'package.json').read_text())['lavishFiles']
 if not names or len(names)!=len(set(names)) or any(pathlib.PurePosixPath(n).is_absolute() or '..' in pathlib.PurePosixPath(n).parts for n in names):raise ValueError('Invalid app inventory')
 code={name:sha((source/name).read_bytes()) for name in names}
 print(json.dumps({'source':str(source_app),'sourceTreeSha256':engine_sha,'output':str(out),'electron':VERSION,'identifier':IDENTIFIER,'identity':a.identity,'code':code,'dryRun':a.dry_run}))
 if a.dry_run:return
 out.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['ditto',str(source_app),str(out)],check=True)
 (out/'Contents/MacOS'/info['CFBundleExecutable']).rename(out/'Contents/MacOS'/NAME)
 info.update(CFBundleName=NAME,CFBundleDisplayName=NAME,CFBundleIdentifier=IDENTIFIER,CFBundleExecutable=NAME)
 (out/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
 target=out/'Contents/Resources/app';target.mkdir()
 for name in names:
  dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((source/name).read_bytes())
 subprocess.run(['codesign','--force','--deep','--sign',a.identity,'--preserve-metadata=entitlements,flags',str(out)],check=True)
 subprocess.run(['codesign','--verify','--deep','--strict',str(out)],check=True)
 requirement=subprocess.run(['codesign','-d','-r-',str(out)],check=True,capture_output=True,text=True)
 receipt={'electron':VERSION,'sourceTreeSha256':engine_sha,'executable':NAME,'executableSha256':sha((out/'Contents/MacOS'/NAME).read_bytes()),'identity':a.identity,'designatedRequirement':(requirement.stdout+requirement.stderr).strip(),'code':code}
 receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.CalledProcessError) as e:raise SystemExit(str(e))
