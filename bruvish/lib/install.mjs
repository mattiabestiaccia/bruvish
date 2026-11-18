import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// bruvish/scripts/install and bruvish/scripts/rollback. An installation is a folder
// <tools root>/bruvish/<upstream version>-<sha7>[-<identity6>] with dist/, bin/lavish-axi, bruvish/, app/ and the
// production node_modules. The `current` link names the one in use and `previous` the one before.
// Neither script touches ~/bin, launchd, the installed app or anything outside <tools root>/bruvish,
// and rollback deletes nothing.

export const INSTALL_USAGE = `Usage: bruvish/scripts/install [--no-switch]

Builds this checkout (clean, committed), installs it into <tools root>/bruvish/<version>-<sha7>,
verifies it, then points the current link at it and keeps the previous one as previous.
Before that it asks the installed lavish-axi for the style guide (lavish-axi design): without the
guide it installs nothing, leaves current and previous alone, and says how to generate it.
If that folder already holds another build of the same commit (for example a regenerated
bruvish/DESIGN.md), it installs into <version>-<sha7>-<first 6 characters of the build identity>
and leaves the existing folder alone. <tools root> is ~/tools, or $BRUVISH_TOOLS_ROOT.

  --no-switch  install side by side and leave current where it is (rerun without it to switch)`;

export const ROLLBACK_USAGE = `Usage: bruvish/scripts/rollback

Points current back at previous (and previous at the installation it replaces), after verifying
it. Deletes nothing. <tools root> is ~/tools, or $BRUVISH_TOOLS_ROOT.`;

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const protocol = createRequire(import.meta.url)("../../app/protocol.cjs");

// Files copied next to dist/: the lockfile set lets pnpm install the production dependencies;
// the licenses travel with the code they cover.
const TOP_FILES = [
  "package.json",
  "plugin.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
];

class Stop extends Error {}

export function installRoot(env = process.env) {
  return path.join(protocol.toolsRoot(env), "bruvish");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Stop(`${command} ${args.join(" ")} failed (in ${cwd})`);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Stop(`${what}: cannot read ${file} (${error.code || error.message})`);
  }
}

// The manifest written by scripts/bruvish-build.js must describe the files next to it.
function checkManifest(directory) {
  const manifest = readJson(path.join(directory, "dist/bruvish-manifest.json"), "Bruvish manifest");
  const version = readJson(path.join(directory, "package.json"), "package.json").version;
  if (manifest.product !== "bruvish" || typeof manifest.identity !== "string" || !manifest.identity) {
    throw new Stop(`${directory}: dist/bruvish-manifest.json is not a Bruvish manifest`);
  }
  if (manifest.upstreamVersion !== version) {
    throw new Stop(`${directory}: manifest is for ${manifest.upstreamVersion}, package.json says ${version}`);
  }
  for (const [name, expected] of Object.entries(manifest.outputs || {})) {
    const file = path.join(directory, "dist", name);
    if (!existsSync(file) || sha256(file) !== expected) {
      throw new Stop(`${directory}: dist/${name} does not match dist/bruvish-manifest.json`);
    }
  }
  if (Object.keys(manifest.outputs || {}).length === 0) throw new Stop(`${directory}: the manifest lists no outputs`);
  return { manifest, version };
}

// A usable installation: a manifest that matches dist/, production dependencies, and a command
// that answers the upstream version (one x.y.z, what Firstmate's version probe reads).
export function verifyInstallation(directory) {
  const { manifest, version } = checkManifest(directory);
  if (!existsSync(path.join(directory, "node_modules"))) throw new Stop(`${directory}: node_modules missing`);
  const command = path.join(directory, "bin/lavish-axi");
  const result = spawnSync(process.execPath, [command, "--version"], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || result.stdout.trim() !== version) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim().slice(0, 500);
    throw new Stop(`${directory}: bin/lavish-axi --version did not print ${version}${detail ? `: ${detail}` : ""}`);
  }
  return { manifest, version };
}

