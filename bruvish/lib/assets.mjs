import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// A file of the installation, by its path from the repository root. This module runs either from
// source (bruvish/lib/, two levels below the root) or bundled into dist/*.mjs (one level below):
// the first candidate is the bundled layout, which from source names a path under bruvish/ that
// does not exist, so the source layout follows.
export function packageUrl(relative) {
  const candidates = [new URL(`../${relative}`, import.meta.url), new URL(`../../${relative}`, import.meta.url)];
  return candidates.find((url) => existsSync(fileURLToPath(url))) ?? candidates[0];
}

// Files the server and CLI read at runtime. In a build they sit in dist/ next to the bundle that
// imports this module (copied there by scripts/bruvish-build.js); from source they are read in
// place. `dist` is the name inside dist/, `source` the path from the repository root.
export const RUNTIME_ASSETS = Object.freeze({
  "mb-artifact.js": "bruvish/assets/bridge.js",
  "mb-catalog.css": "bruvish/assets/catalog.css",
  "mb-catalog.js": "bruvish/assets/catalog.js",
  "mb-catalog-fonts.css": "bruvish/assets/fonts.css",
  "mb-catalog.cjs": "app/catalog.cjs",
  "chrome-addon.js": "bruvish/assets/chrome-addon.js",
  "chrome-addon.css": "bruvish/assets/chrome-addon.css",
  "bruvish-design.md": "bruvish/DESIGN.md",
});

export function assetUrl(name) {
  const source = RUNTIME_ASSETS[name];
  if (!source) throw new Error(`Unknown Bruvish asset: ${name}`);
  const built = new URL(`./${name}`, import.meta.url);
  return existsSync(fileURLToPath(built)) ? built : packageUrl(source);
}

export function readAsset(name) {
  return readFile(assetUrl(name), "utf8");
}
