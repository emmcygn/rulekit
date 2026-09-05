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
import { pipeline, factModelYaml } from "../lib.js";

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
      const { recorded, pipe, noteIndex } = await pipeline();
      const note = noteIndex[doc];
      if (!note) return { error: `unknown note '${doc}'` };
      const modelYaml = factModelYaml();
      const request = pipe.buildRequest(note, modelYaml);
      const response = recorded.loadRecorded(doc, this.config.recordedDir, request);
      const metrics = response.capture.metrics;
      const usage = metrics?.usage;
      const promptTokens = usage
        ? usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
        : undefined;
      return {
        output: JSON.stringify(response.parsed_output),
        cached: true,
        // The eval itself costs nothing, but preserved capture usage is useful
        // for comparing model quality with the original run's resource cost.
        tokenUsage: usage
          ? {
              prompt: promptTokens,
              completion: usage.output_tokens,
              total: promptTokens + usage.output_tokens,
              cached: usage.cache_read_input_tokens ?? 0,
            }
          : {},
        latencyMs: metrics?.latencyMs,
        metadata: {
          model: response.model,
          prompt: response.prompt,
          schema: response.schema,
          requestSha256: response.requestSha256,
          recordedAt: response.recordedAt,
          capture: response.capture,
        },
      };
    } catch (err) {
      return { error: `${err.message}` };
    }
  }
}
