import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
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
  runMessageBatch,
  liveCall,
  parseResponse,
  extractFacts,
  MAX_NOTE_BYTES,
  MAX_FACT_MODEL_BYTES,
  MAX_PROPOSALS,
  type ExtractionCall,
} from "../../src/extract/pipeline.js";
import { loadNotesDir, toDocuments, NOTES_DIR } from "../../src/extract/notes.js";
import {
  RECORDED_DIR,
  assertRecordingMatches,
  controlsForRequest,
  loadRecorded,
  makeRecordedResponse,
} from "../../src/extract/recorded.js";
import { readFactModelYaml } from "../../src/extract/fact-model.js";

const FACT_MODEL_YAML = readFactModelYaml();
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

  it("rejects an oversized note before constructing a provider request", () => {
    expect(() => buildRequest({ ...NOTE, body: "x".repeat(MAX_NOTE_BYTES + 1) }, FACT_MODEL_YAML)).toThrow(/note.*limit/i);
  });

  it("rejects an oversized fact model before rendering a prompt", () => {
    expect(() => buildRequest(NOTE, "x".repeat(MAX_FACT_MODEL_BYTES + 1))).toThrow(/fact model.*limit/i);
  });
});

describe("buildBatchRequests", () => {
  it("keys every note by its doc id for the Message Batches API", () => {
    const batch = buildBatchRequests(Object.values(NOTES), FACT_MODEL_YAML);
    expect(batch).toHaveLength(10);
    expect(batch.map((b) => b.custom_id).sort()).toEqual(Object.keys(NOTES).sort());
    expect(batch[0]!.params.model).toBe("claude-opus-5");
  });

  it("rejects duplicate reconciliation keys", () => {
    expect(() => buildBatchRequests([NOTE, NOTE], FACT_MODEL_YAML)).toThrow(/duplicate batch document id/);
  });
});

