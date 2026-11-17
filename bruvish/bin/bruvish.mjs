#!/usr/bin/env node
// Bruvish artifact tools that do not need a server: the renderer and explicit state deltas.
// Sessions, opening, polling and remote checks go through `lavish-axi`.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyDelta, atomicJson, renderDocument } from "../lib/document.mjs";

const args = process.argv.slice(2);
const help = `Bruvish artifact tools
  render input.json --output page.html   Generate a standalone artifact; no server/open.
                                         Re-rendering the same output keeps its theme and marks
                                         cards new/changed since the previous revision.
  state apply state.json delta.json     Explicit canonical answers/comments delta.
Present the page with: lavish-axi page.html (style guide: lavish-axi design).
`;
try {
  if (!args.length || args[0] === "--help" || args[0] === "help") console.log(help);
  else if (args[0] === "state" && args[1] === "apply" && args.length === 4) {
    const current = JSON.parse(await readFile(args[2], "utf8"));
    const delta = JSON.parse(await readFile(args[3], "utf8"));
    await atomicJson(args[2], applyDelta(current, delta));
    console.log("State saved; only explicit deltas applied.");
  } else if (args[0] === "render" && args[2] === "--output" && args.length === 4) {
    const input = JSON.parse(await readFile(args[1], "utf8"));
    // The previous page of the same artifact carries its theme and card fingerprints (novelty).
    const previous = await readFile(args[3], "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    await writeFile(args[3], await renderDocument(input, { id: path.resolve(args[3]), previous }));
    console.log(args[3]);
  } else throw new Error(help);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
