import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packageUrl } from "./assets.mjs";
import { openingSurface } from "./surface.mjs";

// The app opener waits up to 120 s for the app's acknowledgement (LAVISH_APP_ACK_TIMEOUT_MS);
// the server gives it a little more before giving up on the opening.
export const OPENING_TIMEOUT_MS = 125_000;
const REASON_LIMIT = 1000;

export function execute(command, args, { env = process.env, timeoutMs = OPENING_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

// Which program shows a review: the dedicated app or a normal Chrome tab. Only the server calls
// this, with its own environment: the surface comes from its opening configuration, never from
// the caller of a request.
export function openingTarget(url, file, env = process.env) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Expected an HTTP review URL");
  if (openingSurface(env) === "app") {
    return {
      command: process.execPath,
      args: [fileURLToPath(packageUrl("app/open.mjs")), url, file],
    };
  }
  return { command: "/usr/bin/open", args: ["-a", "Google Chrome", url] };
}

function shortReason(text) {
  const trimmed = text.trim();
  return trimmed.length > REASON_LIMIT ? `…${trimmed.slice(-REASON_LIMIT)}` : trimmed;
}

// Opens a registered review in the configured surface. The result is what the CLI reports as
// `opening`: { status: "opened" } or { status: "failed", reason }.
export async function openSurface(url, file, { env = process.env, run = execute } = {}) {
  try {
    const target = openingTarget(url, file, env);
    const result = await run(target.command, target.args, { env });
    if (result.code === 0) return { status: "opened" };
    const detail = shortReason(result.stderr || "");
    const reason = result.timedOut
      ? "The opening surface did not finish in time; it was stopped."
      : detail || `The opening surface exited with ${result.signal || `code ${result.code}`}.`;
    return { status: "failed", reason };
  } catch (error) {
    return { status: "failed", reason: `Bruvish could not start the opening surface: ${error.message}` };
  }
}