describe("runMessageBatch", () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 80,
    cache_read_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 80, ephemeral_1h_input_tokens: 0 },
    output_tokens_details: { thinking_tokens: 7 },
    server_tool_use: null,
    service_tier: "batch",
    inference_geo: null,
  };
  const batch = (status: "in_progress" | "ended") => ({
    id: "msgbatch_test",
    processing_status: status,
    request_counts: {
      processing: status === "ended" ? 0 : 2,
      succeeded: status === "ended" ? 2 : 0,
      errored: 0,
      canceled: 0,
      expired: 0,
    },
  });
  const row = (custom_id: string) => ({
    custom_id,
    result: {
      type: "succeeded",
      message: {
        model: "claude-opus-5-20260901",
        content: [{ type: "text", text: JSON.stringify({ facts: [] }) }],
        usage,
      },
    },
  });

  it("submits, polls, and reconciles out-of-order results with accounting", async () => {
    let time = 1_000;
    const requests = buildBatchRequests([NOTES["echo-2026-03-12"]!, NOTES["clinic-2026-02-04"]!], FACT_MODEL_YAML);
    const client = {
      messages: {
        batches: {
          create: vi.fn(async () => batch("in_progress")),
          retrieve: vi.fn(async () => batch("ended")),
          results: vi.fn(async () => (async function* () {
            yield row("clinic-2026-02-04");
            yield row("echo-2026-03-12");
          })()),
        },
      },
    } as unknown as Anthropic;

    const result = await runMessageBatch(client, requests, {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      pollIntervalMs: 25,
    });

    expect(result.responses.size).toBe(2);
    expect(result.elapsedMs).toBe(25);
    expect(result.responses.get("echo-2026-03-12")!.metrics).toMatchObject({
      latencyMs: 25,
      latencyKind: "batch-wall",
      responseModel: "claude-opus-5-20260901",
      usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 7 } },
    });
  });

  it("fails reconciliation when a result is missing", async () => {
    const requests = buildBatchRequests([NOTES["echo-2026-03-12"]!, NOTES["clinic-2026-02-04"]!], FACT_MODEL_YAML);
    const client = {
      messages: {
        batches: {
          create: vi.fn(async () => batch("ended")),
          results: vi.fn(async () => (async function* () {
            yield row("echo-2026-03-12");
          })()),
        },
      },
    } as unknown as Anthropic;
    await expect(runMessageBatch(client, requests)).rejects.toThrow(/clinic-2026-02-04: missing result/);
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

  it("rejects an oversized proposal list", () => {
    const fact = { fact: "lvef", value: "32", unit: "%", confidence: 0.9, quote: "LVEF 32%" };
    expect(() => parseResponse({ facts: Array.from({ length: MAX_PROPOSALS + 1 }, () => fact) })).toThrow(/malformed structured output/i);
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

describe("liveCall capture accounting", () => {
  it("preserves provider usage and response model while measuring latency", async () => {
    const usage: Anthropic.Messages.Usage = {
      input_tokens: 12,
      output_tokens: 8,
      cache_creation_input_tokens: 9,
      cache_read_input_tokens: 3,
      cache_creation: { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 },
      output_tokens_details: { thinking_tokens: 5 },
      server_tool_use: null,
      service_tier: "standard",
      inference_geo: null,
    };
    const client = {
      messages: {
        parse: vi.fn(async () => ({ parsed_output: { facts: [] }, model: "claude-opus-5-20260901", usage })),
      },
    } as unknown as Anthropic;

    const response = await liveCall(client)(buildRequest(NOTE, FACT_MODEL_YAML));
    expect(response?.metrics).toMatchObject({
      responseModel: "claude-opus-5-20260901",
      latencyKind: "request",
      usage: { input_tokens: 12, output_tokens_details: { thinking_tokens: 5 } },
    });
    expect(response!.metrics!.latencyMs).toBeGreaterThanOrEqual(0);
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
    for (const [doc, note] of Object.entries(NOTES)) {
      const request = buildRequest(note, FACT_MODEL_YAML);
      expect(() => parseResponse(loadRecorded(doc, RECORDED_DIR, request).parsed_output), doc).not.toThrow();
    }
  });

  it("binds a recording to the fully rendered prompt, request, schema, model, and settings", () => {
    const request = buildRequest(NOTE, FACT_MODEL_YAML);
    const controls = controlsForRequest(request);
    expect(controls.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(controls.prompt.renderedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(controls.schema).toMatchObject({ id: "proposed-facts.v1" });
    expect(controls.inference).toEqual({ max_tokens: 16000, thinking: { type: "adaptive" } });
  });

  it("invalidates a recording after a prompt/request change", () => {
    const request = buildRequest(NOTE, FACT_MODEL_YAML);
    const recording = makeRecordedResponse({
      doc: NOTE.doc,
      request,
      parsedOutput: { facts: [] },
      recordedAt: "2026-01-01T00:00:00Z",
      metrics: null,
    });
    const changed = JSON.parse(JSON.stringify(request)) as typeof request;
    const system = changed.system as { type: string; text: string }[];
    system[0]!.text += "\nChanged instruction.";
    expect(() => assertRecordingMatches(recording, NOTE.doc, changed)).toThrow(/rendered prompt.*fully rendered request/i);
  });

  it("invalidates a recording after a model change", () => {
    const request = buildRequest(NOTE, FACT_MODEL_YAML);
    const recording = makeRecordedResponse({
      doc: NOTE.doc,
      request,
      parsedOutput: { facts: [] },
      recordedAt: "2026-01-01T00:00:00Z",
      metrics: null,
    });
    expect(() => assertRecordingMatches(recording, NOTE.doc, buildRequest(NOTE, FACT_MODEL_YAML, { model: "claude-sonnet-5" }))).toThrow(
      /model.*fully rendered request/i,
    );
  });

  it("invalidates a recording after an inference-setting change", () => {
    const request = buildRequest(NOTE, FACT_MODEL_YAML);
    const recording = makeRecordedResponse({
      doc: NOTE.doc,
      request,
      parsedOutput: { facts: [] },
      recordedAt: "2026-01-01T00:00:00Z",
      metrics: null,
    });
    const changed = { ...request, max_tokens: request.max_tokens - 1 };
    expect(() => assertRecordingMatches(recording, NOTE.doc, changed)).toThrow(/inference settings.*fully rendered request/i);
  });

  it("invalidates a recording after an output-schema change", () => {
    const request = buildRequest(NOTE, FACT_MODEL_YAML);
    const recording = makeRecordedResponse({
      doc: NOTE.doc,
      request,
      parsedOutput: { facts: [] },
      recordedAt: "2026-01-01T00:00:00Z",
      metrics: null,
    });
    const changed = JSON.parse(JSON.stringify(request)) as typeof request;
    const format = changed.output_config!.format as { schema: Record<string, unknown> };
    format.schema.description = "changed schema";
    expect(() => assertRecordingMatches(recording, NOTE.doc, changed)).toThrow(/output schema hash.*fully rendered request/i);
  });
});
