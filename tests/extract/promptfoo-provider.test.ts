import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../evals/lib.js", async () => {
  const pipe = await import("../../src/extract/pipeline.js");
  const recorded = await import("../../src/extract/recorded.js");
  const notes = await import("../../src/extract/notes.js");
  const factModel = await import("../../src/extract/fact-model.js");
  const modelYaml = factModel.readFactModelYaml();
  return {
    factModelYaml: () => modelYaml,
    pipeline: async () => ({ pipe, recorded, noteIndex: notes.loadNotesDir(notes.NOTES_DIR) }),
  };
});

// This provider is intentionally plain JS because promptfoo loads it directly.
// @ts-expect-error no declaration file is shipped for the promptfoo adapter
import RecordedResponseProvider from "../../evals/providers/recorded.js";
import { readFactModelYaml } from "../../src/extract/fact-model.js";
import { loadNotesDir, NOTES_DIR } from "../../src/extract/notes.js";
import { renderSystemPrompt } from "../../src/extract/pipeline.js";
import { RECORDED_DIR } from "../../src/extract/recorded.js";

const scratches: string[] = [];

afterEach(() => {
  for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true });
});

const promptFor = (doc: string): string => {
  const note = loadNotesDir(NOTES_DIR)[doc]!;
  return JSON.stringify([
    { role: "system", content: renderSystemPrompt(readFactModelYaml()) },
    { role: "user", content: note.body },
  ]);
};

describe("promptfoo recorded provider integrity", () => {
  it("serves a recording only when the prompt and recording controls are current", async () => {
    const provider = new RecordedResponseProvider();
    const result = await provider.callApi(promptFor("echo-2026-03-12"), { vars: { doc: "echo-2026-03-12" } });
    expect(result.error).toBeUndefined();
    expect(result.metadata.requestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails when the stored rendered-prompt binding is stale", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "rulekit-promptfoo-recordings-"));
    scratches.push(scratch);
    cpSync(RECORDED_DIR, scratch, { recursive: true });
    const path = join(scratch, "echo-2026-03-12.json");
    const recording = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    recording.promptSha256 = "0".repeat(64);
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);

    const provider = new RecordedResponseProvider({ config: { recordedDir: scratch } });
    const result = await provider.callApi(promptFor("echo-2026-03-12"), { vars: { doc: "echo-2026-03-12" } });
    expect(result.error).toMatch(/stale or mismatched recording.*rendered prompt/);
  });

  it("fails when the stored model binding is stale", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "rulekit-promptfoo-recordings-"));
    scratches.push(scratch);
    cpSync(RECORDED_DIR, scratch, { recursive: true });
    const path = join(scratch, "echo-2026-03-12.json");
    const recording = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    recording.model = "different-model";
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);

    const provider = new RecordedResponseProvider({ config: { recordedDir: scratch } });
    const result = await provider.callApi(promptFor("echo-2026-03-12"), { vars: { doc: "echo-2026-03-12" } });
    expect(result.error).toMatch(/stale or mismatched recording.*model/);
  });
});
