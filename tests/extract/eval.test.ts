import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFactModel } from "../../src/core/schema.js";
import { scoreExtraction, parseExpectedFacts, formatEvalReport, type ScoredCase } from "../../src/extract/eval.js";
import { groundProposedFacts, type GroundingContext, type GroundingResult } from "../../src/extract/ground.js";
import { loadNotesDir, toDocuments, NOTES_DIR } from "../../src/extract/notes.js";
import { loadRecorded, RECORDED_DIR } from "../../src/extract/recorded.js";
import { parseResponse } from "../../src/extract/pipeline.js";

const CORPUS = join(NOTES_DIR, "..");
const FACT_MODEL = parseFactModel(readFileSync(join(CORPUS, "fact-model.yaml"), "utf8"));
const NOTES = loadNotesDir(NOTES_DIR);
const CTX: GroundingContext = { factModel: FACT_MODEL, documents: toDocuments(NOTES) };
const EXPECTED = parseExpectedFacts(readFileSync(join(RECORDED_DIR, "..", "expected-facts.yaml"), "utf8"));

const empty: GroundingResult = { grounded: [], rejected: [] };

describe("parseExpectedFacts", () => {
  it("covers every note in the corpus, once", () => {
    expect(EXPECTED.cases.map((c) => c.doc).sort()).toEqual(Object.keys(NOTES).sort());
  });

  it("rejects an unknown key", () => {
    expect(() => parseExpectedFacts("cases:\n  - doc: x\n    expcted: []\n")).toThrow(/invalid expected-facts/);
  });
});

