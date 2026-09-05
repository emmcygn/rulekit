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
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractionRequest, CaptureMetrics } from "./pipeline.js";
import { OUTPUT_SCHEMA_ID, PROMPT_ID } from "./pipeline.js";

export const RECORDING_VERSION = 2;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RecordingControls = {
  requestSha256: string;
  model: string;
  prompt: { id: string; renderedSha256: string };
  schema: { id: string; sha256: string };
  /** Every request field except the model, prompt/messages, and output schema. */
  inference: JsonValue;
};

export type RecordedResponse = {
  recordingVersion: typeof RECORDING_VERSION;
  /** Doc id this response was recorded against. */
  doc: string;
  /** Model that produced it. */
  model: string;
  /** Human-readable prompt version (kept string-compatible with corpus tooling). */
  prompt: string;
  /** Cryptographic binding to the fully rendered system prompt. */
  promptSha256: string;
  /** Cryptographic binding to the structured-output contract and its version. */
  schema: RecordingControls["schema"];
  /** Hash of the complete rendered request, plus inspectable inference settings. */
  requestSha256: string;
  inference: JsonValue;
  /** When it was recorded. */
  recordedAt: string;
  capture: {
    mode: "live" | "legacy-migration";
    metrics: CaptureMetrics | null;
    batchId?: string;
  };
  /** The `parsed_output` from client.messages.parse(). */
  parsed_output: unknown;
};

export type LegacyRecordedResponse = {
  doc: string;
  model: string;
  prompt: string;
  recordedAt: string;
  parsed_output: unknown;
};

