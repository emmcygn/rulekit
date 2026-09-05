/**
 * Adversarial probes — screen counts vs the workbench funnel (attack surface 7).
 *
 * HISTORY: these probes originally DOCUMENTED a real divergence. `rules screen`
 * bucketed patients by `evalPatient`'s order-independent `overall`, while the
 * old `computeFunnel` drained a pool in criterion order and let an `unknown`
 * remove a patient before a later `fail` could — on the commander-hf cohort the
 * two disagreed on every headline number (0 vs 2 potentially eligible, 97 vs 92
 * screen failures), and swapping two criteria in the YAML moved a patient
 * between bands.
 *
 * The fix wave rewired both surfaces onto core's `attrition.ts`, whose rule is:
 * a patient's band comes from `evalPatient().overall` and nothing else. These
 * probes are now the REGRESSIONS that pin the convergence: if the CLI and the
 * funnel ever disagree again, or banding ever becomes order-sensitive again,
 * this file fails.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evalPatientUnsafe as evalPatient } from "../../src/core/evaluator.js";
import { parsePatient, parseRuleSet, type Overall, type RuleSet } from "../../src/core/schema.js";
import { computeAttrition } from "../../src/core/attrition.js";
import { computeFunnel, cohortCounts } from "../../web/src/funnel/compute.js";

const ROOT = join(import.meta.dirname, "..", "..");
const corpus = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parsePatient(readFileSync(join(ROOT, dir, f), "utf8")));

const counts = (rs: RuleSet, patients: ReturnType<typeof corpus>) => {
  const out: Record<Overall, number> = { eligible: 0, ineligible: 0, undetermined: 0 };
  for (const p of patients) out[evalPatient(rs, p).overall] += 1;
  return out;
};

describe("E1 — the CLI and the funnel report ONE story per cohort (regression of a fixed divergence)", () => {
  const rs = parseRuleSet(readFileSync(join(ROOT, "rules/trials/commander-hf/ruleset.yaml"), "utf8"));
  const patients = corpus("corpus/normalized");
  const evals = patients.map((p) => evalPatient(rs, p));

  it("`rules screen` on corpus/normalized: 0 eligible / 97 ineligible / 3 undetermined", () => {
    expect(counts(rs, patients)).toEqual({ eligible: 0, ineligible: 97, undetermined: 3 });
  });

  it("the funnel's headline numbers are exactly the engine's overall verdicts", () => {
    const cohort = cohortCounts(evals);
    expect(cohort).toEqual({ potentiallyEligible: 0, screenFail: 97, notEvaluable: 3 });
    expect(cohort.screenFail + cohort.notEvaluable + cohort.potentiallyEligible).toBe(patients.length);
  });

  it("the web funnel and core computeAttrition agree band for band", () => {
    const a = computeAttrition(rs, patients);
    const f = computeFunnel(evals);
    expect(f.attrition.bands).toEqual(a.bands);
    expect(f.attrition.rows).toEqual(a.rows);
  });
});

describe("E2 — banding is order-INsensitive (regression of a fixed divergence)", () => {
  // A patient who is unknown on an early criterion and fails a later one used to
  // change band when the two criteria swapped places in the YAML. Now the band
  // is a function of `overall` alone, so criterion order cannot move anyone.
  const A = `
ruleset: order-a
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: washout, kind: exclusion, verbatim: v, when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: [warfarin] }, windowDays: 30 } }
  - { id: renal, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }
`;
  const B = `
ruleset: order-b
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: renal, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }
  - { id: washout, kind: exclusion, verbatim: v, when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: [warfarin] }, windowDays: 30 } }
`;
  // egfr 41 fails renal; medications missing → washout unknown.
  const patient = { patient: "P-ORDER", facts: { egfr: 41 } };

  it("the same patient lands in the same band under both criterion orders", () => {
    for (const yaml of [A, B]) {
      const rs = parseRuleSet(yaml);
      const f = computeFunnel([evalPatient(rs, patient)]);
      expect(f.attrition.bands).toEqual({ "potentially-eligible": 0, "screen-fail": 1, "not-evaluable": 0 });
    }
  });
});

describe("E3 — per-criterion funnel columns are internally consistent (attack failed, still pinned)", () => {
  const rs = parseRuleSet(readFileSync(join(ROOT, "rules/trials/commander-hf/ruleset.yaml"), "utf8"));
  const evals = corpus("corpus/normalized").map((p) => evalPatient(rs, p));

  it("sequential removals sum exactly to the screen-fail band", () => {
    const f = computeFunnel(evals);
    const removed = f.attrition.rows.reduce((s, r) => s + r.removedSequential, 0);
    expect(removed).toBe(f.attrition.bands["screen-fail"]);
  });
});
