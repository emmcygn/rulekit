/**
 * Adversarial probes — the facts compiler (attack surface 8).
 *
 * The grounding gate's job (spec §11) is that "a fact that can't cite its
 * source doesn't exist". It checks that the quote is in the document. It never
 * checks that the document is about this patient.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFactEntry, groundProposedFacts, type GroundingContext } from "../../src/extract/ground.js";
import { confirmedFactsToPatient, isEvaluable } from "../../src/extract/confirmed.js";
import { parseFactsFile } from "../../src/extract/schema.js";
import { loadNotesDir, toDocuments } from "../../src/extract/notes.js";
import { parseFactModel } from "../../src/core/schema.js";
import { evalPatient } from "../../src/core/evaluator.js";
import type { RuleSet } from "../../src/core/schema.js";

const ROOT = join(import.meta.dirname, "..", "..");
const notes = loadNotesDir(join(ROOT, "corpus", "notes"));
const ctx: GroundingContext = {
  factModel: parseFactModel(readFileSync(join(ROOT, "packs", "trials", "fact-model.yaml"), "utf8")),
  documents: toDocuments(notes),
};

describe("G1 — a quote from a DIFFERENT patient's note passes the grounding gate", () => {
  // echo-2026-03-12 belongs to SYN-042.
  const donor = notes["echo-2026-03-12"]!;

  it("the note's own front matter names its patient — and the gate never sees it", () => {
    expect(donor.patient).toBe("SYN-042");
    // toDocuments() throws the patient away: doc id -> body text, nothing else.
    expect(Object.keys(ctx.documents)).toContain("echo-2026-03-12");
  });

  it("verifyFactEntry accepts SYN-042's LVEF filed under SYN-007", () => {
    const stolen = {
      fact: "lvef",
      value: 32,
      unit: "%",
      status: "confirmed" as const,
      confidence: 0.98,
      extractedBy: "llm/claude-opus-5",
      source: { doc: "echo-2026-03-12", quote: "LVEF 32% by biplane Simpson's method" },
      reviewedBy: "e.cuyugan",
      reviewedAt: "2026-08-20T14:31:00Z",
    };
    // BUG: zero rejections. The fact is now evaluable for whichever patient the
    // file is named after.
    expect(verifyFactEntry(stolen, ctx)).toEqual([]);
    expect(isEvaluable(stolen)).toBe(true);
  });

  it("`facts check` passes a hand-written file that cites another patient's chart", () => {
    const dir = mkdtempSync(join(tmpdir(), "rulekit-probe-"));
    writeFileSync(
      join(dir, "SYN-007.yaml"),
      [
        "patient: SYN-007",
        "asOf: 2026-03-12",
        "facts:",
        "  - fact: lvef",
        "    value: 32",
        '    unit: "%"',
        "    status: confirmed",
        "    confidence: 0.98",
        "    extractedBy: llm/claude-opus-5",
        "    source:",
        "      doc: echo-2026-03-12",
        "      quote: LVEF 32% by biplane Simpson's method",
        "    reviewedBy: e.cuyugan",
        "    reviewedAt: 2026-08-20T14:31:00Z",
        "",
      ].join("\n"),
    );
    const out = execFileSync("npx", ["tsx", join(ROOT, "src", "cli-facts", "index.ts"), "check", dir], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("1 file(s) OK");
  });

  it("...and the borrowed value decides eligibility", () => {
    const rs: RuleSet = {
      ruleset: "lvef-probe",
      rulesetVersion: "1.0.0",
      factModel: "patient-facts/v1",
      criteria: [{ id: "lvef-40-or-below", kind: "inclusion", verbatim: "LVEF <= 40%", when: { fact: "lvef", op: "lte", value: 40, unit: "%" } }],
    };
    const file = parseFactsFile(
      "patient: SYN-007\nfacts:\n  - fact: lvef\n    value: 32\n    unit: \"%\"\n    status: confirmed\n    confidence: 0.98\n    extractedBy: llm/claude-opus-5\n    source:\n      doc: echo-2026-03-12\n      quote: LVEF 32% by biplane Simpson's method\n    reviewedBy: e.cuyugan\n    reviewedAt: 2026-08-20T14:31:00Z\n",
    );
    expect(evalPatient(rs, confirmedFactsToPatient(file)).overall).toBe("eligible");
  });
});

describe("G2 — the gate holds against the attacks it was designed for (attacks failed)", () => {
  const propose = (over: Partial<Parameters<typeof groundProposedFacts>[0][number]>) =>
    groundProposedFacts(
      [{ fact: "lvef", value: "32", unit: "%", confidence: 0.9, quote: "LVEF 32% by biplane Simpson's method", ...over }],
      { doc: "echo-2026-03-12", extractedBy: "llm/claude-opus-5", ctx },
    );

  it("a paraphrased quote is rejected", () => {
    expect(propose({ quote: "LVEF was 32 percent by Simpson's biplane" }).rejected[0]!.reasons).toEqual(["quote-not-found"]);
  });

  it('"percent" is rejected where the model declares "%" — no UCUM leniency', () => {
    expect(propose({ unit: "percent" }).rejected[0]!.reasons).toEqual(["unit-mismatch"]);
  });

  it("a range, a comparator, or a smuggled unit will not coerce", () => {
    for (const v of ["40-45", ">60", "approximately 32", "32 %"]) {
      expect(propose({ value: v }).rejected[0]!.reasons).toContain("type-mismatch");
    }
  });

  it("nothing the model emits is ever auto-confirmed", () => {
    expect(propose({ confidence: 1 }).grounded[0]!.status).toBe("proposed");
  });

  it("the empty quote does not match everything", () => {
    expect(propose({ quote: "" }).rejected[0]!.reasons).toContain("missing-source");
  });
});

describe("G3 — pipeline value vs human-confirmed value for one fact", () => {
  const twoLive = [
    "patient: SYN-999",
    "facts:",
    "  - fact: lvef",
    "    value: 55",
    '    unit: "%"',
    "    status: confirmed",
    "    extractedBy: pipeline",
    "  - fact: lvef",
    "    value: 32",
    '    unit: "%"',
    "    status: confirmed",
    "    extractedBy: human",
    "    reviewedBy: e.cuyugan",
    "    reviewedAt: 2026-08-20T14:31:00Z",
    "",
  ].join("\n");

  it("neither wins — the file will not parse, so a human correction cannot be additive", () => {
    expect(() => parseFactsFile(twoLive)).toThrow(/duplicate live entries/);
  });

  it("the supported route is to tombstone the pipeline row — and a `rejected` pipeline row needs no reviewer", () => {
    const corrected = twoLive.replace("    status: confirmed\n    extractedBy: pipeline", "    status: rejected\n    extractedBy: pipeline");
    const file = parseFactsFile(corrected);
    expect(confirmedFactsToPatient(file).facts["lvef"]).toBe(32);
    // Note the asymmetry: an llm or human fact must carry reviewedBy/reviewedAt
    // to be rejected; a pipeline fact can be silently tombstoned by anyone
    // editing the YAML, with no audit trail. That is the one edit that changes
    // a deterministic value.
    expect(file.facts[0]!.reviewedBy).toBeUndefined();
  });

  it("a human-entered fact left as `proposed` is invisible to the engine and nothing flags it", () => {
    const human = parseFactsFile(
      "patient: SYN-998\nfacts:\n  - fact: lvef\n    value: 32\n    unit: \"%\"\n    status: proposed\n    extractedBy: human\n",
    );
    expect(verifyFactEntry(human.facts[0]!, ctx)).toEqual([]); // `facts check` is silent
    expect(confirmedFactsToPatient(human).facts).toEqual({}); // and the value never reaches the engine
  });
});
