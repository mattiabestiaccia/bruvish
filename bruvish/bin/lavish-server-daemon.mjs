#!/usr/bin/env node
// Keeps the Bruvish service (port 4388, canonical state) running for the fixed phone catalog.
// A LaunchAgent (personal configuration, not in this repository) starts it at login and restarts
// it whenever it exits. It never replaces a server it did not start: while a compatible server
// already listens, it waits for that server to stop, then takes over.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { runtimeEnvironment } from "../lib/env.mjs";
import { readManifest } from "../lib/identity.mjs";
import { assertCompatibleServer } from "../lib/runtime.mjs";

const log = (message) => console.log(`${new Date().toISOString()} lavish-server-daemon: ${message}`);
const dist = new URL("../../dist/", import.meta.url);
const manifest = readManifest(new URL("bruvish-manifest.json", dist));
if (!manifest) throw new Error("Bruvish build missing: run the build before starting the daemon");
// No idle shutdown: the catalog must answer from the phone at any time.
const env = { ...runtimeEnvironment(process.env), LAVISH_AXI_IDLE_TIMEOUT_MS: "off" };
const healthy = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${env.LAVISH_AXI_PORT}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

let waiting = false;
while (await healthy()) {
  // Refuses foreign services, other state directories, plain upstream servers and other builds.
  await assertCompatibleServer(env, manifest.identity);
  if (!waiting) log(`a compatible server already listens on ${env.LAVISH_AXI_PORT}; waiting for it to stop`);
  waiting = true;
  await sleep(30_000);
}

log(
  `starting server on 127.0.0.1:${env.LAVISH_AXI_PORT}, state ${env.LAVISH_AXI_STATE_DIR}, build ${manifest.identity} (upstream ${manifest.upstreamVersion})`,
);
const server = fileURLToPath(new URL("server.mjs", dist));
const child = spawn(process.execPath, [server, "server", "--port", env.LAVISH_AXI_PORT], { env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  log(`server exited (${signal || code})`);
  process.exit(code ?? 1);
});
