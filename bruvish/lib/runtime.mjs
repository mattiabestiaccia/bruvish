import path from "node:path";
import { setTimeout as sleepFor } from "node:timers/promises";

// A probe that gets no answer is retried with a longer wait each time. A machine under heavy load
// answers /health late, not never, and a single 700 ms read used to turn that into a hard refusal.
const PROBE_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 250;

export class SlowServerError extends Error {
  constructor(attempts, waitedMs) {
    super(
      `The Lavish server is slow to answer: no reply to ${attempts} health checks in ${(waitedMs / 1000).toFixed(1)} s, ` +
        "most likely because the machine is under heavy load. The page was not refused and the server was not touched or replaced. " +
        "Retry in a few seconds.",
    );
    this.name = "SlowServerError";
  }
}

// One bounded GET, body included. Resolves { ok, body }; a connection error (nothing listening)
// rejects with that error, a missing answer rejects with an AbortError.
async function probeOnce(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, body: null };
    try {
      return { ok: true, body: await response.json() };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return { ok: true, body: null };
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function probe(fetchImpl, url, { timeoutMs, attempts, pauseMs, sleep }) {
  let waitedMs = 0;
  for (let attempt = 0; ; attempt += 1) {
    const attemptTimeout = timeoutMs * 2 ** attempt;
    try {
      return await probeOnce(fetchImpl, url, attemptTimeout);
    } catch (error) {
      if (error.name !== "AbortError") throw error;
      waitedMs += attemptTimeout;
      if (attempt + 1 >= attempts) throw new SlowServerError(attempts, waitedMs);
      const pause = pauseMs * 2 ** attempt;
      waitedMs += pause;
      await sleep(pause);
    }
  }
}

// Refuses to drive a server this installation does not own: a foreign service on the port, a
// Lavish server for another state directory, a plain upstream server (no /mb-info), or a Bruvish
// server of another build. Replacing it is an explicit operator step, never automatic.
// A server that is only slow to answer is retried (3 attempts, growing waits) and then reported as
// slow, never as refused. Upstream's own ensureServer then adopts or starts the server as usual.
export async function assertCompatibleServer(
  env,
  identity,
  {
    fetchImpl = fetch,
    timeoutMs = 700,
    attempts = PROBE_ATTEMPTS,
    pauseMs = RETRY_PAUSE_MS,
    sleep = (ms) => sleepFor(ms),
  } = {},
) {
  const options = { timeoutMs, attempts, pauseMs, sleep };
  const origin = `http://127.0.0.1:${env.LAVISH_AXI_PORT}`;
  let health;
  try {
    health = await probe(fetchImpl, `${origin}/health`, options);
  } catch (error) {
    if (error instanceof SlowServerError) throw error;
    return;
  }
  if (!health.ok) throw new Error("Port is occupied by a server without a healthy Lavish endpoint");
  const body = health.body ?? {};
  if (body.app !== "lavish-axi") throw new Error("Port belongs to another service");
  if (path.resolve(body.state_dir || "") !== path.resolve(env.LAVISH_AXI_STATE_DIR)) {
    throw new Error("Existing server uses another state directory; refusing to adopt it");
  }
  const response = await probe(fetchImpl, `${origin}/mb-info`, options);
  if (!response.ok) {
    throw new Error(
      "A non-Bruvish Lavish server is already running. Use the reviewed activation procedure; it will not be restarted automatically.",
    );
  }
  if (response.body?.identity !== identity) {
    throw new Error(
      "A Lavish server from another Bruvish build or the old overlay is running. This build does not drive or stop it: stop it with the build or service that started it, after checking listeners and preserving state.",
    );
  }
}
