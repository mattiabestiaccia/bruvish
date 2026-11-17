import { readFileSync } from "node:fs";
import { packageUrl } from "./assets.mjs";

// `scripts/bruvish-build.js` writes dist/bruvish-manifest.json next to the bundles. Code bundled
// into dist/*.mjs finds it beside itself. Code run from a checkout's source reads the checkout's
// build: a dist CLI in a checkout starts the source server (upstream resolveServerEntry prefers
// bin/lavish-axi-server.js), and upstream already treats that pair as one local build. Without any
// build the identity is the fixed "source".
export const SOURCE_IDENTITY = "source";
export const MANIFEST_NAME = "bruvish-manifest.json";

const CANDIDATES = [packageUrl(`dist/${MANIFEST_NAME}`)];

export function readManifest(urls = CANDIDATES) {
  for (const url of [urls].flat()) {
    try {
      const manifest = JSON.parse(readFileSync(url, "utf8"));
      if (manifest && typeof manifest.identity === "string" && manifest.identity) return manifest;
    } catch {
      // Not here: try the next location.
    }
  }
  return null;
}

export function runtimeIdentity(urls = CANDIDATES) {
  return readManifest(urls)?.identity || SOURCE_IDENTITY;
}
