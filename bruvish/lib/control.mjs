import { openSurface } from "./opening.mjs";
import { verifyRemoteUrl } from "./remote.mjs";

// Server-side opening. `lavish-axi open` and `lavish-axi remote` run inside agent sandboxes, which
// can reach this loopback server but cannot start the app or Chrome, nor reach the tailnet. So the
// CLI sends only a session key, and the server does the rest: it reads the file and the URL of the
// session from its own state, picks the surface from its own opening configuration and verifies
// the phone link itself. No path, command, adapter or environment value comes from the request.
export const SESSION_KEY = /^[a-f0-9]{16}$/;
export const OPEN_ROUTE = "/mb/open";
export const REMOTE_ROUTE = "/mb/remote";
export const DEFAULT_LIMITS = Object.freeze({
  open: { limit: 12, windowMs: 60_000 },
  remote: { limit: 30, windowMs: 60_000 },
});

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PROXY_HEADER = /^(?:x-forwarded-|forwarded$|x-real-ip$|tailscale-)/;
const ALLOWED_FIELDS = new Set(["session", "no_gate"]);

// At most `limit` accepted calls in any `windowMs`; the answer is the wait in seconds, 0 when the
// call is accepted.
export function createRateLimiter({ limit, windowMs }, now = Date.now) {
  const hits = [];
  return () => {
    const time = now();
    while (hits.length && hits[0] <= time - windowMs) hits.shift();
    if (hits.length >= limit) return Math.max(1, Math.ceil((hits[0] + windowMs - time) / 1000));
    hits.push(time);
    return 0;
  };
}

function refuse(res, status, code, error, extra = {}) {
  res.status(status).json({ status: "error", code, error, ...extra });
}

function loopbackHost(value) {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

// Only the local CLI calls these routes. The upstream Host allowlist and Origin guard already ran;
// on top of them a control call must name a loopback host, carry no proxy header (the phone reaches
// this server through a Tailscale proxy) and come from no web page at all (no Origin or Referer).
function refusedCaller(req) {
  if (!loopbackHost(req.headers.host || "")) return "Server-side opening accepts only the local loopback host.";
  if (Object.keys(req.headers).some((name) => PROXY_HEADER.test(name)))
    return "Server-side opening does not accept proxied requests.";
  if (req.headers.origin !== undefined || req.headers.referer !== undefined)
    return "Server-side opening does not accept requests from web pages.";
  return null;
}

// The whole request is `{ session: "<16 hex>" }`, plus an optional `no_gate: true` that asks for the
// layout gate to be skipped in the opened URL, as `--no-gate` does. Anything else is refused.
function parseRequest(fields, { query = false } = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const names = Object.keys(fields);
  if (names.some((name) => !ALLOWED_FIELDS.has(name))) return null;
  const { session, no_gate: noGate = query ? undefined : false } = fields;
  if (typeof session !== "string" || !SESSION_KEY.test(session)) return null;
  if (query) {
    if (noGate !== undefined && noGate !== "1") return null;
    return { key: session, noGate: noGate === "1" };
  }
  if (typeof noGate !== "boolean") return null;
  return { key: session, noGate };
}

// The review URL the server stored for the session, never one from the request.
function reviewUrl(session, key, noGate) {
  const url = new URL(session.url);
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== `/session/${key}`)
    throw new Error("Stored session URL is not a review URL");
  url.search = "";
  url.hash = "";
  if (noGate) url.searchParams.set("no-gate", "1");
  return url.toString();
}

export function remoteBlock(remote) {
  const block = { status: remote.status };
  if (remote.url) block.url = remote.url;
  else block.reason = remote.reason;
  if (remote.catalog_url) block.catalog_url = remote.catalog_url;
  else if (remote.catalog_reason) block.catalog_reason = remote.catalog_reason;
  return block;
}

/**
 * Registers POST /mb/open and GET /mb/remote. `open` and `verify` are the server's own opening and
 * remote check; tests replace them so that nothing is opened and no network is used.
 * @param {any} app
 * @param {{ store: { findByKey: (key: string) => Promise<any> }, identity: string, env?: NodeJS.ProcessEnv,
 *   open?: typeof openSurface, verify?: typeof verifyRemoteUrl, limits?: typeof DEFAULT_LIMITS, now?: () => number }} options
 */
export function registerControlRoutes(
  app,
  { store, identity, env = process.env, open = openSurface, verify = verifyRemoteUrl, limits = DEFAULT_LIMITS, now },
) {
  const limiters = {
    open: createRateLimiter(limits.open, now),
    remote: createRateLimiter(limits.remote, now),
  };

  // Shared checks; answers the request and returns null when it is refused.
  async function admit(req, res, kind, fields, query) {
    const callerProblem = refusedCaller(req);
    if (callerProblem) {
      refuse(res, 403, "FORBIDDEN_CALLER", callerProblem);
      return null;
    }
    const wait = limiters[kind]();
    if (wait) {
      res.setHeader("retry-after", String(wait));
      refuse(res, 429, "RATE_LIMITED", `Too many ${kind} requests; retry in ${wait} s.`);
      return null;
    }
    const request = parseRequest(fields, { query });
    if (!request) {
      refuse(
        res,
        400,
        "INVALID_REQUEST",
        query
          ? 'Expected only "session" (16 hex characters) and optionally "no_gate=1".'
          : 'Expected a JSON object with only "session" (16 hex characters) and optionally "no_gate" (boolean).',
      );
      return null;
    }
    const session = await store.findByKey(request.key);
    if (!session) {
      refuse(res, 404, "UNKNOWN_SESSION", "No registered session has this key; create it with lavish-axi open first.");
      return null;
    }
    return { ...request, session };
  }

  app.post(OPEN_ROUTE, async (req, res, next) => {
    try {
      const admitted = await admit(req, res, "open", req.body, false);
      if (!admitted) return;
      const { key, noGate, session } = admitted;
      // Reopening an ended review is the upstream session route's decision (`--reopen`); this
      // route only shows a session that is open now.
      if (session.status === "ended") {
        refuse(res, 409, "SESSION_ENDED", "This session has ended; it is not opened again.", {
          ended_by: session.ended_by || null,
        });
        return;
      }
      if (!/\.html?$/i.test(session.file || "")) {
        refuse(res, 403, "NOT_HTML", "The session does not name an HTML artifact.");
        return;
      }
      const opening = await open(reviewUrl(session, key, noGate), session.file, { env });
      res.json({ session: key, opening });
    } catch (error) {
      next(error);
    }
  });

  // Read-only: it never creates, reopens or opens a session, so it also answers for ended ones.
  app.get(REMOTE_ROUTE, async (req, res, next) => {
    try {
      const admitted = await admit(req, res, "remote", { ...req.query }, true);
      if (!admitted) return;
      const { key, noGate, session } = admitted;
      const remote = await verify(reviewUrl(session, key, noGate), env, identity);
      res.json({ session: key, remote: remoteBlock(remote) });
    } catch (error) {
      next(error);
    }
  });
}
