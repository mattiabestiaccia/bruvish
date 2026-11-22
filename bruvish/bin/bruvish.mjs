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
Card JSON (full example: bruvish/examples/carte-complete.json):
  fields: [{"label": "Oggi", "paragraphs": ["..."]}]   two-column table after the paragraphs
  question.reason: "..."                               why the recommended option, under the answers
Building blocks (full example: bruvish/examples/revisione-completa.json), all optional:
  page: tabs: true, header: {badge: {text, tone, icon}, subtitle, meta: []}, pills: [{text, tone}]
  page: header.notice: "..."                           dashed box above the header (mockup, test page)
  page: header.stat: {added, removed}                  closes the subtitle: +added green, -removed red
  page: pills: [{text, tone, level: true}]             a level (risk): full semantic colour
  page: theme: "revisione"                             look of the approved review page; asked by name only.
        With tabs the tab names the section (no heading); a title ending in " #6" shows the number
        muted; a card with a diff is the files page: no card frame, one Chiudi/Apri tutti button;
        no "Come usare questa pagina" guide (guide is optional and ignored; other themes require it)
  section: count                                       counter beside the title in the index or tab bar
  card: tone, labels: [{text, tone}], help, table: {headers, rows}, notes: [],
        events: [{text, tone}], diff: {text, notes: {"file:line": "..."}}
  card: table.variant: "matrix"                         comparison: criteria in rows, options in columns, cells {text, tone, detail}
  card: transcript: {summary, text}                    preformatted text, closed; opens on a tap
  card: summary: "..."                                 in the help bubble under the fixed help (Cosa notare qui)
  card: voice: "..."                                   the text the voice button reads, written for the card
  question.text: {label, placeholder, for: ["value"]}   a text with the answer: {choice, text}
  tone: blu, verde, giallo, rosso, decidi, viola; icon: open, merged, closed, draft, check, x, dot
  Text marks: \`code\`, **bold**, *italic*, ==highlight==. Each sentence renders on its own line; a string with
  several sentences is split (non-breaking space after the point keeps it together).
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
