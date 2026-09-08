/**
 * Adversarial probes — the facts compiler (attack surface 8).
 *
 * The grounding gate's job (spec §11) is that "a fact that can't cite its
 * source doesn't exist". G1 is the regression for the wrong-chart hole: the
 * gate used to check that the quote was in the document and never that the
 * document was about this patient.
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
import { evalPatientUnsafe as evalPatient } from "../../src/core/evaluator.js";
import type { RuleSet } from "../../src/core/schema.js";

const ROOT = join(import.meta.dirname, "..", "..");
const notes = loadNotesDir(join(ROOT, "corpus", "notes"));
const ctx: GroundingContext = {
  factModel: parseFactModel(readFileSync(join(ROOT, "packs", "trials", "fact-model.yaml"), "utf8")),
  documents: toDocuments(notes),
};

describe("G1 — a quote from a DIFFERENT patient's note is rejected (REGRESSION: used to pass)", () => {
  // echo-2026-03-12 belongs to SYN-042.
  const donor = notes["echo-2026-03-12"]!;

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

  it("the note's front matter names its patient, and the gate now sees it", () => {
    expect(donor.patient).toBe("SYN-042");
    expect(ctx.documents["echo-2026-03-12"]!.patient).toBe("SYN-042");
  });

  it("verifyFactEntry rejects SYN-042's LVEF filed under SYN-007", () => {
    const rejections = verifyFactEntry(stolen, ctx, "SYN-007");
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.reasons).toEqual(["wrong-patient"]);
    expect(rejections[0]!.detail).toContain("is SYN-042's chart, not SYN-007's");
  });

  it("the same entry filed under its own patient is fine", () => {
    expect(verifyFactEntry(stolen, ctx, "SYN-042")).toEqual([]);
    expect(isEvaluable(stolen)).toBe(true);
  });

  it("groundProposedFacts rejects a wrong-chart quote at extraction time", () => {
    const { grounded, rejected } = groundProposedFacts(
      [{ fact: "lvef", value: "32", unit: "%", confidence: 0.9, quote: "LVEF 32% by biplane Simpson's method" }],
      { doc: "echo-2026-03-12", extractedBy: "llm/claude-opus-5", ctx, patient: "SYN-007" },
    );
    expect(grounded).toEqual([]);
    expect(rejected[0]!.reasons).toEqual(["wrong-patient"]);
  });

  it("`facts check` FAILS a hand-written file that cites another patient's chart", () => {
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
    let status = 0;
    let out: string;
    try {
      out = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "src", "cli-facts", "index.ts"), "check", dir], {
        cwd: ROOT,
        encoding: "utf8",
      });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      status = err.status;
      out = String(err.stdout);
    }
    expect(status).toBe(1);
    expect(out).toContain("1 problem(s) in 1 file(s)");
    expect(out).toContain("is SYN-042's chart, not SYN-007's");
  });

  it("a patient-less document is exempt — a reference sheet is citable by anyone", () => {
    const shared: GroundingContext = {
      factModel: ctx.factModel,
      documents: { "lab-reference": { text: "Normal LVEF 32% by biplane Simpson's method" } },
    };
    const entry = { ...stolen, source: { doc: "lab-reference", quote: "LVEF 32% by biplane Simpson's method" } };
    expect(verifyFactEntry(entry, shared, "SYN-007")).toEqual([]);
  });

  it("the borrowed value no longer reaches the engine through `facts check`", () => {
    // The value still parses and evaluates — the gate is what stops it, which is
    // exactly why the gate has to run.
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
    expect(verifyFactEntry(file.facts[0]!, ctx, file.patient)[0]!.reasons).toEqual(["wrong-patient"]);
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
