#!/usr/bin/env python3
"""Build Bruvish.app from the official Electron 44.2.0, signed with an explicit stable identity; no downloads."""
import argparse,hashlib,json,os,pathlib,plistlib,subprocess
VERSION='44.2.0'
# Official Electron, downloaded by hand from the Electron release page into the personal tools folder.
DEFAULT_SOURCE=pathlib.Path.home()/'personal/tools/electron'/VERSION/'Electron.app'
NAME='Bruvish'
# The bundle id, app.setName('Lavish') and the profile stay as before, so drafts and the Keychain item carry over.
IDENTIFIER='local.lavish.mb'
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--output',type=pathlib.Path,required=True)
 p.add_argument('--identity',default=os.environ.get('BRUVISH_SIGN_IDENTITY'),help='code-signing identity (default: $BRUVISH_SIGN_IDENTITY)')
 p.add_argument('--electron',type=pathlib.Path,default=pathlib.Path(os.environ.get('BRUVISH_ELECTRON_APP') or DEFAULT_SOURCE),help='official Electron.app (default: $BRUVISH_ELECTRON_APP or ~/personal/tools/electron/44.2.0/Electron.app)')
 p.add_argument('--electron-sha256',default=os.environ.get('BRUVISH_ELECTRON_SHA256'),help='optional pin of the Electron main executable')
 p.add_argument('--dry-run',action='store_true')
 a=p.parse_args();out=a.output.absolute();receipt_path=pathlib.Path(str(out)+'.lavish-build.json');source_app=a.electron.absolute()
 if not a.identity or a.identity=='-':raise ValueError('An explicit stable code-signing identity is required (--identity or BRUVISH_SIGN_IDENTITY); there is no ad-hoc fallback')
 if out.suffix!='.app' or out.exists() or out.is_symlink() or receipt_path.exists() or receipt_path.is_symlink():raise ValueError('Output and receipt must be new paths; existing destinations are never replaced')
 info=plistlib.loads((source_app/'Contents/Info.plist').read_bytes());binary=source_app/'Contents/MacOS'/info['CFBundleExecutable']
 if info.get('CFBundleIdentifier')!='com.github.Electron' or info.get('CFBundleVersion')!=VERSION:raise ValueError('Expected the official Electron '+VERSION+' app at '+str(source_app))
 engine_sha=sha(binary.read_bytes())
 if a.electron_sha256 and engine_sha!=a.electron_sha256:raise ValueError('Electron executable differs from the pinned SHA-256')
 source=pathlib.Path(__file__).parent;names=json.loads((source/'package.json').read_text())['lavishFiles']
 if not names or len(names)!=len(set(names)) or any(pathlib.PurePosixPath(n).is_absolute() or '..' in pathlib.PurePosixPath(n).parts for n in names):raise ValueError('Invalid app inventory')
 code={name:sha((source/name).read_bytes()) for name in names}
 print(json.dumps({'source':str(source_app),'sourceExecutableSha256':engine_sha,'output':str(out),'electron':VERSION,'identifier':IDENTIFIER,'identity':a.identity,'code':code,'dryRun':a.dry_run}))
 if a.dry_run:return
 # The official app must be intact before it is copied: signature and notarization seal.
 subprocess.run(['codesign','--verify','--deep','--strict',str(source_app)],check=True)
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
 receipt={'electron':VERSION,'sourceExecutableSha256':engine_sha,'executable':NAME,'executableSha256':sha((out/'Contents/MacOS'/NAME).read_bytes()),'identity':a.identity,'designatedRequirement':(requirement.stdout+requirement.stderr).strip(),'code':code}
 receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.CalledProcessError) as e:raise SystemExit(str(e))