describe("scoreExtraction — synthetic cases", () => {
  const ground = (facts: { fact: string; value: string; unit?: string; confidence: number; quote: string }[], doc = "echo-2026-03-12") =>
    groundProposedFacts(facts, { doc, extractedBy: "llm/claude-opus-5", ctx: CTX });

  it("scores a perfect single-fact extraction", () => {
    const cases: ScoredCase[] = [
      {
        doc: "echo-2026-03-12",
        expected: [{ fact: "nyha_class", value: "III" }],
        result: ground([{ fact: "nyha_class", value: "III", confidence: 0.9, quote: "symptoms consistent with NYHA class III heart failure" }]),
      },
    ];
    const r = scoreExtraction(cases);
    expect(r.counts).toEqual({ tp: 1, fp: 0, fn: 0, expected: 1 });
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it("counts a grounded but unstated fact as a false positive", () => {
    const r = scoreExtraction([
      {
        doc: "echo-2026-03-12",
        expected: [],
        result: ground([{ fact: "nyha_class", value: "III", confidence: 0.9, quote: "symptoms consistent with NYHA class III heart failure" }]),
      },
    ]);
    expect(r.counts.fp).toBe(1);
    expect(r.precision).toBe(0);
  });

  it("counts a right value with the wrong unit as a miss, not a hit", () => {
    const r = scoreExtraction([
      {
        doc: "echo-2026-03-12",
        expected: [{ fact: "lvef", value: 32, unit: "%" }],
        result: { grounded: [{ fact: "lvef", value: 32, unit: "mmHg", status: "proposed", confidence: 0.9, extractedBy: "llm/x", reviewedBy: null }], rejected: [] },
      },
    ]);
    expect(r.counts.tp).toBe(0);
    expect(r.counts.fn).toBe(1);
  });

  it("separates a fact never proposed from one the gate over-blocked", () => {
    const notProposed = scoreExtraction([{ doc: "echo-2026-03-12", expected: [{ fact: "lvef", value: 32, unit: "%" }], result: empty }]);
    expect(notProposed.judgements[0]!.fnCause).toBe("not-proposed");

    const blocked = scoreExtraction([
      {
        doc: "echo-2026-06-01",
        expected: [{ fact: "lvef", value: 55, unit: "%" }],
        // right value, unit the fact model does not declare -> gate kills it
        result: ground([{ fact: "lvef", value: "55", unit: "percent", confidence: 0.97, quote: "LVEF 55% by biplane Simpson's method" }], "echo-2026-06-01"),
      },
    ]);
    expect(blocked.judgements[0]!.fnCause).toBe("over-blocked");
    expect(blocked.grounding.overBlocked).toBe(1);
    expect(blocked.grounding.caught).toBe(0);
  });

  it("credits the gate for catching a fact the corpus does not contain", () => {
    const r = scoreExtraction([
      {
        doc: "echo-2026-01-22",
        expected: [],
        result: ground([{ fact: "lvef", value: "40-45", unit: "%", confidence: 0.71, quote: "EF visually estimated at 40-45%" }], "echo-2026-01-22"),
      },
    ]);
    expect(r.grounding.caught).toBe(1);
    expect(r.grounding.overBlocked).toBe(0);
    expect(r.counts.fp).toBe(0); // it never reached the file, so it is not a false positive
    expect(r.grounding.byReason["type-mismatch"]).toBe(1);
  });

  it("reports a per-fact breakdown", () => {
    const r = scoreExtraction([
      {
        doc: "echo-2026-03-12",
        expected: [{ fact: "nyha_class", value: "III" }, { fact: "lvef", value: 32, unit: "%" }],
        result: ground([{ fact: "nyha_class", value: "III", confidence: 0.9, quote: "symptoms consistent with NYHA class III heart failure" }]),
      },
    ]);
    expect(r.perFact.nyha_class).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(r.perFact.lvef).toMatchObject({ tp: 0, fp: 0, fn: 1, recall: 0 });
  });

  it("handles an empty corpus without dividing by zero", () => {
    const r = scoreExtraction([]);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
    expect(r.calibration.ece).toBe(0);
    expect(r.grounding.passRate).toBe(0);
  });
});

describe("confidence calibration", () => {
  const synth = (rows: [number, boolean][]): ScoredCase[] =>
    rows.map(([confidence, correct], i) => ({
      doc: `d${i}`,
      expected: correct ? [{ fact: "nyha_class", value: "III" }] : [],
      result: {
        grounded: [{ fact: "nyha_class", value: "III", status: "proposed" as const, confidence, extractedBy: "llm/x", reviewedBy: null }],
        rejected: [],
      },
    }));

  it("buckets self-estimates against actual correctness", () => {
    const r = scoreExtraction(synth([[0.95, true], [0.9, true], [0.65, false], [0.75, true]]), { buckets: 5 });
    const b8 = r.calibration.buckets.find((b) => b.lo === 0.8)!;
    expect(b8.n).toBe(2);
    expect(b8.accuracy).toBe(1);

    const b6 = r.calibration.buckets.find((b) => b.lo === 0.6)!;
    expect(b6.n).toBe(2);
    expect(b6.accuracy).toBe(0.5);
  });

  it("reports positive gap for an overconfident model", () => {
    const r = scoreExtraction(synth([[0.95, false], [0.95, false], [0.95, true], [0.95, true]]), { buckets: 5 });
    const b = r.calibration.buckets.find((b) => b.lo === 0.8)!;
    expect(b.gap).toBeCloseTo(0.45, 5);
    expect(r.calibration.ece).toBeCloseTo(0.45, 5);
  });

  it("reports zero ECE for a perfectly calibrated model", () => {
    const r = scoreExtraction(synth([[0.5, true], [0.5, false]]), { buckets: 2 });
    expect(r.calibration.ece).toBeCloseTo(0, 5);
  });

  it("puts a 1.0 self-estimate in the top bucket, not off the end", () => {
    const r = scoreExtraction(synth([[1, true]]), { buckets: 5 });
    expect(r.calibration.buckets.at(-1)!.n).toBe(1);
  });

  it("leaves empty buckets visible rather than dropping them", () => {
    const r = scoreExtraction(synth([[0.95, true]]), { buckets: 5 });
    expect(r.calibration.buckets).toHaveLength(5);
    expect(r.calibration.buckets[0]).toMatchObject({ n: 0, accuracy: null, gap: null });
  });

  it("calibrates on grounded facts only — a reviewer never sees a rejection", () => {
    const r = scoreExtraction([
      {
        doc: "echo-2026-01-22",
        expected: [],
        result: groundProposedFacts([{ fact: "lvef", value: "40-45", unit: "%", confidence: 0.71, quote: "EF visually estimated at 40-45%" }], {
          doc: "echo-2026-01-22",
          extractedBy: "llm/claude-opus-5",
          ctx: CTX,
        }),
      },
    ]);
    expect(r.calibration.buckets.every((b) => b.n === 0)).toBe(true);
  });
});

describe("the committed corpus run", () => {
  const cases: ScoredCase[] = EXPECTED.cases.map((c) => ({
    doc: c.doc,
    expected: c.expected,
    result: groundProposedFacts(parseResponse(loadRecorded(c.doc).parsed_output), {
      doc: c.doc,
      extractedBy: "llm/claude-opus-5",
      ctx: CTX,
    }),
  }));
  const report = scoreExtraction(cases);

  it("scores the recorded responses over all 10 notes", () => {
    expect(report.cases).toBe(10);
    expect(report.counts.expected).toBe(58);
    expect(report.counts.tp).toBe(57);
    expect(report.counts.fp).toBe(1);
    expect(report.counts.fn).toBe(1);
  });

  it("holds precision and recall above the CI floor", () => {
    expect(report.precision).toBeGreaterThan(0.95);
    expect(report.recall).toBeGreaterThan(0.95);
  });

  it("kills all three bad proposals at the gate and over-blocks exactly one", () => {
    expect(report.grounding.rejected).toBe(3);
    expect(report.grounding.caught).toBe(2);
    expect(report.grounding.overBlocked).toBe(1);
    expect(report.grounding.byReason).toEqual({ "type-mismatch": 1, "unit-mismatch": 1, "quote-not-found": 1 });
  });

  it("catches the range trap and the fabricated quote specifically", () => {
    const range = cases.find((c) => c.doc === "echo-2026-01-22")!;
    expect(range.result.grounded).toEqual([]);
    expect(range.result.rejected[0]!.reasons).toContain("type-mismatch");

    const ambiguous = cases.find((c) => c.doc === "echo-2026-07-21")!;
    expect(ambiguous.result.rejected[0]!.fact).toBe("nyha_class");
    expect(ambiguous.result.rejected[0]!.reasons).toContain("quote-not-found");
  });

  it("shows the self-estimates are not calibrated in either direction", () => {
    // The unsure bucket is overconfident (it holds the one false positive);
    // the confident bucket is underconfident (everything in it was right).
    // Neither gap is zero, which is the point the README makes about treating
    // a self-estimate as a probability.
    const unsure = report.calibration.buckets.find((b) => b.lo === 0.6)!;
    const confident = report.calibration.buckets.at(-1)!;
    expect(unsure.gap).toBeGreaterThan(0);
    expect(confident.gap).toBeLessThan(0);
    expect(report.calibration.ece).toBeGreaterThan(0);
  });

  it("renders a report a human can read", () => {
    const text = formatEvalReport(report);
    expect(text).toContain("precision");
    expect(text).toContain("confidence calibration");
    expect(text).toContain("not calibrated probabilities");
    expect(text).toContain("FP clinic-2026-02-04 on_sglt2_inhibitor");
    expect(text).toContain("over-blocked");
  });
});
