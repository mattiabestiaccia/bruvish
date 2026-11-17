import { isBruvishRuntime } from "./env.mjs";
import { requestOpening, requestRemote, sessionFromReviewUrl } from "./control-client.mjs";

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

// Called by upstream openCommand (`BRUVISH:hook open-present`) with the output it is about to
// return. Upstream never reaches its own browser opening here: the runtime sets
// LAVISH_AXI_NO_OPEN=1. The server verifies the phone link and, unless --no-open was given, opens
// the configured surface (control.mjs); this process only sends it the session key.
export async function presentBruvishOpen(
  output,
  { args = [], env = process.env, remote: askRemote = requestRemote, open: askOpening = requestOpening } = {},
) {
  if (!isBruvishRuntime(env)) return output;
  const session = sessionFromReviewUrl(output.session.url);
  const warned = new Set();
  const warn = (message) => {
    if (!warned.has(message)) process.stderr.write(`${message}\n`);
    warned.add(message);
  };
  const ask = async (request, failed) => {
    try {
      if (!session) throw new Error("The session URL is not a Lavish review URL.");
      return await request(session.key, env, { noGate: session.noGate });
    } catch (error) {
      warn(error.message);
      return failed(error.message);
    }
  };
  const remote = await ask(askRemote, (reason) => ({ status: "unavailable", reason }));
  const { next_step: nextStep, ...rest } = output;
  const presented = { ...rest, remote };
  if (!args.includes("--no-open")) {
    const opening = await ask(askOpening, (reason) => ({ status: "failed", reason }));
    if (opening.status !== "opened") {
      if (!warned.has(opening.reason)) warn(`Bruvish opening failed: ${opening.reason}`);
      // The session exists and its links stay valid; the exit status reports the failed window.
      process.exitCode = 1;
    }
    presented.opening = opening;
  }
  return { ...presented, next_step: presentationPrefix(remote) + nextStep };
}
