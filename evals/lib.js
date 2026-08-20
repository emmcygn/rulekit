/**
 * Shared plumbing for the promptfoo harness.
 *
 * promptfoo runs plain JS, so everything here imports the *built* pipeline from
 * `dist/`. Run `npm run build` before `promptfoo eval` (the `npm run eval`
 * script does both). Importing the built output rather than re-implementing
 * anything is the point: the eval must exercise the same grounding gate the
 * CLI and the workbench use, or it is measuring a different program.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const factModelYaml = () => readFileSync(join(REPO_ROOT, "corpus", "fact-model.yaml"), "utf8");
export const expectedFactsYaml = () => readFileSync(join(REPO_ROOT, "evals", "expected-facts.yaml"), "utf8");

let cached = null;

/** Lazily load the built pipeline so a missing `dist/` produces a useful error. */
export async function pipeline() {
  if (cached) return cached;
  let mods;
  try {
    mods = await Promise.all([
      import("../dist/core/schema.js"),
      import("../dist/extract/notes.js"),
      import("../dist/extract/ground.js"),
      import("../dist/extract/pipeline.js"),
      import("../dist/extract/recorded.js"),
      import("../dist/extract/eval.js"),
    ]);
  } catch (err) {
    throw new Error(`evals need the built pipeline in dist/ — run \`npm run build\` first (${err.message})`);
  }
  const [core, notes, ground, pipe, recorded, evalMod] = mods;
  const noteIndex = notes.loadNotesDir(notes.NOTES_DIR);
  cached = {
    core,
    notes,
    ground,
    pipe,
    recorded,
    evalMod,
    noteIndex,
    ctx: {
      factModel: core.parseFactModel(factModelYaml()),
      documents: notes.toDocuments(noteIndex),
    },
  };
  return cached;
}
