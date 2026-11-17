#!/usr/bin/env node
// Bruvish entry point: upstream `lavish-axi` plus the Bruvish runtime (bruvish/lib/cli.mjs).
// scripts/bruvish-build.js bundles it into dist/bruvish.mjs; the installed `lavish-axi` runs that.
import { normalizeArgv, run } from "../../src/cli.js";
import { runBruvish } from "../lib/cli.mjs";

await runBruvish(process.argv.slice(2), { run, normalizeArgv });
