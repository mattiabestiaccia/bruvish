import { get as httpGet } from "node:http";
import path from "node:path";

const LOOPBACK = "127.0.0.1";
const PROBE_WINDOWS_MS = [700];
// `open` asks again with a longer wait each time. A machine under heavy load answers /health late,
// not never, and a single 700 ms read used to turn that into a hard refusal.
const OPEN_PROBE_WINDOWS_MS = [700, 1400, 2800];
const TIMED_OUT = Symbol("timed out");
const MAX_BODY_BYTES = 256 * 1024;

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

// One bounded GET over node:http, with the socket destroyed on every exit like upstream's
// fetchHealth, never fetch (docs/invariants.md, process model). Resolves TIMED_OUT when no full
// answer arrives in time, { unreachable } when the connection fails, otherwise { ok, body }. A body
// that cannot be read rejects.
function probeOnce(get, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let request = null;
    let answered = false;
    const finish = (settle, value) => {
      clearTimeout(timer);
      request?.destroy();
      settle(value);
    };
    const timer = setTimeout(() => finish(resolve, TIMED_OUT), timeoutMs);
    request = get(url, { agent: false }, (response) => {
      answered = true;
      response.on("error", (error) => finish(reject, error));
      if (response.statusCode < 200 || response.statusCode >= 300) return finish(resolve, { ok: false, body: null });
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) finish(reject, new Error(`Risposta troppo lunga da ${url}`));
      });
      response.on("end", () => {
        try {
          finish(resolve, { ok: true, body: JSON.parse(body) });
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    request.on("error", (error) => (answered ? finish(reject, error) : finish(resolve, { unreachable: error })));
  });
}

// Asks once per window while the answer is late. A closed port means "no server" (null) at any
// attempt: it is not a foreign server to drive, and upstream reads it the same way.
async function probe(get, url, endpoint, windows) {
  for (const windowMs of windows) {
    const result = await probeOnce(get, url, windowMs);
    if (result === TIMED_OUT) continue;
    if (result.unreachable) return null;
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
export async function assertCompatibleServer(env, identity, { get = httpGet } = {}) {
  const origin = `http://127.0.0.1:${env.LAVISH_AXI_PORT}`;
  const windows = probeWindows();
  const health = await probe(get, `${origin}/health`, "/health", windows);
  if (health === null) return;
  if (!health.ok) throw new Error("Port is occupied by a server without a healthy Lavish endpoint");
  if (health.body?.app !== "lavish-axi") throw new Error("Port belongs to another service");
  if (path.resolve(health.body.state_dir || "") !== path.resolve(env.LAVISH_AXI_STATE_DIR)) {
    throw new Error("Existing server uses another state directory; refusing to adopt it");
  }
  const info = await probe(get, `${origin}/mb-info`, "/mb-info", [windows.at(-1)]);
  if (info === null) return;
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
export async function discoverHealth(host, baseUrl, upstreamProbe, { get = httpGet } = {}) {
  if (!retrying || host !== LOOPBACK) return upstreamProbe();
  const health = await probe(get, `${baseUrl}/health`, "/health", probeWindows());
  return health?.ok && health.body && typeof health.body === "object" ? health.body : null;
}
