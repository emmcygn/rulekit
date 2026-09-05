import { describe, it, expect } from "vitest";
import { runSuite, deadRules } from "../../src/core/testing.js";
import { parseRuleSet, parseTestSuite } from "../../src/core/schema.js";

const RS = parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: age-min, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }
  - { id: renal-safety, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }
`);

describe("runSuite", () => {
  it("reports per-case pass/fail with mismatch details", () => {
    const suite = parseTestSuite(`
cases:
  - { name: adult ok, facts: { age: 40, egfr: 60 }, expect: { age-min: pass, renal-safety: pass, overall: eligible } }
  - { name: wrong expectation, facts: { age: 40, egfr: 60 }, expect: { age-min: fail, overall: eligible } }
`);
    const r = runSuite(RS, suite);
    expect(r.cases[0]!.ok).toBe(true);
    expect(r.cases[1]!.ok).toBe(false);
    expect(r.cases[1]!.mismatches).toEqual([{ key: "age-min", expected: "fail", actual: "pass" }]);
    expect(r.ok).toBe(false);
  });

  it("cannot pass vacuously when a programmatic suite omits overall", () => {
    const r = runSuite(RS, { cases: [{ name: "empty expectation", facts: { age: 40, egfr: 60 }, expect: {} }] });
    expect(r.ok).toBe(false);
    expect(r.cases[0]!.mismatches[0]).toMatchObject({ key: "overall", expected: "(required)" });
  });

  it("the parser rejects a suite without an overall assertion", () => {
    expect(() => parseTestSuite(`cases:\n  - { name: empty, facts: { age: 40 }, expect: {} }`)).toThrow(/must assert `overall`/);
  });

  it("coverage counts verdict directions and flags one-sided criteria", () => {
    const suite = parseTestSuite(`
cases:
  - { name: a, facts: { age: 40, egfr: 60 }, expect: { overall: eligible } }
  - { name: b, facts: { age: 12, egfr: 60 }, expect: { overall: ineligible } }
`);
    const cov = runSuite(RS, suite).coverage;
    const age = cov.find((c) => c.criterion === "age-min")!;
    expect(age.pass).toBe(1);
    expect(age.fail).toBe(1);
    expect(age.gaps).toEqual([]);
    const renal = cov.find((c) => c.criterion === "renal-safety")!;
    expect(renal.pass).toBe(2);
    expect(renal.fail).toBe(0);
    expect(renal.gaps).toEqual(["never fails"]);
  });

  it("does not demand impossible coverage directions from exists", () => {
    const exists = parseRuleSet(`
ruleset: exists
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: present, kind: inclusion, verbatim: v, when: { fact: age, op: exists } }
  - { id: excluded-when-present, kind: exclusion, verbatim: v, when: { fact: egfr, op: exists } }
`);
    const suite = parseTestSuite(`
cases:
  - { name: present, facts: { age: 40, egfr: 60 }, expect: { overall: ineligible } }
  - { name: absent, facts: {}, expect: { overall: undetermined } }
`);
    expect(runSuite(exists, suite).coverage.map((c) => [c.criterion, c.gaps])).toEqual([
      ["present", []],
      ["excluded-when-present", []],
    ]);
  });
});

describe("deadRules", () => {
  it("an exclusion that never fires on the corpus is dead", () => {
    const corpus = [
      { patient: "P1", facts: { age: 40, egfr: 60 } },
      { patient: "P2", facts: { age: 12, egfr: 80 } },
    ];
    expect(deadRules(RS, corpus)).toEqual([{ criterion: "renal-safety", reason: "never fires on the corpus (0 of 2 patients; 0 unknown)" }]);
  });

  it("an inclusion that never fails on the corpus is dead", () => {
    const corpus = [
      { patient: "P1", facts: { age: 40, egfr: 30 } },
      { patient: "P2", facts: { age: 70, egfr: 80 } },
    ];
    expect(deadRules(RS, corpus)).toEqual([{ criterion: "age-min", reason: "never fails on the corpus (0 of 2 patients; 0 unknown)" }]);
  });

  it("nothing dead when both directions occur", () => {
    const corpus = [
      { patient: "P1", facts: { age: 12, egfr: 30 } },
      { patient: "P2", facts: { age: 40, egfr: 60 } },
    ];
    expect(deadRules(RS, corpus)).toEqual([]);
  });

  it("does not call an inclusion exists leaf dead and emits no empty-corpus noise", () => {
    const exists = parseRuleSet(`ruleset: e\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{ id: present, kind: inclusion, verbatim: v, when: { fact: age, op: exists } }]`);
    expect(deadRules(exists, [{ patient: "P1", facts: { age: 40 } }, { patient: "P2", facts: {} }])).toEqual([]);
    expect(deadRules(RS, [])).toEqual([]);
  });
});
