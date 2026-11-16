import path from "node:path";

// Refuses to drive a server this installation does not own: a foreign service on the port, a
// Lavish server for another state directory, a plain upstream server (no /mb-info), or a Bruvish
// server of another build. Replacing it is an explicit operator step, never automatic.
// Upstream's own ensureServer then adopts or starts the server as usual.
export async function assertCompatibleServer(env, identity, { fetchImpl = fetch, timeoutMs = 700 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let health;
    try {
      health = await fetchImpl(`http://127.0.0.1:${env.LAVISH_AXI_PORT}/health`, { signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error("Existing server health timed out; refusing automatic replacement");
      return;
    }
    if (!health.ok) throw new Error("Port is occupied by a server without a healthy Lavish endpoint");
    const body = await health.json();
    if (body.app !== "lavish-axi") throw new Error("Port belongs to another service");
    if (path.resolve(body.state_dir || "") !== path.resolve(env.LAVISH_AXI_STATE_DIR)) {
      throw new Error("Existing server uses another state directory; refusing to adopt it");
    }
    const response = await fetchImpl(`http://127.0.0.1:${env.LAVISH_AXI_PORT}/mb-info`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        "A non-Bruvish Lavish server is already running. Use the reviewed activation procedure; it will not be restarted automatically.",
      );
    }
    const info = await response.json();
    if (info.identity !== identity) {
      throw new Error(
        "A Lavish server from another Bruvish build or the old overlay is running. Stop it explicitly after checking listeners and preserving state.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
