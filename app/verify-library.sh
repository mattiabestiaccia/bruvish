#!/bin/bash
# Run from a normal macOS terminal when the agent cannot reach GUI/Keychain.
# Builds and tests a private preview; never installs or changes the live service.
# Needs BRUVISH_SIGN_IDENTITY (stable Keychain signing identity) unless --bundle is given,
# the official Electron 44.2.0 (see app/build.py) and a Bruvish build (`pnpm run build`).
set -euo pipefail
bruvish_source="$(cd "$(dirname "$0")/.." && pwd)"
bruvish_check="$(mktemp -d /private/tmp/bruvish-library-check.XXXXXX)"
bruvish_bundle="$bruvish_check/Bruvish.app"
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--bundle" ]]; then
    printf 'Uso: bash app/verify-library.sh [--bundle BUNDLE_FIRMATO.app]\n' >&2
    exit 2
  fi
  bruvish_bundle="$2"
fi
exec > >(tee "$bruvish_check/verification.log") 2>&1
printf 'Evidenze: %s\n' "$bruvish_check"
cd "$bruvish_source"
if [[ ! -f dist/bruvish-manifest.json ]]; then
  printf 'Manca la build di Bruvish: lancia prima pnpm run build.\n' >&2
  exit 1
fi
if [[ $# -eq 0 ]]; then
  : "${BRUVISH_SIGN_IDENTITY:?Imposta BRUVISH_SIGN_IDENTITY con l identità di firma stabile}"
  LAVISH_MB_TEST_EVIDENCE_DIR="$bruvish_check/evidence" node --test app/test/*.test.mjs
  python3 app/build.py --output "$bruvish_bundle"
else
  node app/deploy.mjs plan "$bruvish_bundle"
fi
LAVISH_MB_TEST_DEDICATED=1 \
LAVISH_APP_BUNDLE="$bruvish_bundle" \
LAVISH_MB_TEST_ROOT="$bruvish_check/native" \
LAVISH_MB_TEST_EVIDENCE_DIR="$bruvish_check/evidence" \
node --test app/test/app-live.test.mjs
bruvish_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
nohup env -u ELECTRON_RUN_AS_NODE \
  LAVISH_APP_CORE_ROOT="$bruvish_source" \
  LAVISH_APP_STATE_DIR="$bruvish_check/native/app" \
  LAVISH_AXI_STATE_DIR="$bruvish_check/native/server" \
  LAVISH_AXI_PORT="$bruvish_port" \
  "$bruvish_bundle/Contents/MacOS/Bruvish" > "$bruvish_check/preview.log" 2>&1 &
printf '\nTest conclusi. Anteprima avviata, PID %s.\n' "$!"
printf 'Bundle: %s\nEvidenze: %s\n' "$bruvish_bundle" "$bruvish_check"
printf 'Prova Trasparenza, Anche artefatti, Finder e Vista → Schermo intero (ctrl-cmd-f) sul dummy; chiudi l’anteprima con Cmd+Q.\n'
printf 'L’app installata e i dati live non sono stati modificati.\n'
