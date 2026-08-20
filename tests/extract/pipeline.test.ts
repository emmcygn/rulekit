import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFactModel } from "../../src/core/schema.js";
import {
  PROMPT_ID,
  PROMPT_PATH,
  EXTRACTION_MODEL,
  ProposedFactsSchema,
  loadPrompt,
  renderSystemPrompt,
  buildRequest,
  buildBatchRequests,
  parseResponse,
  extractFacts,
  type ExtractionCall,
} from "../../src/extract/pipeline.js";
import { loadNotesDir, toDocuments, NOTES_DIR } from "../../src/extract/notes.js";
import { RECORDED_DIR, loadRecorded } from "../../src/extract/recorded.js";

const FACT_MODEL_YAML = readFileSync(join(NOTES_DIR, "..", "fact-model.yaml"), "utf8");
const FACT_MODEL = parseFactModel(FACT_MODEL_YAML);
const NOTES = loadNotesDir(NOTES_DIR);
const NOTE = NOTES["echo-2026-03-12"]!;

describe("prompt as a versioned file", () => {
  it("loads the prompt from disk, not an inline string", () => {
    expect(PROMPT_PATH).toMatch(/prompts[/\\]extract-facts\.v1\.md$/);
    expect(loadPrompt()).toContain("Quote verbatim");
  });

  it("pins the prompt id alongside the model id", () => {
    expect(PROMPT_ID).toBe("extract-facts.v1");
    expect(EXTRACTION_MODEL).toBe("claude-opus-5");
  });

  it("substitutes the fact model into the system prompt", () => {
    const s = renderSystemPrompt(FACT_MODEL_YAML);
    expect(s).toContain("nyha_class");
    expect(s).not.toContain("{{fact_model}}");
  });

  it("strips the maintainer comment so it is not sent to the model", () => {
    expect(renderSystemPrompt(FACT_MODEL_YAML)).not.toContain("control point");
  });
});

describe("buildRequest", () => {
  const req = buildRequest(NOTE, FACT_MODEL_YAML);

  it("pins the model", () => {
    expect(req.model).toBe("claude-opus-5");
  });

  it("sends the note body as the user message and nothing else", () => {
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]!.role).toBe("user");
    expect(req.messages[0]!.content).toBe(NOTE.body);
  });

  it("keeps the front matter out of the request (only the body is groundable)", () => {
    expect(JSON.stringify(req.messages)).not.toContain("synthetic");
  });

  it("puts the stable instructions in a cacheable system block", () => {
    const sys = req.system as { type: string; text: string; cache_control?: unknown }[];
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(sys[0]!.text).toContain("nyha_class");
  });

  it("requests structured output via zodOutputFormat, not free text", () => {
    const fmt = req.output_config?.format as { type: string; schema: Record<string, unknown> };
    expect(fmt.type).toBe("json_schema");
    const props = (fmt.schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["facts"]);
  });

  it("leaves adaptive thinking on", () => {
    expect(req.thinking).toEqual({ type: "adaptive" });
  });

  it("is deterministic — the same note builds the same request", () => {
    expect(JSON.stringify(buildRequest(NOTE, FACT_MODEL_YAML))).toBe(JSON.stringify(req));
  });
});

describe("buildBatchRequests", () => {
  it("keys every note by its doc id for the Message Batches API", () => {
    const batch = buildBatchRequests(Object.values(NOTES), FACT_MODEL_YAML);
    expect(batch).toHaveLength(10);
    expect(batch.map((b) => b.custom_id).sort()).toEqual(Object.keys(NOTES).sort());
    expect(batch[0]!.params.model).toBe("claude-opus-5");
  });
});

