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
 *   npx tsx scripts/record-responses.ts                     # batch every note
 *   npx tsx scripts/record-responses.ts echo-2026-03-12      # batch one note
 *   npx tsx scripts/record-responses.ts --resume msgbatch_x  # resume a batch
 *   npm run recordings:migrate                              # bind legacy files, offline
 *
 * Afterwards, `npm run eval` and `npm run facts:eval` will score the new
 * responses — expect the declared knownGap entries in evals/expected-facts.yaml
 * to need revisiting, since they describe specific mistakes in the old
 * recording.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadNotesDir, NOTES_DIR } from "../src/extract/notes.js";
import { buildBatchRequests, buildRequest, runMessageBatch, EXTRACTION_MODEL, PROMPT_ID } from "../src/extract/pipeline.js";
import { loadLegacyRecorded, loadRecorded, makeRecordedResponse, RECORDED_DIR } from "../src/extract/recorded.js";
import { readFactModelYaml } from "../src/extract/fact-model.js";

const factModelYaml = readFactModelYaml();

const args = process.argv.slice(2);
const migrate = args.includes("--migrate");
const resumeAt = args.indexOf("--resume");
const resumeBatchId = resumeAt === -1 ? undefined : args[resumeAt + 1];
if (resumeAt !== -1 && !resumeBatchId) throw new Error("--resume needs a batch id");
const consumed = new Set<number>();
const migrateAt = args.indexOf("--migrate");
if (migrateAt !== -1) consumed.add(migrateAt);
if (resumeAt !== -1) {
  consumed.add(resumeAt);
  consumed.add(resumeAt + 1);
}
const unknownOption = args.find((arg, index) => arg.startsWith("-") && !consumed.has(index));
if (unknownOption) throw new Error(`unknown option '${unknownOption}'`);
if (migrate && resumeBatchId) throw new Error("--migrate and --resume cannot be combined");

const only = args.filter((arg, index) => !arg.startsWith("-") && !consumed.has(index));
const notes = Object.values(loadNotesDir(NOTES_DIR)).filter((n) => only.length === 0 || only.includes(n.doc));
if (notes.length === 0) {
  console.error(`no notes matched ${only.join(", ")}`);
  process.exit(1);
}

const writeRecording = (doc: string, recording: ReturnType<typeof makeRecordedResponse>): void => {
  const path = join(RECORDED_DIR, `${doc}.json`);
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
};

if (migrate) {
  for (const note of notes) {
    const request = buildRequest(note, factModelYaml);
    try {
      loadRecorded(note.doc, RECORDED_DIR, request);
      console.log(`already current ${note.doc}`);
      continue;
    } catch (err) {
      if (!(err as Error).message.includes("legacy recorded response")) throw err;
    }

    const legacy = loadLegacyRecorded(note.doc);
    if (legacy.model !== EXTRACTION_MODEL || legacy.prompt !== PROMPT_ID) {
      throw new Error(
        `cannot migrate '${note.doc}': legacy controls were ${legacy.model}/${legacy.prompt}, current controls are ${EXTRACTION_MODEL}/${PROMPT_ID}`,
      );
    }
    writeRecording(
      note.doc,
      makeRecordedResponse({
        doc: note.doc,
        request,
        parsedOutput: legacy.parsed_output,
        recordedAt: legacy.recordedAt,
        metrics: null,
        mode: "legacy-migration",
      }),
    );
    console.log(`migrated ${note.doc} (capture metrics unavailable; no model call made)`);
  }
} else {
  const client = new Anthropic();
  const requests = buildBatchRequests(notes, factModelYaml);
  const result = await runMessageBatch(client, requests, {
    batchId: resumeBatchId,
    onProgress: ({ batchId, status, counts }) =>
      console.log(
        `batch ${batchId} ${status}: ${counts.succeeded} succeeded, ${counts.errored} errored, ${counts.processing} processing`,
      ),
  });
  const recordedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const note of notes) {
    const response = result.responses.get(note.doc);
    if (!response) throw new Error(`batch '${result.batchId}' returned no reconciled response for '${note.doc}'`);
    writeRecording(
      note.doc,
      makeRecordedResponse({
        doc: note.doc,
        request: buildRequest(note, factModelYaml),
        parsedOutput: response.parsed_output,
        recordedAt,
        metrics: response.metrics ?? null,
        batchId: result.batchId,
      }),
    );
    console.log(`recorded ${note.doc}`);
  }
}
