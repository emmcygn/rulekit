/**
 * Adversarial probes — coverage and dead-rule semantics (attack surface 5).
 */
import { describe, it, expect } from "vitest";
import { runSuite, deadRules } from "../../src/core/testing.js";
import type { RuleSet, TestSuite } from "../../src/core/schema.js";

const rs: RuleSet = {
  ruleset: "coverage-probe",
  rulesetVersion: "1.0.0",
  factModel: "probe/v1",
  criteria: [
    { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
    { id: "chart-review", kind: "inclusion", verbatim: "Investigator judges the patient stable", unmodeled: true },
    { id: "nyha-class", kind: "exclusion", verbatim: "NYHA class IV", when: { fact: "nyha_class", op: "eq", value: 4 } },
  ],
};

describe("D1 — an unmodeled criterion is reported as a test-coverage gap", () => {
  const suite: TestSuite = {
    cases: [
      { name: "adult", facts: { age: 40, nyha_class: 2 }, expect: {} },
      { name: "child", facts: { age: 4, nyha_class: 2 }, expect: {} },
    ],
  };

  it('reads "never passes, never fails" — a gap no test case can ever close', () => {
    const cov = runSuite(rs, suite).coverage.find((c) => c.criterion === "chart-review")!;
    expect(cov).toMatchObject({ pass: 0, fail: 0, unknown: 2 });
    // MISLEADS: the CLI prints "chart-review: 0/0/2  ⚠ never passes, never fails"
    // in the same column as a genuine untested branch. Unmodeled criteria are
    // structurally unknown; `deadRules` knows this and skips them, `coverage`
    // does not.
    expect(cov.gaps).toEqual(["never passes", "never fails"]);
  });

  it("deadRules correctly exempts unmodeled criteria", () => {
    expect(deadRules(rs, [{ patient: "P", facts: { age: 40, nyha_class: 2 } }]).map((d) => d.criterion))
      .not.toContain("chart-review");
  });
});

describe("D2 — a criterion that is ALWAYS unknown is filed as a harmless dead rule", () => {
  const corpus = [
    { patient: "P1", facts: { age: 40 } }, // nyha_class never present
    { patient: "P2", facts: { age: 50 } },
  ];

  it('"never fires on the corpus" hides that it makes every patient undetermined', () => {
    const dead = deadRules(rs, corpus);
    const nyha = dead.find((d) => d.criterion === "nyha-class")!;
    expect(nyha.reason).toBe("never fires on the corpus (0 of 2 patients)");
    // MISLEADS: the same sentence is produced by "no corpus patient has NYHA IV"
    // (rule is fine, corpus is thin) and by "this fact is absent from every
    // patient file" (rule is inert and poisons the whole cohort). Here it is
    // the second, and every patient is undetermined because of it.
    expect(corpus.every((p) => {
      const ev = runSuite(rs, { cases: [{ name: p.patient, facts: p.facts, expect: {} }] });
      return ev.cases.length === 1;
    })).toBe(true);
  });

  it("an inclusion in the same state is reported as 'never fails' — reads like a no-op", () => {
    const inclusionOnly: RuleSet = {
      ...rs,
      criteria: [{ id: "lvef-40", kind: "inclusion", verbatim: "LVEF <= 40", when: { fact: "lvef", op: "lte", value: 40 } }],
    };
    expect(deadRules(inclusionOnly, corpus)[0]!.reason).toBe("never fails on the corpus (0 of 2 patients)");
    // ...while in truth it passes nobody either: everyone is unknown.
    const cov = runSuite(inclusionOnly, { cases: corpus.map((p) => ({ name: p.patient, facts: p.facts, expect: {} })) }).coverage[0]!;
    expect(cov).toMatchObject({ pass: 0, fail: 0, unknown: 2 });
  });
});

describe("D3 — coverage counts the suite, `deadRules` counts the corpus, and the CLI prints both under one heading", () => {
  it("a criterion can be green in coverage and dead on the corpus at once", () => {
    const suite: TestSuite = {
      cases: [
        { name: "nyha4", facts: { age: 40, nyha_class: 4 }, expect: {} },
        { name: "nyha2", facts: { age: 40, nyha_class: 2 }, expect: {} },
      ],
    };
    const cov = runSuite(rs, suite).coverage.find((c) => c.criterion === "nyha-class")!;
    expect(cov.gaps).toEqual([]); // exercised in both directions by the suite
    expect(deadRules(rs, [{ patient: "P1", facts: { age: 40, nyha_class: 2 } }]).map((d) => d.criterion))
      .toContain("nyha-class"); // and never fires on the corpus
  });
});
