import path from "node:path";
import os from "node:os";
import { remoteSettings } from "./remote.mjs";

// The Bruvish runtime is the upstream Lavish runtime plus the delta in bruvish/. Upstream code
// reaches the delta only through the `BRUVISH:hook` points, and every hook is inert unless this
// variable is "1". The Bruvish entry point, the daemon and the app set it; the plain upstream
// entry (`bin/lavish-axi.js`) and the upstream test suite never do, so they keep upstream behavior.
export const RUNTIME_FLAG = "LAVISH_BRUVISH";

export const DEFAULT_PORT = "4388";
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".local/state/lavish-axi-compact");

export function isBruvishRuntime(env = process.env) {
  return env[RUNTIME_FLAG] === "1";
}

// Defaults of the always-on service: fixed port and state directory, loopback-only listener
// (the phone reaches it through a Tailscale HTTPS proxy, never through a Tailscale bind), and no
// upstream browser opening: Bruvish opens the configured app/Chrome surface itself.
// Telemetry is not touched here: a build without LAVISH_AXI_UMAMI_WEBSITE_ID sends nothing.
export function runtimeEnvironment(env = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const result = {
    ...env,
    [RUNTIME_FLAG]: "1",
    LAVISH_AXI_PORT: env.LAVISH_AXI_PORT || DEFAULT_PORT,
    LAVISH_AXI_STATE_DIR: env.LAVISH_AXI_STATE_DIR || DEFAULT_STATE_DIR,
    LAVISH_AXI_HOST: env.LAVISH_AXI_HOST ?? "127.0.0.1",
    LAVISH_AXI_LINK_HOST: env.LAVISH_AXI_LINK_HOST ?? "127.0.0.1",
    LAVISH_AXI_NO_OPEN: "1",
  };
  const remote = remoteSettings(result);
  if (remote.status === "configured") {
    const names = new Set((result.LAVISH_AXI_ALLOWED_HOSTS || "").split(/\s+/).filter(Boolean));
    names.add(remote.hostname);
    result.LAVISH_AXI_ALLOWED_HOSTS = [...names].join(" ");
  }
  return result;
}
