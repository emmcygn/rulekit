import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeAttrition, soleReasonCriterionId } from "../../src/core/attrition.js";
import { evalPatient } from "../../src/core/evaluator.js";
import { parsePatient, parseRuleSet, type PatientFacts, type RuleSet } from "../../src/core/schema.js";

const rs = (...criteria: RuleSet["criteria"]): RuleSet => ({
  ruleset: "attrition-probe",
  rulesetVersion: "1.0.0",
  factModel: "patient-facts/v1",
  criteria,
});

const adult = { id: "adult", kind: "inclusion" as const, verbatim: "Age >= 18", when: { fact: "age", op: "gte" as const, value: 18, unit: "years" } };
const renal = { id: "renal", kind: "inclusion" as const, verbatim: "eGFR >= 30", when: { fact: "egfr", op: "gte" as const, value: 30, unit: "mL/min/1.73m2" } };
const chart = { id: "chart-review", kind: "exclusion" as const, verbatim: "Investigator judgement", unmodeled: true as const };

describe("computeAttrition — bands", () => {
  const set = rs(adult, renal);
  const corpus: PatientFacts[] = [
    { patient: "IN", facts: { age: 70, egfr: 60 } }, // eligible
    { patient: "TOO-YOUNG", facts: { age: 12, egfr: 60 } }, // ineligible
    { patient: "NO-EGFR", facts: { age: 70 } }, // undetermined
  ];

  it("derives every band from evalPatient().overall and nothing else", () => {
    const a = computeAttrition(set, corpus);
    expect(a.n).toBe(3);
    expect(a.bands).toEqual({ "potentially-eligible": 1, "screen-fail": 1, "not-evaluable": 1 });
    expect(a.patients.map((p) => [p.patient, p.band])).toEqual([
      ["IN", "potentially-eligible"],
      ["TOO-YOUNG", "screen-fail"],
      ["NO-EGFR", "not-evaluable"],
    ]);
    // The evaluation travels with the row so no consumer has to re-run the engine.
    for (const p of a.patients) {
      expect(p.evaluation).toEqual(evalPatient(set, corpus.find((c) => c.patient === p.patient)!));
    }
  });

  it("bands close over the cohort", () => {
    const a = computeAttrition(set, corpus);
    expect(a.bands["potentially-eligible"] + a.bands["screen-fail"] + a.bands["not-evaluable"]).toBe(a.n);
  });

  it("is order-independent: swapping two criteria moves nobody", () => {
    const swapped = rs(renal, adult);
    expect(computeAttrition(swapped, corpus).bands).toEqual(computeAttrition(set, corpus).bands);
  });

  it("an empty corpus is all zeroes, not a crash", () => {
    const a = computeAttrition(set, []);
    expect(a.n).toBe(0);
    expect(a.bands).toEqual({ "potentially-eligible": 0, "screen-fail": 0, "not-evaluable": 0 });
    expect(a.rows.map((r) => r.removedSequential)).toEqual([0, 0]);
  });
});

describe("computeAttrition — per-criterion columns", () => {
  const set = rs(adult, renal, chart);
  const corpus: PatientFacts[] = [
    { patient: "P1", facts: { age: 12, egfr: 60 } }, // fails adult only
    { patient: "P2", facts: { age: 12, egfr: 10 } }, // fails both
    { patient: "P3", facts: { age: 70, egfr: 10 } }, // fails renal only
    { patient: "P4", facts: { age: 70, egfr: 60 } }, // passes everything modeled
  ];
  const a = computeAttrition(set, corpus);
  const row = (id: string) => a.rows.find((r) => r.id === id)!;

  it("rows follow rule-set order and carry ref/kind/unmodeled", () => {
    expect(a.rows.map((r) => r.id)).toEqual(["adult", "renal", "chart-review"]);
    expect(row("chart-review")).toMatchObject({ kind: "exclusion", unmodeled: true });
    expect(row("adult")).toMatchObject({ kind: "inclusion", unmodeled: false });
  });

  it("removedSequential attributes each screen fail to its FIRST failing criterion, and sums to the band", () => {
    expect(row("adult").removedSequential).toBe(2); // P1, P2
    expect(row("renal").removedSequential).toBe(1); // P3 (P2 already counted under adult)
    expect(a.rows.reduce((n, r) => n + r.removedSequential, 0)).toBe(a.bands["screen-fail"]);
  });

  it("failsAlone ignores order and is never below removedSequential", () => {
    expect(row("adult").failsAlone).toBe(2);
    expect(row("renal").failsAlone).toBe(2); // P2 and P3
    for (const r of a.rows) expect(r.failsAlone).toBeGreaterThanOrEqual(r.removedSequential);
  });

  it("soleReason does not claim eligibility while another criterion is unknown", () => {
    expect(row("adult").soleReason).toBe(0);
    expect(row("renal").soleReason).toBe(0);
    expect(a.rows.reduce((n, r) => n + r.soleReason, 0)).toBe(0);
  });

  it("an unmodeled criterion drains nobody — it is parked in chart review", () => {
    expect(row("chart-review")).toMatchObject({ removedSequential: 0, failsAlone: 0, soleReason: 0 });
    // ...and it is why P4 is not-evaluable rather than potentially-eligible.
    expect(a.patients.find((p) => p.patient === "P4")!.band).toBe("not-evaluable");
  });

  it("soleReasonCriterionId is undefined when an unknown sits elsewhere", () => {
    const modeledOnly = rs(adult, renal);
    // Relaxing `renal` would leave this patient undetermined on nothing — but
    // with a missing fact elsewhere the answer would be undetermined, not
    // eligible, so no criterion owns them.
    const missing = evalPatient(rs(adult, renal, { ...renal, id: "renal2", when: { fact: "lvef", op: "lte", value: 40, unit: "%" } }), { patient: "X", facts: { age: 70, egfr: 10 } });
    expect(soleReasonCriterionId(missing)).toBeUndefined();
    expect(soleReasonCriterionId(evalPatient(modeledOnly, { patient: "Y", facts: { age: 70, egfr: 10 } }))).toBe("renal");
  });
});

describe("computeAttrition on the shipped commander-hf cohort", () => {
  const ROOT = join(import.meta.dirname, "..", "..");
  const set = parseRuleSet(readFileSync(join(ROOT, "rules/trials/commander-hf/ruleset.yaml"), "utf8"));
  const corpus = readdirSync(join(ROOT, "corpus/normalized"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parsePatient(readFileSync(join(ROOT, "corpus/normalized", f), "utf8")));

  it("matches what `rules screen` reports — one cohort, one set of numbers", () => {
    const a = computeAttrition(set, corpus);
    expect(a.n).toBe(100);
    // `rules screen` on this corpus: 0 eligible / 97 ineligible / 3 undetermined.
    expect(a.bands).toEqual({ "potentially-eligible": 0, "screen-fail": 97, "not-evaluable": 3 });
    expect(a.rows.reduce((n, r) => n + r.removedSequential, 0)).toBe(97);
  });
});
