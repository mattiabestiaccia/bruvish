import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOOKS, hookProblems } from "./hooks.mjs";

// bruvish/scripts/update-upstream: merges an upstream release tag into a new `update/vX.Y.Z` branch
// made from `carry`, then runs the checks. It never pushes, opens a pull request or installs.
// `carry` only moves forward: the merge is `--no-ff` and nothing is rebased or force-pushed.

export const USAGE = `Usage: bruvish/scripts/update-upstream [tag] [--base <ref>] [--no-fetch] [--allow-agent-config]
       bruvish/scripts/update-upstream --continue

Merges the upstream release tag (default: the latest lavish-axi-vX.Y.Z) into a new branch
update/vX.Y.Z made from carry (or --base), with rerere enabled, then runs the checks.
It stops before any push, pull request or installation.

  [tag]                 0.1.97, v0.1.97 or lavish-axi-v0.1.97
  --base <ref>          branch to start from (default: carry, else origin/carry)
  --no-fetch            use the upstream tags already fetched
  --allow-agent-config  merge even though the release changes agent configuration
                        (.claude/, .mcp.json, .agents/, CLAUDE.md, AGENTS.md), after review
  --continue            after resolving conflicts or fixing checks on update/vX.Y.Z:
                        commit the merge if needed, then check hooks and run the checks again

Exit codes: 0 ready for a pull request (or nothing to merge), 1 error, 2 needs a decision,
3 conflicts to resolve, 4 checks failed.`;

export const EXIT = Object.freeze({ ok: 0, error: 1, decision: 2, conflicts: 3, checks: 4 });
export const TAG_PATTERN = /^lavish-axi-v(\d+)\.(\d+)\.(\d+)$/;
// A conflict hunk at a hook longer than this is not a hook to put back: the graft needs a decision.
export const CONFLICT_LINE_LIMIT = 30;
// Files that steer the agents working in this repository. An upstream release that changes them
// stops before the merge: the differences are shown and need an explicit review.
export const AGENT_CONFIG_PATHSPECS = Object.freeze([
  ":(glob)**/.claude/**",
  ":(glob)**/.mcp.json",
  ":(glob)**/.agents/**",
  ":(glob)**/CLAUDE.md",
  ":(glob)**/AGENTS.md",
]);

const UPSTREAM_URL = "https://github.com/kunchenguid/lavish-axi.git";
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function git(root, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  } catch (error) {
    if (allowFail) return null;
    const detail = (error.stderr || error.message || "").toString().trim();
    throw new Stop(EXIT.error, `git ${args.join(" ")} failed: ${detail}`);
  }
}

function gitLines(root, args) {
  return git(root, args).split("\n").filter(Boolean);
}

function gitVisible(root, args) {
  return spawnSync("git", args, { cwd: root, stdio: "inherit" }).status;
}

