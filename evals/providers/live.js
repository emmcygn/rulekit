/**
 * The live provider — used only by promptfooconfig.live.yaml, never by the
 * default offline config.
 *
 * It calls the production request builder rather than re-describing the request
 * in YAML, so a live run and an offline run exercise the same pinned model, the
 * same prompt file, and the same structured-output schema. The only difference
 * is where the response comes from.
 *
 * This module is the one place in the repo that constructs an Anthropic client,
 * and it does so lazily inside callApi, so merely importing the eval harness
 * never touches credentials.
 */
import { pipeline, factModelYaml } from "../lib.js";

export default class LiveExtractionProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? "anthropic:claude-opus-5";
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const doc = context?.vars?.doc;
    if (!doc) return { error: "live provider needs a `doc` var naming the note" };

    try {
      const { pipe, noteIndex } = await pipeline();
      const note = noteIndex[doc];
      if (!note) return { error: `unknown note '${doc}'` };

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const request = pipe.buildRequest(note, factModelYaml(), { model: this.config.model });
      const response = await pipe.liveCall(client)(request);
      const usage = response?.metrics?.usage;
      const promptTokens = usage
        ? usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
        : undefined;

      return {
        output: JSON.stringify(response?.parsed_output ?? null),
        tokenUsage: usage
          ? {
              prompt: promptTokens,
              completion: usage.output_tokens,
              total: promptTokens + usage.output_tokens,
              cached: usage.cache_read_input_tokens ?? 0,
            }
          : {},
        latencyMs: response?.metrics?.latencyMs,
        metadata: usage ? { usage } : {},
      };
    } catch (err) {
      return { error: `${err.message}` };
    }
  }
}
