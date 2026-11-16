import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openingSurface } from "./surface.mjs";
import { isBruvishRuntime } from "./env.mjs";
import { runtimeIdentity } from "./identity.mjs";
import { verifyRemoteUrl } from "./remote.mjs";

export function execute(command, args, { env = process.env, input = undefined, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    if (!inherit) {
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.stdin.end(input);
    }
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

// Which program shows a review: an explicit adapter, the dedicated app, or a normal Chrome tab.
export function openingTarget(url, file, adapter, env = process.env) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Expected an HTTP review URL");
  if (adapter) return { command: adapter, args: [url, file] };
  if (openingSurface(env) === "app") {
    return {
      command: process.execPath,
      args: [fileURLToPath(new URL("../../app/open.mjs", import.meta.url)), url, file],
    };
  }
  return { command: "/usr/bin/open", args: ["-a", "Google Chrome", url] };
}

// The upstream next_step starts the review loop with "Do not respond to the user just yet". The
// phone needs to see the link first, so Bruvish prefixes one exception instead of rewriting the
// upstream sentence: if upstream rewords it, this prefix still reads correctly.
export function presentationPrefix(remote) {
  const phone =
    remote.status === "ready"
      ? "include the exact remote.url above as the phone link"
      : "explain that phone access is unavailable using remote.reason above; do not invent a phone link";
  return `Bruvish presentation: after this command completes successfully, send one visible progress message to the user with the review question and ${phone}. That message is the only exception to the instruction below not to respond yet: it does not finalize the turn. Then, without waiting for another request, follow the rest of this step. `;
}

export function remoteBlock(remote) {
  const block = { status: remote.status };
  if (remote.url) block.url = remote.url;
  else block.reason = remote.reason;
  if (remote.catalog_url) block.catalog_url = remote.catalog_url;
  else if (remote.catalog_reason) block.catalog_reason = remote.catalog_reason;
  return block;
}

// Called by upstream openCommand (`BRUVISH:hook open-present`) with the output it is about to
// return. Upstream never reaches its own browser opening here: the runtime sets
// LAVISH_AXI_NO_OPEN=1, and this hook opens the configured surface unless --no-open was given.
export async function presentBruvishOpen(output, { args = [], env = process.env, verify = verifyRemoteUrl } = {}) {
  if (!isBruvishRuntime(env)) return output;
  const { url, file } = output.session;
  const remote = await verify(url, env, runtimeIdentity());
  const { next_step: nextStep, ...rest } = output;
  const presented = { ...rest, remote: remoteBlock(remote) };
  if (!args.includes("--no-open")) {
    const target = openingTarget(url, file, env.LAVISH_MB_OPEN_ADAPTER, env);
    const opened = await execute(target.command, target.args, { env }).catch((error) => ({
      code: null,
      stderr: `Bruvish could not start the opening surface: ${error.message}\n`,
    }));
    if (opened.stderr) process.stderr.write(opened.stderr);
    presented.opening = opened.code === 0 ? { status: "opened" } : { status: "failed", exit_code: opened.code };
    // The session exists and its links stay valid; the exit status reports the failed window.
    if (opened.code !== 0) process.exitCode = 1;
  }
  return { ...presented, next_step: presentationPrefix(remote) + nextStep };
}