function hasRef(root, ref) {
  return git(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`], { allowFail: true }) !== null;
}

function isAncestor(root, ancestor, descendant) {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root }).status === 0;
}

function ensureClean(root) {
  if (git(root, ["status", "--porcelain"]) !== "") {
    throw new Stop(EXIT.error, "The working tree is not clean: commit or set aside local changes first.");
  }
}

export function parseTag(value) {
  const match = /^(?:lavish-axi-)?v?(\d+\.\d+\.\d+)$/.exec(value);
  if (!match) throw new Stop(EXIT.error, `Not an upstream release: ${value} (expected 0.1.97 or lavish-axi-v0.1.97)`);
  return `lavish-axi-v${match[1]}`;
}

function versionKey(tag) {
  return TAG_PATTERN.exec(tag).slice(1).map(Number);
}

export function latestTag(tags) {
  const releases = tags.filter((tag) => TAG_PATTERN.test(tag));
  releases.sort((a, b) => {
    const [x, y] = [versionKey(a), versionKey(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return releases.at(-1) ?? null;
}

function resolveBase(root, base) {
  if (base) {
    if (!hasRef(root, base)) throw new Stop(EXIT.error, `Unknown base: ${base}`);
    return base;
  }
  if (hasRef(root, "refs/heads/carry")) {
    if (hasRef(root, "refs/remotes/origin/carry") && !isAncestor(root, "origin/carry", "carry")) {
      throw new Stop(EXIT.error, "Local carry is behind or apart from origin/carry: bring it up to date first.");
    }
    return "carry";
  }
  if (hasRef(root, "refs/remotes/origin/carry")) return "origin/carry";
  throw new Stop(EXIT.error, "No carry branch (local or origin/carry): pass --base <ref>.");
}

// Conflict hunks of a file with merge markers. `lines` counts both sides (ours and theirs), not the
// base section a diff3/zdiff3 conflict style adds, nor the marker lines.
export function conflictHunks(text) {
  const hunks = [];
  let current = null;
  let section = null;
  text.split("\n").forEach((line, index) => {
    if (/^<{7}( |$)/.test(line)) {
      current = { line: index + 1, lines: 0 };
      section = "ours";
    } else if (!current) {
      return;
    } else if (/^\|{7}( |$)/.test(line)) {
      section = "base";
    } else if (line === "=======") {
      section = "theirs";
    } else if (/^>{7}( |$)/.test(line)) {
      hunks.push(current);
      current = null;
    } else if (section !== "base") {
      current.lines += 1;
    }
  });
  return hunks;
}

// Sorts the unmerged files of a merge in progress. Only small content conflicts in hook files are
// left to resolve; anything else (a conflict outside the hook files, a delete/modify or add/add
// conflict without markers, a hunk over the limit) needs a decision.
export function classifyConflicts(root, files) {
  const decisions = [];
  const resolvable = [];
  for (const file of files) {
    const full = path.join(root, file);
    if (!HOOKS[file]) {
      decisions.push(`${file}: conflict outside the hook files (Bruvish changes upstream code only at hooks)`);
      continue;
    }
    const hunks = existsSync(full) ? conflictHunks(readFileSync(full, "utf8")) : [];
    if (hunks.length === 0) {
      decisions.push(`${file}: the file was deleted, renamed or replaced upstream (no conflict markers to resolve)`);
      continue;
    }
    const large = hunks.filter((hunk) => hunk.lines > CONFLICT_LINE_LIMIT);
    for (const hunk of large) {
      decisions.push(`${file}:${hunk.line}: conflict of ${hunk.lines} lines (limit ${CONFLICT_LINE_LIMIT} at a hook)`);
    }
    if (large.length === 0) resolvable.push(`${file}: ${hunks.map((hunk) => `line ${hunk.line}`).join(", ")}`);
  }
  return { decisions, resolvable };
}

function abortHint(branch) {
  return `To give up: git merge --abort, switch back to the base, then git branch -D ${branch}.`;
}

function checkHooks(root, skip) {
  const problems = hookProblems(root, skip);
  if (problems.length > 0) {
    throw new Stop(
      EXIT.decision,
      `needs-decision: a BRUVISH:hook marker moved or vanished; do not reinvent the graft.\n  ${problems.join("\n  ")}\nSee the hook table in BRUVISH.md.`,
    );
  }
}

function bruvishTestFiles(root) {
  const files = [];
  for (const directory of ["bruvish/test", "app/test"]) {
    const full = path.join(root, directory);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full).sort()) if (name.endsWith(".test.mjs")) files.push(`${directory}/${name}`);
  }
  return files;
}

// `pnpm run check` is upstream's full gate (build, lint, format, types, every test, skill and plugin
// freshness) and today also runs the Bruvish tests. They run once more by name so that they keep
// running even if a release narrows upstream's `test` script.
function runChecks(root, branch, log) {
  const tests = bruvishTestFiles(root);
  if (tests.length === 0) {
    throw new Stop(EXIT.checks, "checks failed: no Bruvish tests found in bruvish/test or app/test");
  }
  const steps = [
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["run", "check"]],
    [process.execPath, ["--test", ...tests]],
  ];
  for (const [command, args] of steps) {
    const label = `${command === process.execPath ? "node" : command} ${args.join(" ")}`;
    log(`==> ${label}`);
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Stop(
        EXIT.checks,
        `checks failed at: ${label}\nFix it on ${branch}, commit, then run bruvish/scripts/update-upstream --continue.`,
      );
    }
  }
}

function finish(root, branch, tag, log) {
  checkHooks(root);
  runChecks(root, branch, log);
  log(`\nMerged ${tag} into ${branch}; hooks are in place and every check passed.`);
  log(`Next: push ${branch} to origin and open a pull request into carry. Nothing was pushed or installed.`);
  return EXIT.ok;
}

function parseArgs(argv) {
  const options = { tag: null, base: null, fetch: true, allowAgentConfig: false, continue: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--continue") options.continue = true;
    else if (arg === "--no-fetch") options.fetch = false;
    else if (arg === "--allow-agent-config") options.allowAgentConfig = true;
    else if (arg === "--base") {
      options.base = argv[i + 1];
      i += 1;
      if (!options.base) throw new Stop(EXIT.error, "--base needs a ref");
    } else if (arg.startsWith("-") || options.tag !== null) throw new Stop(EXIT.error, `Unexpected argument: ${arg}`);
    else options.tag = arg;
  }
  if (options.continue && (options.tag || options.base || options.allowAgentConfig || !options.fetch)) {
    throw new Stop(EXIT.error, "--continue takes no other argument");
  }
  return options;
}

function start(root, options, log) {
  ensureClean(root);
  if (options.fetch) {
    if (git(root, ["remote", "get-url", "upstream"], { allowFail: true }) === null) {
      throw new Stop(EXIT.error, `No upstream remote: git remote add upstream ${UPSTREAM_URL}`);
    }
    if (gitVisible(root, ["fetch", "upstream", "--tags"]) !== 0) {
      throw new Stop(EXIT.error, "git fetch upstream --tags failed");
    }
  }
  const tag = options.tag ? parseTag(options.tag) : latestTag(gitLines(root, ["tag", "--list", "lavish-axi-v*"]));
  if (!tag) throw new Stop(EXIT.error, "No lavish-axi-vX.Y.Z tag found: fetch the upstream tags first.");
  if (!hasRef(root, `refs/tags/${tag}`)) throw new Stop(EXIT.error, `Unknown tag: ${tag}`);
  const base = resolveBase(root, options.base);
  if (isAncestor(root, tag, base)) {
    log(`${base} already contains ${tag}: nothing to merge.`);
    return EXIT.ok;
  }
  const branch = `update/v${TAG_PATTERN.exec(tag).slice(1).join(".")}`;
  if (hasRef(root, `refs/heads/${branch}`)) {
    throw new Stop(
      EXIT.error,
      `${branch} already exists: switch to it and run --continue, or delete it to start over.`,
    );
  }

  const mergeBase = git(root, ["merge-base", base, tag]);
  const agentConfig = gitLines(root, ["diff", "--name-only", mergeBase, tag, "--", ...AGENT_CONFIG_PATHSPECS]);
  if (agentConfig.length > 0 && !options.allowAgentConfig) {
    log(`${tag} changes agent configuration since the last merged release:\n`);
    gitVisible(root, ["--no-pager", "diff", "--stat", mergeBase, tag, "--", ...AGENT_CONFIG_PATHSPECS]);
    log("");
    gitVisible(root, ["--no-pager", "diff", mergeBase, tag, "--", ...AGENT_CONFIG_PATHSPECS]);
    throw new Stop(
      EXIT.decision,
      `needs-decision: ${tag} changes ${agentConfig.join(", ")}. Nothing was merged. Review the differences above; once approved, rerun with --allow-agent-config.`,
    );
  }

  git(root, ["config", "rerere.enabled", "true"]);
  git(root, ["config", "rerere.autoUpdate", "true"]);
  git(root, ["switch", "--quiet", "-c", branch, base]);
  log(`Merging ${tag} into ${branch} (from ${base}).`);
  const merged = gitVisible(root, ["merge", "--no-ff", "--no-edit", "-m", `Merge upstream ${tag} into carry`, tag]);
  if (merged !== 0) {
    if (!hasRef(root, "MERGE_HEAD")) throw new Stop(EXIT.error, `git merge ${tag} failed without starting a merge.`);
    const unmerged = gitLines(root, ["diff", "--name-only", "--diff-filter=U"]);
    if (unmerged.length === 0) {
      // rerere replayed every recorded resolution: only the commit is left.
      if (gitVisible(root, ["commit", "--no-edit"]) !== 0) throw new Stop(EXIT.error, "git commit of the merge failed");
    } else {
      stopOnConflicts(root, branch, unmerged);
    }
  }
  return finish(root, branch, tag, log);
}

function stopOnConflicts(root, branch, unmerged) {
  const { decisions, resolvable } = classifyConflicts(root, unmerged);
  const unmergedSet = new Set(unmerged);
  const problems = hookProblems(root, unmergedSet);
  if (decisions.length > 0 || problems.length > 0) {
    throw new Stop(
      EXIT.decision,
      `needs-decision: the merge needs more than putting hooks back; do not reinvent the graft.\n  ${[...decisions, ...problems].join("\n  ")}\nThe merge is left in progress for inspection. ${abortHint(branch)}`,
    );
  }
  throw new Stop(
    EXIT.conflicts,
    `Conflicts to resolve at hooks:\n  ${resolvable.join("\n  ")}\nResolve each by putting the hook back as listed in BRUVISH.md (keep upstream's new code, re-add the Bruvish line), git add the files, then run bruvish/scripts/update-upstream --continue. ${abortHint(branch)}`,
  );
}

function resume(root, log) {
  const branch = git(root, ["branch", "--show-current"]);
  const match = /^update\/v(\d+\.\d+\.\d+)$/.exec(branch);
  if (!match) throw new Stop(EXIT.error, "--continue runs on an update/vX.Y.Z branch.");
  const tag = `lavish-axi-v${match[1]}`;
  if (hasRef(root, "MERGE_HEAD")) {
    const unmerged = gitLines(root, ["diff", "--name-only", "--diff-filter=U"]);
    if (unmerged.length > 0) throw new Stop(EXIT.conflicts, `Still unresolved:\n  ${unmerged.join("\n  ")}`);
    const leftovers = gitLines(root, ["diff", "--cached", "--name-only", "HEAD"]).filter((file) => {
      const full = path.join(root, file);
      return existsSync(full) && conflictHunks(readFileSync(full, "utf8")).length > 0;
    });
    if (leftovers.length > 0) throw new Stop(EXIT.conflicts, `Conflict markers left in:\n  ${leftovers.join("\n  ")}`);
    if (gitLines(root, ["status", "--porcelain", "--untracked-files=all"]).some((line) => !/^[MADRC] /.test(line))) {
      throw new Stop(EXIT.error, "Unstaged or untracked changes: git add the resolution, set the rest aside.");
    }
    if (gitVisible(root, ["commit", "--no-edit"]) !== 0) throw new Stop(EXIT.error, "git commit of the merge failed");
  } else {
    ensureClean(root);
    if (!isAncestor(root, tag, "HEAD")) {
      throw new Stop(EXIT.error, `${branch} does not contain ${tag}: nothing to continue.`);
    }
  }
  return finish(root, branch, tag, log);
}

export function main(argv, { root = defaultRoot, log = console.log, error = console.error } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(USAGE);
      return EXIT.ok;
    }
    return options.continue ? resume(root, log) : start(root, options, log);
  } catch (caught) {
    if (!(caught instanceof Stop)) throw caught;
    error(caught.message);
    return caught.code;
  }
}
