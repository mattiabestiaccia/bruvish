import { CONTROL_HEADER, OPEN_ROUTE, REMOTE_ROUTE, SESSION_KEY } from "./control.mjs";
import { OPENING_TIMEOUT_MS } from "./opening.mjs";

// The CLI side of server-side opening (control.mjs). Both calls go to the loopback Bruvish server and
// carry only the session key, so they work from inside an agent sandbox. When the server cannot do
// it, the CLI says so and stops there: it never falls back to opening or verifying by itself.
const REMOTE_TIMEOUT_MS = 10_000;

export class ControlError extends Error {}

function controlOrigin(env) {
  return `http://127.0.0.1:${env.LAVISH_AXI_PORT}`;
}

async function call(env, method, route, { body = undefined, query = undefined, timeoutMs, fetchImpl = fetch }) {
  const origin = controlOrigin(env);
  const url = new URL(route, origin);
  for (const [name, value] of Object.entries(query || {})) url.searchParams.set(name, value);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { [CONTROL_HEADER]: "1", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const waited = error.name === "TimeoutError" || error.name === "AbortError";
    throw new ControlError(
      waited
        ? `The Bruvish server at ${origin} did not answer ${route} in time.`
        : `The Bruvish server at ${origin} is not responding (${error.message}).`,
    );
  }
  let answer = null;
  try {
    answer = await response.json();
  } catch {
    // Not a Bruvish answer: handled below.
  }
  if (response.status === 404 && answer?.code !== "UNKNOWN_SESSION") {
    throw new ControlError(
      `The Lavish server at ${origin} is not this Bruvish build: it has no ${route}. Server-side opening is unavailable; nothing was opened or verified.`,
    );
  }
  if (!response.ok || !answer) {
    throw new ControlError(
      `The Bruvish server refused ${route} (HTTP ${response.status}): ${answer?.error || "unexpected answer"}`,
    );
  }
  return answer;
}

/** @param {string} key @param {NodeJS.ProcessEnv} env */
export async function requestRemote(key, env, { noGate = false, fetchImpl = undefined } = {}) {
  const query = { session: key, ...(noGate ? { no_gate: "1" } : {}) };
  const answer = await call(env, "GET", REMOTE_ROUTE, { query, timeoutMs: REMOTE_TIMEOUT_MS, fetchImpl });
  if (!answer.remote || typeof answer.remote.status !== "string") throw new ControlError("Unexpected remote answer");
  return answer.remote;
}

/** @param {string} key @param {NodeJS.ProcessEnv} env */
export async function requestOpening(key, env, { noGate = false, fetchImpl = undefined } = {}) {
  const body = { session: key, ...(noGate ? { no_gate: true } : {}) };
  const answer = await call(env, "POST", OPEN_ROUTE, { body, timeoutMs: OPENING_TIMEOUT_MS + 10_000, fetchImpl });
  if (!answer.opening || typeof answer.opening.status !== "string") throw new ControlError("Unexpected opening answer");
  return answer.opening;
}

function parseSessionUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const match = /^\/session\/([a-f0-9]{16})$/.exec(url.pathname);
  if (url.protocol !== "http:" || url.username || url.password || url.hash || !match || !SESSION_KEY.test(match[1]))
    return null;
  return { url, key: match[1], noGate: url.searchParams.get("no-gate") === "1" };
}

// The review URL that upstream `open` just printed, whatever link host it was configured with.
export function sessionFromReviewUrl(value) {
  const parsed = parseSessionUrl(value);
  return parsed && { key: parsed.key, noGate: parsed.noGate };
}

// A review URL given to `lavish-axi remote`: it must name this local service. Anything else is
// refused before the server is asked.
export function sessionFromUrl(value, env) {
  const parsed = parseSessionUrl(value);
  if (
    !parsed ||
    !["127.0.0.1", "localhost"].includes(parsed.url.hostname) ||
    parsed.url.port !== String(env.LAVISH_AXI_PORT)
  )
    return null;
  return { key: parsed.key, noGate: parsed.noGate };
}
