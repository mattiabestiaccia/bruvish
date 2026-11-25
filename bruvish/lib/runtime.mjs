import path from "node:path";

const LOOPBACK = "127.0.0.1";
const PROBE_WINDOWS_MS = [700];
// `open` asks again with a longer wait each time. A machine under heavy load answers /health late,
// not never, and a single 700 ms read used to turn that into a hard refusal.
const OPEN_PROBE_WINDOWS_MS = [700, 1400, 2800];
const TIMED_OUT = Symbol("timed out");

let retrying = false;

// Set by the entry point before the server check: only `open` (and its short form) retries.
export function retrySlowServer(enabled) {
  retrying = enabled;
}

const probeWindows = () => (retrying ? OPEN_PROBE_WINDOWS_MS : PROBE_WINDOWS_MS);

export class SlowServerError extends Error {
  constructor(endpoint, windows) {
    const attempts = windows.length === 1 ? "1 tentativo" : `${windows.length} tentativi`;
    const seconds = (windows.reduce((sum, ms) => sum + ms, 0) / 1000).toFixed(1).replace(".", ",");
    super(
      `Il server Lavish risponde lentamente. Il controllo ${endpoint} è scaduto dopo ${attempts} in ${seconds} s. ` +
        "Riprova tra qualche secondo.",
    );
    this.name = "SlowServerError";
  }
}

// One bounded GET, body included: TIMED_OUT when no full answer arrives in time, { unreachable }
// when the connection fails, otherwise { ok, body }. A body that cannot be read rejects.
async function probeOnce(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, redirect: "manual" });
    } catch (error) {
      return error.name === "AbortError" ? TIMED_OUT : { unreachable: error };
    }
    if (!response.ok) return { ok: false, body: null };
    return { ok: true, body: await response.json() };
  } catch (error) {
    if (error.name === "AbortError") return TIMED_OUT;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Asks once per window while the answer is late. Only a first /health attempt that finds nothing
// listening means "no server" (null): a connection failure after a late answer proves nothing.
async function probe(fetchImpl, url, endpoint, windows) {
  for (const [attempt, windowMs] of windows.entries()) {
    const result = await probeOnce(fetchImpl, url, windowMs);
    if (result === TIMED_OUT) continue;
    if (result.unreachable) {
      if (endpoint === "/health" && attempt === 0) return null;
      throw result.unreachable;
    }
    return result;
  }
  throw new SlowServerError(endpoint, windows);
}

// Refuses to drive a server this installation does not own: a foreign service on the port, a
// Lavish server for another state directory, a plain upstream server (no /mb-info), or a Bruvish
// server of another build. Replacing it is an explicit operator step, never automatic.
// For `open`, a server that is only slow to answer /health is asked three times with growing waits
// and then reported as slow, never as refused; /mb-info is read once, with the longest wait.
// Upstream's own ensureServer then adopts or starts the server as usual.
export async function assertCompatibleServer(env, identity, { fetchImpl = fetch } = {}) {
  const origin = `http://127.0.0.1:${env.LAVISH_AXI_PORT}`;
  const windows = probeWindows();
  const health = await probe(fetchImpl, `${origin}/health`, "/health", windows);
  if (health === null) return;
  if (!health.ok) throw new Error("Port is occupied by a server without a healthy Lavish endpoint");
  if (health.body?.app !== "lavish-axi") throw new Error("Port belongs to another service");
  if (path.resolve(health.body.state_dir || "") !== path.resolve(env.LAVISH_AXI_STATE_DIR)) {
    throw new Error("Existing server uses another state directory; refusing to adopt it");
  }
  const info = await probe(fetchImpl, `${origin}/mb-info`, "/mb-info", [windows.at(-1)]);
  if (!info.ok) {
    throw new Error(
      "A non-Bruvish Lavish server is already running. Use the reviewed activation procedure; it will not be restarted automatically.",
    );
  }
  if (info.body?.identity !== identity) {
    throw new Error(
      "A Lavish server from another Bruvish build or the old overlay is running. This build does not drive or stop it: stop it with the build or service that started it, after checking listeners and preserving state.",
    );
  }
}

// Upstream discovery (`BRUVISH:hook open-discovery`) decides whether to adopt or start a server
// from one short /health read per candidate address. For `open`, loopback, where the Bruvish
// server listens, gets the same growing waits as the check above, so a late answer is reported as
// slow instead of being taken for a free port and a second server start. Elsewhere it is upstream's.
export async function discoverHealth(host, baseUrl, upstreamProbe, { fetchImpl = fetch } = {}) {
  if (!retrying || host !== LOOPBACK) return upstreamProbe();
  const health = await probe(fetchImpl, `${baseUrl}/health`, "/health", probeWindows());
  return health?.ok && health.body && typeof health.body === "object" ? health.body : null;
}
