import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { structuralDiff } from "../../src/core/diff.js";
import type { Criterion, PatientFacts, RuleSet } from "../../src/core/schema.js";
import { realEngine } from "../src/engine/real.js";
import { topYield } from "../src/sensitivity/compute.js";

const ruleset = (criteria: Criterion[]): RuleSet => ({
  ruleset: "scale-probe",
  rulesetVersion: "1.0.0",
  factModel: "patient-facts/v1",
  criteria,
});
describe("deployment-shaped performance budgets", () => {
  it("diffs 1,000 wholesale replacements within a stable linear-time budget", () => {
    const count = 1_000;
    const before = ruleset(
      Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        ref: `R${i}`,
        kind: "inclusion" as const,
        verbatim: `Age threshold ${i}`,
        when: { fact: "age", op: "gte" as const, value: i, unit: "years" },
      })),
    );
    const after = ruleset(
      Array.from({ length: count }, (_, i) => ({
        id: `new-${i}`,
        ref: `R${i}`,
        kind: "exclusion" as const,
        verbatim: `Renal threshold ${i}`,
        when: { fact: "egfr", op: "lt" as const, value: i },
      })),
    );

    const started = performance.now();
    const diff = structuralDiff(before, after);
    const elapsed = performance.now() - started;

    expect(diff.renamed).toEqual([]);
    expect(diff.added).toHaveLength(count);
    expect(diff.removed).toHaveLength(count);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("prices 100 knobs across 500 patients with one baseline evaluation per patient", () => {
    const criterionCount = 100;
    const patientCount = 500;
    const set = ruleset(
      Array.from({ length: criterionCount }, (_, i) => ({
        id: `age-${i}`,
        kind: "inclusion" as const,
        verbatim: `Age at least ${i}`,
        when: { fact: "age", op: "gte" as const, value: i, unit: "years" },
      })),
    );
    const yaml = stringify(set);
    const cohort: PatientFacts[] = Array.from({ length: patientCount }, (_, i) => ({
      patient: `P-${i}`,
      facts: { age: i % criterionCount },
    }));
    let evaluations = 0;
    const engine = {
      ...realEngine,
      evalPatient(text: string, patient: PatientFacts) {
        evaluations += 1;
        return realEngine.evalPatient(text, patient);
      },
    };

    const started = performance.now();
    const yields = topYield(yaml, cohort, engine);
    const elapsed = performance.now() - started;

    expect(yields).toHaveLength(criterionCount);
    expect(evaluations).toBe(patientCount);
    expect(elapsed).toBeLessThan(2_000);
  });
});
