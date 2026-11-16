import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Files the server and CLI read at runtime. In a build they sit in dist/ next to the bundle that
// imports this module (copied there by scripts/bruvish-build.js); from source they are read in
// place. `dist` is the name inside dist/, `source` the path relative to bruvish/lib/.
export const RUNTIME_ASSETS = Object.freeze({
  "mb-artifact.js": "../assets/bridge.js",
  "mb-catalog.css": "../assets/catalog.css",
  "mb-catalog.js": "../assets/catalog.js",
  "mb-catalog-fonts.css": "../assets/fonts.css",
  "mb-catalog.cjs": "../../app/catalog.cjs",
  "bruvish-design.md": "../DESIGN.md",
});

export function assetUrl(name) {
  const source = RUNTIME_ASSETS[name];
  if (!source) throw new Error(`Unknown Bruvish asset: ${name}`);
  const built = new URL(`./${name}`, import.meta.url);
  return existsSync(fileURLToPath(built)) ? built : new URL(source, import.meta.url);
}

export function readAsset(name) {
  return readFile(assetUrl(name), "utf8");
}
