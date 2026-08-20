/**
 * The committed recorded-response cache.
 *
 * The repo makes no live API calls: no key exists in CI, and extraction is an
 * offline build step whose output is committed as facts.yaml (spec §14). So one
 * recorded structured-output response per note lives in `evals/recorded/` and
 * is the fixture for both the vitest suites and the promptfoo mock provider —
 * one source of truth, versioned alongside the prompt and the model id.
 *
 * Re-recording is a deliberate, reviewable act: see evals/README.md.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type RecordedResponse = {
  /** Doc id this response was recorded against. */
  doc: string;
  /** Model that produced it. */
  model: string;
  /** Prompt version that produced it. */
  prompt: string;
  /** When it was recorded. */
  recordedAt: string;
  /** The `parsed_output` from client.messages.parse(). */
  parsed_output: unknown;
};

const here = dirname(fileURLToPath(import.meta.url));
/** Resolves to <repo>/evals/recorded from both src/extract/ and dist/extract/. */
export const RECORDED_DIR = join(here, "..", "..", "evals", "recorded");

export function loadRecorded(doc: string, dir: string = RECORDED_DIR): RecordedResponse {
  const path = join(dir, `${doc}.json`);
  if (!existsSync(path)) {
    throw new Error(`no recorded response for '${doc}' at ${path} — re-record it (see evals/README.md)`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as RecordedResponse;
}
