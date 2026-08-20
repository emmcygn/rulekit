/**
 * Extraction call construction for the Anthropic TypeScript SDK (design spec §11).
 *
 * The whole module is a pure request builder plus a pure response parser. The
 * network is exactly one injected function (`ExtractionCall`), which is why the
 * test suite can exercise the entire pipeline against recorded responses and
 * never construct a client. Nothing here reads an API key or opens a socket.
 *
 * Four control points live in git and are versioned together:
 *   - the prompt          prompts/extract-facts.v1.md (a file, never a string)
 *   - the schema          ProposedFactsSchema, below
 *   - the model id        EXTRACTION_MODEL, below
 *   - recorded responses  evals/recorded/
 * A change to any of them that fails the extraction eval fails CI.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Note } from "./notes.js";
import { groundProposedFacts, type GroundingContext, type GroundingResult, type ProposedFact } from "./ground.js";

/** Pinned. A model change is a reviewable diff that the eval gates. */
export const EXTRACTION_MODEL = "claude-opus-5";
export const PROMPT_ID = "extract-facts.v1";

const here = dirname(fileURLToPath(import.meta.url));
// Resolves to <repo>/prompts from both src/extract/ and dist/extract/.
export const PROMPT_PATH = join(here, "..", "..", "prompts", `${PROMPT_ID}.md`);

/**
 * The structured-output contract. `client.messages.parse()` validates the
 * model's response against this, so extraction output is schema-checked JSON
 * and never free text to parse.
 *
 * Every field is required and every value is a string, deliberately: strict
 * JSON-schema output is most reliable when nothing is optional, and typing the
 * value here would move the type check away from the grounding gate, which is
 * where it belongs. `unit` is `""` when the fact model declares no unit.
 */
export const ProposedFactsSchema = z.object({
  facts: z.array(
    z.object({
      fact: z.string().describe("Fact name, exactly as declared in the fact model."),
      value: z.string().describe("The value as a plain string: a decimal for numbers, a declared enum value, or true/false."),
      unit: z.string().describe('Unit spelled exactly as the fact model declares it, or "" if it declares none.'),
      confidence: z.number().describe("0 to 1: how sure you are the note states this exact value."),
      quote: z.string().describe("A character-for-character substring of the note that proves this fact."),
    }),
  ),
});

export type ProposedFactsOutput = z.infer<typeof ProposedFactsSchema>;

/** The request shape handed to `client.messages.parse()`. */
export type ExtractionRequest = Anthropic.MessageCreateParamsNonStreaming;

/** The only egress point. Inject a live one in production, a recorded one in tests. */
export type ExtractionCall = (request: ExtractionRequest) => Promise<{ parsed_output: unknown } | null>;

export const loadPrompt = (path: string = PROMPT_PATH): string => readFileSync(path, "utf8");

/**
 * Render the system prompt: strip the leading maintainer comment (it documents
 * the file for humans and would only be noise to the model), then substitute
 * the fact model.
 */
export function renderSystemPrompt(factModelYaml: string, template: string = loadPrompt()): string {
  return template.replace(/^<!--[\s\S]*?-->\s*/, "").replace("{{fact_model}}", factModelYaml.trim());
}

/**
 * One note, one call.
 *
 * The instructions and the fact model go in a cacheable system block (stable
 * across the whole corpus); the note body is the user message, unwrapped. The
 * front matter never leaves the loader — only the body is groundable, so only
 * the body is sent.
 */
export function buildRequest(note: Note, factModelYaml: string, opts: { model?: string } = {}): ExtractionRequest {
  return {
    model: opts.model ?? EXTRACTION_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: renderSystemPrompt(factModelYaml), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: note.body }],
    output_config: { format: zodOutputFormat(ProposedFactsSchema) },
  };
}

/**
 * Whole-corpus runs go through the Message Batches API (async, 50% cost).
 * Results come back in any order, so every request is keyed by its doc id.
 */
export function buildBatchRequests(
  notes: readonly Note[],
  factModelYaml: string,
  opts: { model?: string } = {},
): { custom_id: string; params: ExtractionRequest }[] {
  return notes.map((note) => ({ custom_id: note.doc, params: buildRequest(note, factModelYaml, opts) }));
}

/**
 * Validate the model's structured output and normalize it into the gate's input
 * shape. Confidence is clamped rather than rejected: it only orders the review
 * queue, so an out-of-range self-estimate is not worth discarding a whole call's
 * evidence over.
 */
export function parseResponse(parsedOutput: unknown): ProposedFact[] {
  if (parsedOutput === null || parsedOutput === undefined) {
    throw new Error("extraction returned no structured output (parsed_output was null)");
  }
  const result = ProposedFactsSchema.safeParse(parsedOutput);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`extraction returned malformed structured output: ${issues}`);
  }
  return result.data.facts.map((f) => {
    const pf: ProposedFact = {
      fact: f.fact,
      value: f.value,
      confidence: Math.min(1, Math.max(0, f.confidence)),
      quote: f.quote,
    };
    if (f.unit.trim().length > 0) pf.unit = f.unit;
    return pf;
  });
}

/**
 * Build -> call -> parse -> ground, for one note.
 *
 * Everything that comes back is either grounded or rejected with reasons; the
 * caller writes the grounded half to the patient's facts.yaml as `proposed`.
 */
export async function extractFacts(opts: {
  note: Note;
  factModelYaml: string;
  ctx: GroundingContext;
  call: ExtractionCall;
  model?: string;
}): Promise<GroundingResult> {
  const model = opts.model ?? EXTRACTION_MODEL;
  const request = buildRequest(opts.note, opts.factModelYaml, { model });
  const response = await opts.call(request);
  const proposed = parseResponse(response?.parsed_output ?? null);
  return groundProposedFacts(proposed, {
    doc: opts.note.doc,
    extractedBy: `llm/${model}`,
    ctx: opts.ctx,
  });
}

/**
 * Adapter for a real run. Takes an already-constructed client so that nothing
 * in this module ever reaches for credentials — importing it is always safe.
 *
 * Untested by design: the repo makes no live API calls (spec §14 — extraction
 * is an offline build step and the deployed workbench calls nothing). A
 * maintainer with a key wires this up; see evals/README.md.
 */
export const liveCall =
  (client: Anthropic): ExtractionCall =>
  async (request) => {
    const message = await client.messages.parse(request);
    return { parsed_output: message.parsed_output };
  };
