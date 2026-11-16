import { readFile } from "node:fs/promises";
import { assetUrl } from "./assets.mjs";
import { runtimeEnvironment } from "./env.mjs";
import { runtimeIdentity } from "./identity.mjs";
import { printRemoteStatus, verifyRemoteUrl } from "./remote.mjs";
import { assertCompatibleServer } from "./runtime.mjs";

export const HELP = `Bruvish: Lavish (upstream lavish-axi) with a personal delta; the command stays lavish-axi.
Opening follows the shared app/Chrome configuration (~/.config/lavish-mb/opening.json); without it, Chrome. LAVISH_MB_SURFACE=chrome overrides one call. --no-open only creates the session.
Presenting a review includes its verified remote.url for the phone and an immediate tracked poll. remote.catalog_url is the separately verified fixed catalog bookmark.
Existing session: lavish-axi remote <local-session-url> (read-only check).
Artifact style: lavish-axi design (upstream reference: lavish-axi design --upstream). Only native Send to Agent sends feedback.
`;

export const DESIGN_MISSING =
  "Bruvish style guide missing: it is personal and not in the repository. Generate bruvish/DESIGN.md with style-sync-ai and rebuild, as described in bruvish/DESIGN.placeholder.md. The upstream Lavish reference stays available: lavish-axi design --upstream";

// The personal style guide: BRUVISH_DESIGN, else the local copy the build put in dist/ (or, from
// source, bruvish/DESIGN.md). Neither is committed; a missing guide is a clear error.
async function readDesign(env) {
  try {
    return await readFile(env.BRUVISH_DESIGN || assetUrl("bruvish-design.md"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const REMOTE_USAGE =
  "Usage: lavish-axi remote <local-session-url>\nVerify the private Tailscale review URL and fixed catalog URL without creating, reopening or opening a review.";

// Commands that reach the server on the Bruvish port. They run only against a server of this build.
const SERVER_COMMANDS = new Set(["open", "poll", "reply", "end"]);

function isVersion(argv) {
  return argv.length === 1 && ["--version", "-v", "-V"].includes(argv[0]);
}

/**
 * The Bruvish entry point. `run` and `normalizeArgv` are upstream's (src/cli.js).
 * @param {string[]} argv
 * @param {{ run: (argv: string[]) => Promise<void>, normalizeArgv: (argv: string[]) => string[], env?: NodeJS.ProcessEnv }} upstream
 */
export async function runBruvish(argv, { run, normalizeArgv, env = process.env }) {
  // The version probe stays on upstream's fast path: no environment work, no server, no files.
  if (isVersion(argv)) return run(argv);
  Object.assign(env, runtimeEnvironment(env));
  try {
    if (argv[0] === "design" && argv.length === 1) {
      const design = await readDesign(env);
      if (design === null) {
        console.error(DESIGN_MISSING);
        process.exitCode = 1;
      } else process.stdout.write(`${design}\n`);
      return;
    }
    if (argv[0] === "design" && argv[1] === "--upstream") return run(["design", ...argv.slice(2)]);
    if (argv[0] === "remote") {
      if (argv.length !== 2 || argv[1] === "--help") {
        console.log(REMOTE_USAGE);
        process.exitCode = argv[1] === "--help" ? 0 : 1;
        return;
      }
      const identity = runtimeIdentity();
      await assertCompatibleServer(env, identity);
      const result = await verifyRemoteUrl(argv[1], env, identity);
      printRemoteStatus(result);
      process.exitCode = result.status === "ready" ? 0 : 1;
      return;
    }
    if (argv.length === 1 && argv[0] === "--help") process.stdout.write(`${HELP}\n`);
    const command = normalizeArgv(argv)[0];
    if (!command || SERVER_COMMANDS.has(command)) await assertCompatibleServer(env, runtimeIdentity());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  return run(argv);
}