const here = dirname(fileURLToPath(import.meta.url));
/** Resolves to <repo>/evals/recorded from both src/extract/ and dist/extract/. */
export const RECORDED_DIR = join(here, "..", "..", "evals", "recorded");

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot fingerprint a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry) ?? null);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const normalized = jsonValue(entry);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  // SDK output-format helpers carry parser functions. They are transport-local
  // and are not sent to the provider, so they are intentionally omitted.
  return undefined;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(jsonValue(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Derive every control value from the exact request handed to the provider. */
export function controlsForRequest(request: ExtractionRequest): RecordingControls {
  const { model, system, output_config } = request;
  const inference = Object.fromEntries(
    Object.entries(request).filter(([key]) => !["model", "system", "messages", "output_config"].includes(key)),
  );
  const format = output_config?.format;
  const schema = format && typeof format === "object" && "schema" in format ? format.schema : format;
  return {
    requestSha256: sha256(canonicalJson(request)),
    model: String(model),
    prompt: { id: PROMPT_ID, renderedSha256: sha256(canonicalJson(system)) },
    schema: { id: OUTPUT_SCHEMA_ID, sha256: sha256(canonicalJson(schema)) },
    inference: jsonValue(inference) ?? null,
  };
}

export function makeRecordedResponse(opts: {
  doc: string;
  request: ExtractionRequest;
  parsedOutput: unknown;
  recordedAt: string;
  metrics: CaptureMetrics | null;
  mode?: "live" | "legacy-migration";
  batchId?: string;
}): RecordedResponse {
  const controls = controlsForRequest(opts.request);
  return {
    recordingVersion: RECORDING_VERSION,
    doc: opts.doc,
    model: controls.model,
    prompt: controls.prompt.id,
    promptSha256: controls.prompt.renderedSha256,
    schema: controls.schema,
    requestSha256: controls.requestSha256,
    inference: controls.inference,
    recordedAt: opts.recordedAt,
    capture: {
      mode: opts.mode ?? "live",
      metrics: opts.metrics,
      ...(opts.batchId === undefined ? {} : { batchId: opts.batchId }),
    },
    parsed_output: opts.parsedOutput,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRecordedShape(raw: unknown, path: string): RecordedResponse {
  if (!isObject(raw)) throw new Error(`invalid recorded response at ${path}: expected an object`);
  if (raw.recordingVersion === undefined) {
    throw new Error(`legacy recorded response at ${path} is unbound — run 'npm run recordings:migrate' after reviewing the current controls`);
  }
  if (raw.recordingVersion !== RECORDING_VERSION) {
    throw new Error(`unsupported recordingVersion ${String(raw.recordingVersion)} at ${path}; expected ${RECORDING_VERSION}`);
  }
  const requiredObjects = ["schema", "capture"] as const;
  for (const key of requiredObjects) if (!isObject(raw[key])) throw new Error(`invalid recorded response at ${path}: ${key} must be an object`);
  for (const key of ["doc", "model", "prompt", "promptSha256", "requestSha256", "recordedAt"] as const) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) throw new Error(`invalid recorded response at ${path}: ${key} must be a non-empty string`);
  }
  const schema = raw.schema as Record<string, unknown>;
  if (typeof schema.id !== "string" || typeof schema.sha256 !== "string") {
    throw new Error(`invalid recorded response at ${path}: schema binding is incomplete`);
  }
  const hashKeys = [raw.promptSha256, raw.requestSha256, schema.sha256];
  if (hashKeys.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error(`invalid recorded response at ${path}: SHA-256 bindings must be 64 lowercase hexadecimal characters`);
  }
  const capture = raw.capture as Record<string, unknown>;
  if (capture.mode !== "live" && capture.mode !== "legacy-migration") {
    throw new Error(`invalid recorded response at ${path}: unsupported capture mode`);
  }
  if (capture.metrics !== null) {
    if (!isObject(capture.metrics)) throw new Error(`invalid recorded response at ${path}: capture.metrics must be an object or null`);
    const metrics = capture.metrics;
    if (typeof metrics.responseModel !== "string" || metrics.responseModel.length === 0) {
      throw new Error(`invalid recorded response at ${path}: capture responseModel is required`);
    }
    if (typeof metrics.latencyMs !== "number" || !Number.isFinite(metrics.latencyMs) || metrics.latencyMs < 0) {
      throw new Error(`invalid recorded response at ${path}: capture latency must be a non-negative finite number`);
    }
    if (metrics.latencyKind !== "request" && metrics.latencyKind !== "batch-wall") {
      throw new Error(`invalid recorded response at ${path}: unsupported latency kind`);
    }
    if (!isObject(metrics.usage)) throw new Error(`invalid recorded response at ${path}: capture usage is required`);
    for (const key of ["input_tokens", "output_tokens"] as const) {
      if (typeof metrics.usage[key] !== "number" || !Number.isFinite(metrics.usage[key]) || metrics.usage[key] < 0) {
        throw new Error(`invalid recorded response at ${path}: usage.${key} must be a non-negative finite number`);
      }
    }
    for (const key of ["cache_creation_input_tokens", "cache_read_input_tokens"] as const) {
      const value = metrics.usage[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`invalid recorded response at ${path}: usage.${key} must be null or a non-negative finite number`);
      }
    }
    if (!("cache_creation" in metrics.usage) || !("output_tokens_details" in metrics.usage) || !("server_tool_use" in metrics.usage)) {
      throw new Error(`invalid recorded response at ${path}: provider usage breakdown is incomplete`);
    }
  }
  return raw as RecordedResponse;
}

export function assertRecordingMatches(recording: RecordedResponse, doc: string, request: ExtractionRequest): void {
  const actual: RecordingControls = {
    requestSha256: recording.requestSha256,
    model: recording.model,
    prompt: { id: recording.prompt, renderedSha256: recording.promptSha256 },
    schema: recording.schema,
    inference: recording.inference,
  };
  const expected = controlsForRequest(request);
  const mismatches: string[] = [];
  if (recording.doc !== doc) mismatches.push(`doc ${JSON.stringify(recording.doc)} != ${JSON.stringify(doc)}`);
  if (actual.model !== expected.model) mismatches.push(`model ${JSON.stringify(actual.model)} != ${JSON.stringify(expected.model)}`);
  if (actual.prompt.id !== expected.prompt.id) mismatches.push(`prompt id ${JSON.stringify(actual.prompt.id)} != ${JSON.stringify(expected.prompt.id)}`);
  if (actual.prompt.renderedSha256 !== expected.prompt.renderedSha256) mismatches.push("rendered prompt hash changed");
  if (actual.schema.id !== expected.schema.id) mismatches.push(`schema id ${JSON.stringify(actual.schema.id)} != ${JSON.stringify(expected.schema.id)}`);
  if (actual.schema.sha256 !== expected.schema.sha256) mismatches.push("output schema hash changed");
  if (canonicalJson(actual.inference) !== canonicalJson(expected.inference)) mismatches.push("inference settings changed");
  if (actual.requestSha256 !== expected.requestSha256) mismatches.push("fully rendered request hash changed");
  if (mismatches.length > 0) {
    throw new Error(`stale or mismatched recording for '${doc}': ${mismatches.join("; ")} — re-record this response`);
  }
}

export function loadRecorded(doc: string, dir: string = RECORDED_DIR, request?: ExtractionRequest): RecordedResponse {
  const path = join(dir, `${doc}.json`);
  if (!existsSync(path)) {
    throw new Error(`no recorded response for '${doc}' at ${path} — re-record it (see evals/README.md)`);
  }
  const recording = validateRecordedShape(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
  if (request) assertRecordingMatches(recording, doc, request);
  return recording;
}

/** Read the old five-field envelope solely for the explicit migration command. */
export function loadLegacyRecorded(doc: string, dir: string = RECORDED_DIR): LegacyRecordedResponse {
  const path = join(dir, `${doc}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error(`invalid legacy recording at ${path}`);
  for (const key of ["doc", "model", "prompt", "recordedAt"] as const) {
    if (typeof raw[key] !== "string") throw new Error(`invalid legacy recording at ${path}: ${key} must be a string`);
  }
  if (raw.doc !== doc) throw new Error(`legacy recording at ${path} declares doc '${String(raw.doc)}'`);
  return raw as LegacyRecordedResponse;
}
