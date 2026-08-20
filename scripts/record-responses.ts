#!/usr/bin/env tsx
/**
 * Re-record `evals/recorded/` against the live model.
 *
 * This is the ONLY script in the repo that makes API calls, and it is never run
 * by CI or by any test. Re-recording is a deliberate act: the recorded
 * responses are a control point (spec §11) and their diff is what a reviewer
 * looks at when the prompt or the model id changes.
 *
 *   export ANTHROPIC_API_KEY=...      # or: ant auth login
 *   npx tsx scripts/record-responses.ts            # every note
 *   npx tsx scripts/record-responses.ts echo-2026-03-12
 *
 * Afterwards, `npm run eval` and `npm run facts:eval` will score the new
 * responses — expect the declared knownGap entries in evals/expected-facts.yaml
 * to need revisiting, since they describe specific mistakes in the old
 * recording.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { loadNotesDir, NOTES_DIR } from "../src/extract/notes.js";
import { buildRequest, liveCall, parseResponse, EXTRACTION_MODEL, PROMPT_ID } from "../src/extract/pipeline.js";
import { RECORDED_DIR } from "../src/extract/recorded.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const factModelYaml = readFileSync(join(repoRoot, "corpus", "fact-model.yaml"), "utf8");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const notes = Object.values(loadNotesDir(NOTES_DIR)).filter((n) => only.length === 0 || only.includes(n.doc));
if (notes.length === 0) {
  console.error(`no notes matched ${only.join(", ")}`);
  process.exit(1);
}

const client = new Anthropic();
const call = liveCall(client);

for (const note of notes) {
  const request = buildRequest(note, factModelYaml);
  const response = await call(request);
  // Fail loudly rather than commit a response that would not parse.
  parseResponse(response?.parsed_output ?? null);

  const path = join(RECORDED_DIR, `${note.doc}.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        doc: note.doc,
        model: EXTRACTION_MODEL,
        prompt: PROMPT_ID,
        recordedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        parsed_output: response?.parsed_output,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`recorded ${note.doc}`);
}