// The installed command, asked for the artifact style guide the way an agent does. A build whose
// lavish-axi design does not print the guide is refused before it becomes visible or current.
// BRUVISH_DESIGN is dropped from the environment: the check is about the installation itself.
function requireDesignGuide(directory) {
  const env = { ...process.env };
  delete env.BRUVISH_DESIGN;
  const command = path.join(directory, "bin/lavish-axi");
  const result = spawnSync(process.execPath, [command, "design"], { env, encoding: "utf8", timeout: 30_000 });
  if (result.status === 0 && result.stdout.trim() !== "") return;
  const detail = (result.stderr || result.error?.message || "").trim().split("\n")[0].slice(0, 300);
  throw new Stop(
    `lavish-axi design of this build does not print the style guide${detail ? ` (${detail})` : ""}.\n` +
      "Agents would write artifact HTML without it. Generate bruvish/DESIGN.md as described in bruvish/DESIGN.placeholder.md, then rerun this script, which rebuilds. Nothing was installed and current is unchanged.",
  );
}

function readLink(root, name) {
  try {
    return readlinkSync(path.join(root, name));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "EINVAL") throw new Stop(`${path.join(root, name)} is not a link: move it aside first`);
    throw error;
  }
}

// Replaces the link in one rename, so it always names a complete installation.
function pointLink(root, name, target) {
  const temporary = path.join(root, `.${name}.tmp-${process.pid}`);
  rmSync(temporary, { force: true });
  symlinkSync(target, temporary);
  renameSync(temporary, path.join(root, name));
}

function sameTarget(root, a, b) {
  return path.resolve(root, a) === path.resolve(root, b);
}

function checkCurrent(root, expected) {
  const current = path.join(root, "current");
  if (realpathSync(current) !== realpathSync(expected)) throw new Stop(`${current} does not point at ${expected}`);
  return verifyInstallation(current);
}

function ensureClean(root) {
  if (git(root, ["status", "--porcelain"]) !== "") {
    throw new Stop("The working tree is not clean: install only committed code (commit or set aside changes first).");
  }
}

// The build as scripts/bruvish-build.js recorded it, checked against this checkout.
function checkBuild(root) {
  const { manifest, version } = checkManifest(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  if (manifest.carryCommit !== head || manifest.carryDirty !== false) {
    throw new Stop(`dist/bruvish-manifest.json does not describe a clean build of ${head}`);
  }
  return { manifest, version, head };
}

function copyTracked(root, staging, directories) {
  const files = git(root, ["ls-files", "-z", "--", ...directories])
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(staging, file);
    mkdirSync(path.dirname(target), { recursive: true });
    if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), target);
    else copyFileSync(source, target);
  }
}

function stage(root, staging) {
  mkdirSync(staging);
  cpSync(path.join(root, "dist"), path.join(staging, "dist"), { recursive: true, verbatimSymlinks: true });
  // Only committed files of the delta: never untracked leftovers. The personal style guide is not
  // tracked; the build already copied it to dist/bruvish-design.md when it was present.
  copyTracked(root, staging, ["bruvish", "app", "skills/lavish"]);
  for (const name of TOP_FILES) {
    if (existsSync(path.join(root, name))) copyFileSync(path.join(root, name), path.join(staging, name));
  }
  // The command. No upstream bin/lavish-axi-server.js here, so the CLI starts dist/server.mjs.
  mkdirSync(path.join(staging, "bin"));
  symlinkSync("../dist/bruvish.mjs", path.join(staging, "bin/lavish-axi"));
  try {
    run("pnpm", ["install", "--prod", "--frozen-lockfile", "--offline", "--ignore-scripts"], staging);
  } catch {
    throw new Stop(
      "Production dependencies could not be installed from the pnpm store: run pnpm install --frozen-lockfile in the checkout first, then retry.",
    );
  }
}

