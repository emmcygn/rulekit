#!/usr/bin/env tsx
/**
 * Regenerate `corpus/facts/` from the recorded extraction run.
 *
 * Extraction is an offline build step (design spec §14): its results are
 * committed as facts.yaml, and the deployed workbench makes no API calls. This
 * script is the build step, wired to the recorded responses rather than the
 * network — running it makes no request and needs no key.
 *
 *   npx tsx scripts/extract-corpus.ts
 *
 * It writes only `proposed` entries. Review decisions (`confirmed`/`rejected`,
 * with reviewedBy and reviewedAt) are made by a human in the review pane and
 * are preserved by hand — re-running this would drop them, so it refuses to
 * overwrite a file that already carries a decision unless --force is passed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { loadFactModel } from "../src/extract/fact-model.js";
import { parseFactsFile } from "../src/extract/schema.js";
import { loadNotesDir, toDocuments, NOTES_DIR } from "../src/extract/notes.js";
import { loadRecorded } from "../src/extract/recorded.js";
import { parseResponse } from "../src/extract/pipeline.js";
import { groundProposedFacts } from "../src/extract/ground.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "corpus", "facts");
const force = process.argv.includes("--force");

const factModel = loadFactModel();
const notes = loadNotesDir(NOTES_DIR);
const ctx = { factModel, documents: toDocuments(notes) };

mkdirSync(outDir, { recursive: true });

for (const note of Object.values(notes)) {
  const recorded = loadRecorded(note.doc);
  const { grounded, rejected } = groundProposedFacts(parseResponse(recorded.parsed_output), {
    doc: note.doc,
    extractedBy: `llm/${recorded.model}`,
    ctx,
  });

  const path = join(outDir, `${note.patient}.yaml`);
  if (existsSync(path) && !force) {
    const existing = parseFactsFile(readFileSync(path, "utf8"));
    if (existing.facts.some((f) => f.status !== "proposed")) {
      console.log(`skip  ${note.patient} — carries review decisions (use --force to discard them)`);
      continue;
    }
  }

  const header = [
    `# Generated from ${note.doc} by scripts/extract-corpus.ts.`,
    `# Model ${recorded.model}, prompt ${recorded.prompt}, recorded ${recorded.recordedAt}.`,
    `# Every entry is 'proposed' — nothing here reaches the engine until a human confirms it.`,
    "",
  ].join("\n");

  writeFileSync(path, header + stringify({ patient: note.patient, asOf: note.date, facts: grounded }), "utf8");
  console.log(`write ${note.patient}  ${grounded.length} proposed, ${rejected.length} rejected at the gate`);
  for (const r of rejected) console.log(`        rejected ${r.fact}: ${r.reasons.join(", ")}`);
}
