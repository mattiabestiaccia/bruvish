import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { renderCatalog } from "./catalog-page.mjs";
import { assetUrl, readAsset } from "./assets.mjs";
import { isBruvishRuntime } from "./env.mjs";
import { runtimeIdentity } from "./identity.mjs";

export const ARTIFACT_SCRIPT = '<script src="/mb-artifact.js"></script>';

const CATALOG_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";
const CATALOG_UNAVAILABLE =
  '<!doctype html><html lang="it"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lavish</title><h1>Catalogo non disponibile</h1><p>Non è stato possibile leggere il catalogo. Nessun dato è stato modificato. Riprova fra poco.</p></html>';
const CATALOG_ASSETS = [
  ["mb-catalog.css", "text/css"],
  ["mb-catalog-fonts.css", "text/css"],
  ["mb-catalog.js", "application/javascript"],
];

// The catalog reader is CommonJS because the Electron app requires it too. Bundled ESM cannot
// require node builtins, so it is loaded at runtime from its own file (copied into dist/).
function loadCatalog() {
  return createRequire(import.meta.url)(fileURLToPath(assetUrl("mb-catalog.cjs")));
}

// Registered in src/server.js before the upstream landing route, after the Host and Origin guards,
// so the catalog replaces the landing page and stays behind the same host allowlist.
export function registerBruvishRoutes(app, { stateFile, version, env = process.env }) {
  if (!isBruvishRuntime(env)) return;
  const identity = runtimeIdentity();
  app.get("/mb-info", (_req, res) => {
    res.json({ app: "lavish-mb", product: "bruvish", identity, upstreamVersion: version });
  });
  app.get("/mb-artifact.js", async (_req, res, next) => {
    try {
      res.type("application/javascript").send(await readAsset("mb-artifact.js"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/", async (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-security-policy", CATALOG_CSP);
    try {
      const html = renderCatalog(await loadCatalog().listReviews(path.dirname(stateFile)));
      res.setHeader("x-lavish-catalog", "1");
      res.type("html").send(html);
    } catch {
      res.status(503).type("html").send(CATALOG_UNAVAILABLE);
    }
  });
  for (const [name, type] of CATALOG_ASSETS) {
    app.get(`/${name}`, async (_req, res, next) => {
      try {
        res.setHeader("cache-control", "no-cache");
        res.type(type).send(await readAsset(name));
      } catch (error) {
        next(error);
      }
    });
  }
}

// Same body lookup as upstream src/html-transform.js (not exported there).
function findBodyElement(node) {
  if (node.tagName === "body") return node;
  if (!Array.isArray(node.childNodes)) return null;
  for (const child of node.childNodes) {
    const found = findBodyElement(child);
    if (found) return found;
  }
  return null;
}

function bodyCloseIndex(html) {
  const body = findBodyElement(parse(html, { sourceCodeLocationInfo: true }));
  const endTag = body && body.sourceCodeLocation && body.sourceCodeLocation.endTag;
  return endTag ? endTag.startOffset : -1;
}

// Takes the HTML that upstream `injectLavishSdk` returned and puts the Bruvish artifact bridge
// directly after the SDK tag: upstream inserts the SDK right before the body end tag (or appends
// it), so the body end tag of its output, or the end of the output, is the spot after the SDK.
export function injectBruvishArtifactScript(html, env = process.env) {
  if (!isBruvishRuntime(env)) return html;
  const index = bodyCloseIndex(html);
  if (index === -1) return `${html}${ARTIFACT_SCRIPT}`;
  return `${html.slice(0, index)}${ARTIFACT_SCRIPT}${html.slice(index)}`;
}
