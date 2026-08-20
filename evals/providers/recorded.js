/**
 * The recorded-response provider: how `npx promptfoo eval` runs with no network
 * and no API key.
 *
 * Each note has one committed response in `evals/recorded/`, produced by the
 * pinned model against the pinned prompt. This provider serves them. It is a
 * fixture, not a cache: it never falls back to a live call and never writes.
 * If a note has no recording, the run fails loudly rather than quietly
 * reaching for the network — that failure is the signal that the corpus grew
 * and needs re-recording.
 *
 * Live runs use evals/promptfooconfig.live.yaml. See evals/README.md.
 */
import { pipeline } from "../lib.js";

export default class RecordedResponseProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? "recorded:claude-opus-5";
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const doc = context?.vars?.doc;
    if (!doc) return { error: "recorded provider needs a `doc` var naming the note" };

    try {
      const { recorded } = await pipeline();
      const response = recorded.loadRecorded(doc);
      return {
        output: JSON.stringify(response.parsed_output),
        cached: true,
        // Recorded runs cost nothing; reporting real usage would be a lie.
        tokenUsage: {},
        metadata: { model: response.model, prompt: response.prompt, recordedAt: response.recordedAt },
      };
    } catch (err) {
      return { error: `${err.message}` };
    }
  }
}
