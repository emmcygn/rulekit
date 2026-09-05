import { describe, it, expect } from "vitest";
import { detectConflicts } from "../../src/core/conflicts.js";
import { parseRuleSet } from "../../src/core/schema.js";

const rs = (body: string) => parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
${body}`);

describe("inclusion/exclusion overlap", () => {
  it("partial overlap is ordinary exclusion logic, not a contradiction", () => {
    const out = detectConflicts(rs(`
  - { id: egfr-min, ref: I3, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 30 } }
  - { id: renal-safety, ref: E3, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    expect(out.filter((x) => x.level === "error")).toEqual([]);
  });

  it("no band when exclusion sits below the inclusion floor", () => {
    const out = detectConflicts(rs(`
  - { id: egfr-min, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 45 } }
  - { id: renal-safety, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    expect(out.find((x) => x.code === "unsatisfiable-ruleset")).toBeUndefined();
  });

  it("criteria with any/not are left out of interval analysis", () => {
    const out = detectConflicts(rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { any: [ { fact: egfr, op: gte, value: 30 } ] } }
  - { id: b, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    expect(out.find((x) => x.code === "unsatisfiable-ruleset")).toBeUndefined();
    expect(out.find((x) => x.code === "analysis-incomplete")).toBeDefined();
  });

  it("errors only when an exclusion covers the entire admitted domain", () => {
    const out = detectConflicts(rs(`
  - { id: adult, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }
  - { id: nobody, kind: exclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }`));
    expect(out.find((x) => x.code === "unsatisfiable-ruleset")?.level).toBe("error");
  });

  it("does not blame an exclusion when inclusions already admit an empty interval", () => {
    const out = detectConflicts(rs(`
  - { id: older, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 60 } }
  - { id: younger, kind: inclusion, verbatim: v, when: { fact: age, op: lt, value: 50 } }
  - { id: very-old, kind: exclusion, verbatim: v, when: { fact: age, op: gt, value: 100 } }`));
    expect(out.find((x) => x.code === "contradictory-inclusions")).toBeDefined();
    expect(out.find((x) => x.code === "unsatisfiable-ruleset")).toBeUndefined();
  });

  it("detects a simple inclusion code set fully covered by an exclusion set", () => {
    const out = detectConflicts(rs(`
  - { id: requires-af, kind: inclusion, verbatim: v, when: { fact: conditions, op: in, codes: { system: snomed, values: [af] } } }
  - { id: excludes-arrhythmia, kind: exclusion, verbatim: v, when: { fact: conditions, op: in, codes: { system: snomed, values: [af, flutter] } } }`));
    const finding = out.find((x) => x.code === "unsatisfiable-ruleset");
    expect(finding?.criteria).toEqual(["requires-af", "excludes-arrhythmia"]);
  });

  it("does not extend the code-set proof through additional exclusion logic", () => {
    const out = detectConflicts(rs(`
  - { id: requires-af, kind: inclusion, verbatim: v, when: { fact: conditions, op: in, codes: { system: snomed, values: [af] } } }
  - id: conditional-exclusion
    kind: exclusion
    verbatim: v
    when:
      all:
        - { fact: conditions, op: in, codes: { system: snomed, values: [af] } }
        - { fact: age, op: gt, value: 100 }`));
    expect(out.find((x) => x.code === "unsatisfiable-ruleset")).toBeUndefined();
  });
});

describe("contradictory inclusions (no patient can pass the set)", () => {
  it("age >= 65 and age <= 40 across two inclusions → error naming both", () => {
    const out = detectConflicts(rs(`
  - { id: elderly, ref: I1, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 65 } }
  - { id: young, ref: I2, kind: inclusion, verbatim: v, when: { fact: age, op: lte, value: 40 } }`));
    const f = out.find((x) => x.code === "contradictory-inclusions");
    expect(f?.level).toBe("error");
    expect(f?.criteria.sort()).toEqual(["elderly", "young"]);
    expect(f?.evidence).toBe(
      "age: inclusion constraints intersect to the empty set — \"elderly\" admits [65, ∞) ∩ \"young\" admits (−∞, 40]",
    );
    expect(out.find((x) => x.code === "unsatisfiable-criterion")).toBeUndefined();
  });

  it("a single inclusion with an empty interval stays unsatisfiable-criterion, not contradictory-inclusions", () => {
    const out = detectConflicts(rs(`
  - id: impossible
    kind: inclusion
    verbatim: v
    when:
      all:
        - { fact: age, op: gte, value: 65 }
        - { fact: age, op: lt, value: 60 }`));
    expect(out.find((x) => x.code === "unsatisfiable-criterion")?.level).toBe("error");
    expect(out.find((x) => x.code === "contradictory-inclusions")).toBeUndefined();
  });

  it("compatible inclusions on the same fact do not fire", () => {
    const out = detectConflicts(rs(`
  - { id: floor, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }
  - { id: ceiling, kind: inclusion, verbatim: v, when: { fact: age, op: lte, value: 80 } }`));
    expect(out.find((x) => x.code === "contradictory-inclusions")).toBeUndefined();
  });

  it("an exclusion never contributes to the inclusion intersection", () => {
    const out = detectConflicts(rs(`
  - { id: floor, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 65 } }
  - { id: cap, kind: exclusion, verbatim: v, when: { fact: age, op: lte, value: 40 } }`));
    expect(out.find((x) => x.code === "contradictory-inclusions")).toBeUndefined();
  });

  it("detects incompatible code-set inclusions", () => {
    const out = detectConflicts(rs(`
  - { id: requires-af, kind: inclusion, verbatim: v, when: { fact: conditions, op: in, codes: { system: snomed, values: [af] } } }
  - { id: forbids-af, kind: inclusion, verbatim: v, when: { fact: conditions, op: notIn, codes: { system: snomed, values: [af, flutter] } } }`));
    const f = out.find((x) => x.code === "contradictory-inclusions");
    expect(f?.level).toBe("error");
    expect(f?.criteria).toEqual(["requires-af", "forbids-af"]);
  });
});

describe("unsatisfiable and vacuous", () => {
  it("age >= 65 AND age < 60 in one criterion → unsatisfiable error", () => {
    const out = detectConflicts(rs(`
  - id: impossible
    kind: inclusion
    verbatim: v
    when:
      all:
        - { fact: age, op: gte, value: 65 }
        - { fact: age, op: lt, value: 60 }`));
    expect(out.find((x) => x.code === "unsatisfiable-criterion")?.level).toBe("error");
  });

  it("vacuous detection is deferred: no vacuous-criterion code is ever emitted", () => {
    const out = detectConflicts(rs(`
  - id: pointless
    kind: inclusion
    verbatim: v
    when:
      all:
        - { fact: age, op: gte, value: 0 }
        - { fact: age, op: neq, value: -1 }`));
    expect(out.find((x) => x.code === "vacuous-criterion")).toBeUndefined();
    expect(out.filter((x) => x.level === "error")).toHaveLength(0);
  });

  it("a criterion whose only leaves are neq reports incomplete analysis without inventing a conflict", () => {
    const out = detectConflicts(rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { fact: age, op: neq, value: 5 } }`));
    expect(out.filter((x) => x.level === "error")).toHaveLength(0);
    expect(out.find((x) => x.code === "analysis-incomplete")).toBeDefined();
  });
});