describe("parseResponse", () => {
  it("accepts a well-formed structured output", () => {
    const facts = parseResponse({
      facts: [{ fact: "lvef", value: "32", unit: "%", confidence: 0.97, quote: "LVEF 32%" }],
    });
    expect(facts).toEqual([{ fact: "lvef", value: "32", unit: "%", confidence: 0.97, quote: "LVEF 32%" }]);
  });

  it("maps the empty unit to absent", () => {
    const facts = parseResponse({
      facts: [{ fact: "nyha_class", value: "III", unit: "", confidence: 0.9, quote: "NYHA class III" }],
    });
    expect(facts[0]!.unit).toBeUndefined();
  });

  it("clamps an out-of-range confidence rather than losing the whole call", () => {
    const facts = parseResponse({
      facts: [{ fact: "lvef", value: "32", unit: "%", confidence: 1.4, quote: "LVEF 32%" }],
    });
    expect(facts[0]!.confidence).toBe(1);
  });

  it("accepts an empty extraction", () => {
    expect(parseResponse({ facts: [] })).toEqual([]);
  });

  it("throws when the model returned nothing parseable", () => {
    expect(() => parseResponse(null)).toThrow(/structured output/i);
  });

  it("throws on output that does not match the schema", () => {
    expect(() => parseResponse({ facts: [{ fact: "lvef" }] })).toThrow(/structured output/i);
  });

  it("round-trips the zod schema it declares to the API", () => {
    const ok = ProposedFactsSchema.safeParse({ facts: [] });
    expect(ok.success).toBe(true);
  });
});

describe("extractFacts — network is one injected function", () => {
  const ctx = { factModel: FACT_MODEL, documents: toDocuments(NOTES) };

  it("wires build -> call -> parse -> ground with a recorded response", async () => {
    const call: ExtractionCall = vi.fn(async () => loadRecorded("echo-2026-03-12"));
    const r = await extractFacts({ note: NOTE, factModelYaml: FACT_MODEL_YAML, ctx, call });

    expect(call).toHaveBeenCalledOnce();
    const sent = vi.mocked(call).mock.calls[0]![0];
    expect(sent.model).toBe("claude-opus-5");

    expect(r.grounded.map((f) => f.fact)).toContain("nyha_class");
    expect(r.grounded.every((f) => f.status === "proposed")).toBe(true);
    expect(r.grounded.every((f) => f.extractedBy === "llm/claude-opus-5")).toBe(true);
  });

  it("grounds quotes against the note it was called with, not the model's claim", async () => {
    const call: ExtractionCall = async () => ({
      parsed_output: {
        facts: [{ fact: "nyha_class", value: "IV", unit: "", confidence: 0.99, quote: "NYHA class IV heart failure" }],
      },
    });
    const r = await extractFacts({ note: NOTE, factModelYaml: FACT_MODEL_YAML, ctx, call });
    expect(r.grounded).toEqual([]);
    expect(r.rejected[0]!.reasons).toContain("quote-not-found");
  });

  it("makes no client and no network call of its own", async () => {
    // If the pipeline reached for the network, this call would never resolve —
    // the injected function is the only egress point in the module.
    const r = await extractFacts({
      note: NOTE,
      factModelYaml: FACT_MODEL_YAML,
      ctx,
      call: async () => ({ parsed_output: { facts: [] } }),
    });
    expect(r).toEqual({ grounded: [], rejected: [] });
  });

  it("tags provenance with the model actually used", async () => {
    const r = await extractFacts({
      note: NOTE,
      factModelYaml: FACT_MODEL_YAML,
      ctx,
      model: "claude-sonnet-5",
      call: async () => loadRecorded("echo-2026-03-12"),
    });
    expect(r.grounded[0]!.extractedBy).toBe("llm/claude-sonnet-5");
  });
});

describe("the committed recorded responses", () => {
  it("covers every note in the corpus", () => {
    for (const doc of Object.keys(NOTES)) {
      expect(() => loadRecorded(doc), `${doc} has no recorded response`).not.toThrow();
    }
    expect(RECORDED_DIR).toMatch(/evals[/\\]recorded$/);
  });

  it("parses as valid structured output for every note", () => {
    for (const doc of Object.keys(NOTES)) {
      expect(() => parseResponse(loadRecorded(doc).parsed_output), doc).not.toThrow();
    }
  });
});
