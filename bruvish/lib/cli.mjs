import { readFile } from "node:fs/promises";
import { assetUrl } from "./assets.mjs";
import { runtimeEnvironment } from "./env.mjs";
import { runtimeIdentity } from "./identity.mjs";
import { requestMetadata, requestRemote, sessionFromUrl } from "./control-client.mjs";
import { printRemoteStatus } from "./remote.mjs";
import { assertCompatibleServer, retrySlowServer } from "./runtime.mjs";

export const HELP = `Bruvish: Lavish (upstream lavish-axi) with a personal delta; the command stays lavish-axi.
The Bruvish server opens the review and verifies the phone link: the command sends it only the session key, so open and remote also work inside an agent sandbox, provided the server runs outside it (started by the LaunchAgent service or from a normal terminal). The server picks the surface from its own configuration (~/.config/lavish-mb/opening.json: app or Chrome; without it, Chrome); a call cannot override it. If no server is running, a sandboxed open starts one inside the sandbox: the opening then fails with a clear error and that caller's environment pins the surface until the server stops. --no-open only creates the session.
Presenting a review includes its verified remote.url for the phone and an immediate tracked poll. remote.catalog_url is the separately verified fixed catalog bookmark.
Existing session: lavish-axi remote <local-session-url> (read-only check by the server).
Record an artifact's latest agent work: lavish-axi metadata --help.
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

const METADATA_USAGE = `Usage: lavish-axi metadata <local-session-url> --agent <name> --profile <profile> --session-id <agent-session-id> --worked-at <UTC-ISO-date>
Records the latest actual work, not a review open. Use the agent session ID, not the Lavish review key. A repeated or older record does not change the catalog.
Example: lavish-axi metadata http://127.0.0.1:4388/session/0123456789abcdef --agent Pi --profile pib --session-id agent-123 --worked-at 2026-11-22T09:20:00Z`;

const REMOTE_USAGE =
  "Usage: lavish-axi remote <local-session-url>\nAsk the Bruvish server to verify the private Tailscale review URL and fixed catalog URL of a registered session, without creating, reopening or opening a review.";

// Commands that reach the server on the Bruvish port. They run only against a server of this build.
const SERVER_COMMANDS = new Set(["open", "poll", "reply", "end", "stop"]);

// `stop` acts on its --port when given (upstream stopCommand, same parsing as upstream flagValue).
function portFlag(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--") return null;
    if (args[i] === "--port") return args[i + 1] || null;
    if (args[i].startsWith("--port=")) return args[i].slice("--port=".length) || null;
  }
  return null;
}

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
    if (argv[0] === "metadata") {
      if (argv.length === 2 && argv[1] === "--help") {
        console.log(METADATA_USAGE);
        return;
      }
      const session = sessionFromUrl(argv[1], env);
      const fields = new Map([
        ["--agent", "agent"],
        ["--profile", "profile"],
        ["--session-id", "sessionId"],
        ["--worked-at", "workedAt"],
      ]);
      const metadata = {};
      for (let i = 2; i + 1 < argv.length; i += 2) {
        const key = fields.get(argv[i]);
        if (!key || Object.hasOwn(metadata, key) || argv[i + 1].startsWith("--")) break;
        metadata[key] = argv[i + 1];
      }
      if (!session || argv.length !== 10 || Object.keys(metadata).length !== 4) {
        console.error(METADATA_USAGE);
        process.exitCode = 2;
        return;
      }
      await assertCompatibleServer(env, runtimeIdentity());
      console.log(JSON.stringify(await requestMetadata(session.key, metadata, env)));
      return;
    }
    if (argv[0] === "remote") {
      if (argv.length !== 2 || argv[1] === "--help") {
        console.log(REMOTE_USAGE);
        process.exitCode = argv[1] === "--help" ? 0 : 1;
        return;
      }
      const session = sessionFromUrl(argv[1], env);
      if (!session) throw new Error(`Expected a session URL of the configured Bruvish service.\n${REMOTE_USAGE}`);
      await assertCompatibleServer(env, runtimeIdentity());
      const result = await requestRemote(session.key, env, { noGate: session.noGate });
      printRemoteStatus(result);
      process.exitCode = result.status === "ready" ? 0 : 1;
      return;
    }
    if (argv.length === 1 && argv[0] === "--help") process.stdout.write(`${HELP}\n`);
    const [command, ...args] = normalizeArgv(argv);
    if (!command || SERVER_COMMANDS.has(command)) {
      const port = command === "stop" ? portFlag(args) : null;
      retrySlowServer(command === "open");
      await assertCompatibleServer(port ? { ...env, LAVISH_AXI_PORT: port } : env, runtimeIdentity());
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  return run(argv);
}
