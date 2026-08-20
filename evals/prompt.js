/**
 * The prompt, for promptfoo.
 *
 * It renders the same versioned file the pipeline uses
 * (prompts/extract-facts.v1.md) through the same renderer, so the eval cannot
 * silently drift from production. The prompt is never inlined into the
 * promptfoo config for exactly that reason.
 */
import { pipeline, factModelYaml } from "./lib.js";

export default async function extractionPrompt({ vars }) {
  const { pipe, noteIndex } = await pipeline();
  const note = noteIndex[vars.doc];
  if (!note) throw new Error(`unknown note '${vars.doc}'`);
  return JSON.stringify([
    { role: "system", content: pipe.renderSystemPrompt(factModelYaml()) },
    { role: "user", content: note.body },
  ]);
}
