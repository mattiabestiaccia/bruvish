// Bruvish build step, run at the end of scripts/build.js (`BRUVISH:hook build`), after the upstream
// outputs exist in dist/. It adds the Bruvish delta to the build without changing upstream sources:
// - appends the interface addon to dist/chrome-client.js and dist/chrome.css;
// - copies the runtime assets the server and CLI read (bruvish/lib/assets.mjs);
// - bundles the Bruvish entry point into dist/bruvish.mjs;
// - writes dist/bruvish-manifest.json with the upstream base, the carry commit and output hashes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, chmod, copyFile, readFile, rm, writeFile } from "node:fs/promises";

import * as esbuild from "esbuild";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

// Same names and sources as RUNTIME_ASSETS in bruvish/lib/assets.mjs; the style guide is optional.
const runtimeAssets = {
  "mb-artifact.js": "bruvish/assets/bridge.js",
  "mb-catalog.css": "bruvish/assets/catalog.css",
  "mb-catalog.js": "bruvish/assets/catalog.js",
  "mb-catalog-fonts.css": "bruvish/assets/fonts.css",
  "mb-catalog.cjs": "app/catalog.cjs",
};
// The style guide is personal and untracked (bruvish/.gitignore): copied only when present locally.
const optionalAssets = { "bruvish-design.md": "bruvish/DESIGN.md" };

// The addon is appended after a newline, exactly as the former overlay did, so the result can be
// compared byte for byte with the overlay's derived files.
for (const [output, addon] of [
  ["chrome-client.js", "bruvish/assets/chrome-addon.js"],
  ["chrome.css", "bruvish/assets/chrome-addon.css"],
]) {
  await appendFile(new URL(output, dist), `\n${await readFile(new URL(addon, root), "utf8")}`);
}

for (const [output, source] of Object.entries(runtimeAssets)) {
  await copyFile(new URL(source, root), new URL(output, dist));
}
const presentOptional = [];
for (const [output, source] of Object.entries(optionalAssets)) {
  if (existsSync(new URL(source, root))) {
    await copyFile(new URL(source, root), new URL(output, dist));
    presentOptional.push(output);
  } else await rm(new URL(output, dist), { force: true });
}

await esbuild.build({
  entryPoints: ["bruvish/bin/lavish-axi.js"],
  outfile: "dist/bruvish.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  define: {
    "process.env.LAVISH_AXI_BUILD_UMAMI_HOST": JSON.stringify(process.env.LAVISH_AXI_UMAMI_HOST || ""),
    "process.env.LAVISH_AXI_BUILD_UMAMI_WEBSITE_ID": JSON.stringify(process.env.LAVISH_AXI_UMAMI_WEBSITE_ID || ""),
    "process.env.LAVISH_AXI_BUILD_VERSION": JSON.stringify(packageJson.version),
  },
});
await chmod("dist/bruvish.mjs", 0o755);

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const outputNames = [
  "cli.mjs",
  "server.mjs",
  "bruvish.mjs",
  "chrome-client.js",
  "chrome.css",
  ...Object.keys(runtimeAssets),
  ...presentOptional,
];
const outputs = {};
for (const name of outputNames) {
  outputs[name] = createHash("sha256")
    .update(await readFile(new URL(name, dist)))
    .digest("hex");
}
const status = git("status", "--porcelain");
const manifest = {
  product: "bruvish",
  identity: createHash("sha256").update(JSON.stringify(outputs)).digest("hex").slice(0, 20),
  upstreamVersion: packageJson.version,
  upstreamTag: `lavish-axi-v${packageJson.version}`,
  carryCommit: git("rev-parse", "HEAD"),
  carryDirty: status === null ? null : status !== "",
  outputs,
};
await writeFile(new URL("bruvish-manifest.json", dist), `${JSON.stringify(manifest, null, 2)}\n`);