// <version>-<sha7>, or <version>-<sha7>-<identity6> when that folder already holds another build of
// the same commit (a build input outside git changed, such as bruvish/DESIGN.md). An existing
// installation is never touched.
function installName(tools, built) {
  const base = `${built.version}-${built.head.slice(0, 7)}`;
  const identity = built.manifest.identity;
  const candidates = [base, `${base}-${identity.slice(0, 6)}`];
  const name = candidates.find((candidate) => {
    const target = path.join(tools, candidate);
    return !existsSync(target) || verifyInstallation(target).manifest.identity === identity;
  });
  if (!name) throw new Stop(`${path.join(tools, candidates[1])} exists with another build: move it aside first.`);
  return name;
}

function install(root, { switchCurrent }, log) {
  ensureClean(root);
  run("pnpm", ["run", "build"], root);
  const built = checkBuild(root);
  const tools = installRoot();
  mkdirSync(tools, { recursive: true });
  const name = installName(tools, built);
  const target = path.join(tools, name);

  if (existsSync(target)) {
    requireDesignGuide(target);
    log(`${target} is already installed and verified.`);
  } else {
    const staging = path.join(tools, `.${name}.tmp-${process.pid}`);
    try {
      stage(root, staging);
      const staged = verifyInstallation(staging);
      if (staged.manifest.identity !== built.manifest.identity) {
        throw new Stop("The staged build differs from the build");
      }
      requireDesignGuide(staging);
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    log(`Installed ${target} (build ${built.manifest.identity}).`);
  }

  log("lavish-axi design prints the style guide.");

  if (!switchCurrent) {
    log(`current is unchanged (${readLink(tools, "current") ?? "none"}); rerun without --no-switch to switch.`);
    log(`Try it side by side with ${target}/bin/lavish-axi, or LAVISH_APP_CORE_ROOT=${target} for the app.`);
    return 0;
  }
  const current = readLink(tools, "current");
  if (current && sameTarget(tools, current, name)) {
    log(`current already points at ${name}.`);
  } else {
    if (current) pointLink(tools, "previous", current);
    pointLink(tools, "current", name);
  }
  checkCurrent(tools, target);
  log(`current -> ${name}${current && !sameTarget(tools, current, name) ? `, previous -> ${current}` : ""}.`);
  log("Restarting the running service or app is a separate manual step.");
  return 0;
}

function rollback(log) {
  const tools = installRoot();
  const previous = readLink(tools, "previous");
  if (!previous) throw new Stop(`No previous installation in ${tools}: nothing to roll back to.`);
  const target = path.resolve(tools, previous);
  verifyInstallation(target);
  const current = readLink(tools, "current");
  pointLink(tools, "current", previous);
  if (current && !sameTarget(tools, current, previous)) pointLink(tools, "previous", current);
  checkCurrent(tools, target);
  log(`current -> ${previous}${current ? `, previous -> ${current}` : ""}. Nothing was deleted.`);
  log("Restarting the running service or app is a separate manual step.");
  return 0;
}

function guarded(action, error) {
  try {
    return action();
  } catch (caught) {
    if (!(caught instanceof Stop)) throw caught;
    error(caught.message);
    return 1;
  }
}

export function installMain(argv, { root = defaultRoot, log = console.log, error = console.error } = {}) {
  return guarded(() => {
    if (argv.includes("--help") || argv.includes("-h")) {
      log(INSTALL_USAGE);
      return 0;
    }
    const unknown = argv.filter((arg) => arg !== "--no-switch");
    if (unknown.length > 0) throw new Stop(`Unexpected argument: ${unknown[0]}\n${INSTALL_USAGE}`);
    return install(root, { switchCurrent: !argv.includes("--no-switch") }, log);
  }, error);
}

export function rollbackMain(argv, { log = console.log, error = console.error } = {}) {
  return guarded(() => {
    if (argv.includes("--help") || argv.includes("-h")) {
      log(ROLLBACK_USAGE);
      return 0;
    }
    if (argv.length > 0) throw new Stop(`Unexpected argument: ${argv[0]}\n${ROLLBACK_USAGE}`);
    return rollback(log);
  }, error);
}
