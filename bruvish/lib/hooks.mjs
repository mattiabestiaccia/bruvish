import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Every place where Bruvish touches an upstream file carries a `BRUVISH:hook <id>` marker. This is
// the full list, by upstream file. bruvish/test/hooks.test.mjs checks it against the tree and
// bruvish/scripts/update-upstream checks it after merging an upstream release. Keep it in step
// with the hook table in BRUVISH.md.
export const HOOKS = Object.freeze({
  "src/server.js": ["server-import", "server-routes", "artifact-script"],
  "src/cli.js": ["open-import", "open-present", "open-discovery"],
  "scripts/build.js": ["build"],
  ".prettierignore": ["prettier"],
  ".github/workflows/ci.yml": ["workflow-ci"],
  ".github/workflows/release-please.yml": ["workflow-release"],
  "test/release-ci-exclusions.test.js": ["test-ci-exclusions"],
});

export function countHookMarker(source, id) {
  return source.split(`BRUVISH:hook ${id}`).length - 1;
}

// One line per hook that is not present exactly once in the tree at `root`. Files named in `skip`
// (for example files still in conflict) are not read.
export function hookProblems(root, skip = new Set()) {
  const problems = [];
  for (const [file, ids] of Object.entries(HOOKS)) {
    if (skip.has(file)) continue;
    const full = path.join(root, file);
    if (!existsSync(full)) {
      problems.push(`${file}: file missing (hooks ${ids.join(", ")})`);
      continue;
    }
    const source = readFileSync(full, "utf8");
    for (const id of ids) {
      const count = countHookMarker(source, id);
      if (count !== 1) problems.push(`${file}: expected one BRUVISH:hook ${id}, found ${count}`);
    }
  }
  return problems;
}
