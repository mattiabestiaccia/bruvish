#!/usr/bin/env python3
"""Build Bruvish.app from the official Electron 44.2.0, signed with an explicit stable identity; no downloads."""
import argparse,hashlib,json,os,pathlib,plistlib,subprocess
VERSION='44.2.0'
# SHA-256 of Contents/MacOS/Electron in the official electron-v44.2.0-darwin-arm64.zip, checked against the
# release's SHASUMS256.txt through the zip. The official zip is not signed by Electron (no _CodeSignature, only
# the linker's ad-hoc signature), so integrity rests on this fingerprint, not on codesign. --electron-sha256 /
# BRUVISH_ELECTRON_SHA256 replaces it for another platform or build.
OFFICIAL_ELECTRON_SHA256='d3762bdff983315f18c07c3754175c4aa5b49d80977e1c33eb226b8189b447ed'
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
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--output',type=pathlib.Path,required=True)
 p.add_argument('--identity',default=os.environ.get('BRUVISH_SIGN_IDENTITY'),help='code-signing identity (default: $BRUVISH_SIGN_IDENTITY)')
 p.add_argument('--electron',type=pathlib.Path,help='official Electron.app (default: $BRUVISH_ELECTRON_APP or ~/tools/electron/44.2.0/Electron.app; $BRUVISH_TOOLS_ROOT replaces ~/tools)')
 p.add_argument('--electron-sha256',default=os.environ.get('BRUVISH_ELECTRON_SHA256'),help='SHA-256 the Electron main executable must match (default: the official 44.2.0 darwin-arm64 value, or $BRUVISH_ELECTRON_SHA256)')
 p.add_argument('--dry-run',action='store_true')
 a=p.parse_args();out=a.output.absolute();receipt_path=pathlib.Path(str(out)+'.lavish-build.json');source_app=(a.electron or default_source()).absolute()
 if not a.identity or a.identity=='-':raise ValueError('An explicit stable code-signing identity is required (--identity or BRUVISH_SIGN_IDENTITY); there is no ad-hoc fallback')
 if out.suffix!='.app' or out.exists() or out.is_symlink() or receipt_path.exists() or receipt_path.is_symlink():raise ValueError('Output and receipt must be new paths; existing destinations are never replaced')
 info=plistlib.loads((source_app/'Contents/Info.plist').read_bytes());binary=source_app/'Contents/MacOS'/info['CFBundleExecutable']
 if info.get('CFBundleIdentifier')!='com.github.Electron' or info.get('CFBundleVersion')!=VERSION:raise ValueError('Expected the official Electron '+VERSION+' app at '+str(source_app))
 engine_sha=sha(binary.read_bytes())
 pin=(a.electron_sha256 or OFFICIAL_ELECTRON_SHA256).strip().lower()
 if engine_sha!=pin:raise ValueError('Electron executable SHA-256 '+engine_sha+' differs from the pinned '+pin)
 source=pathlib.Path(__file__).parent;names=json.loads((source/'package.json').read_text())['lavishFiles']
 if not names or len(names)!=len(set(names)) or any(pathlib.PurePosixPath(n).is_absolute() or '..' in pathlib.PurePosixPath(n).parts for n in names):raise ValueError('Invalid app inventory')
 code={name:sha((source/name).read_bytes()) for name in names}
 print(json.dumps({'source':str(source_app),'sourceExecutableSha256':engine_sha,'output':str(out),'electron':VERSION,'identifier':IDENTIFIER,'identity':a.identity,'code':code,'dryRun':a.dry_run}))
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
 receipt={'electron':VERSION,'sourceExecutableSha256':engine_sha,'executable':NAME,'executableSha256':sha((out/'Contents/MacOS'/NAME).read_bytes()),'identity':a.identity,'designatedRequirement':(requirement.stdout+requirement.stderr).strip(),'code':code}
 receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.CalledProcessError) as e:raise SystemExit(str(e))
