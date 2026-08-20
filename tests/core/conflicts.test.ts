import { describe, it, expect } from "vitest";
import { detectConflicts } from "../../src/core/conflicts.js";
import { parseRuleSet } from "../../src/core/schema.js";

const rs = (body: string) => parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
${body}`);

describe("contradictory band (the spec's flagship conflict)", () => {
  it("I3 egfr >= 30 vs E3 egfr < 45 → error with band [30, 45)", () => {
    const out = detectConflicts(rs(`
  - { id: egfr-min, ref: I3, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 30 } }
  - { id: renal-safety, ref: E3, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    const f = out.find((x) => x.code === "contradictory-band");
    expect(f?.level).toBe("error");
    expect(f?.criteria.sort()).toEqual(["egfr-min", "renal-safety"]);
    expect(f?.evidence).toBe("egfr: inclusion admits [30, ∞) ∩ exclusion fires (−∞, 45) → contradictory band [30, 45)");
  });

  it("no band when exclusion sits below the inclusion floor", () => {
    const out = detectConflicts(rs(`
  - { id: egfr-min, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 45 } }
  - { id: renal-safety, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    expect(out.find((x) => x.code === "contradictory-band")).toBeUndefined();
  });

  it("criteria with any/not are left out of interval analysis", () => {
    const out = detectConflicts(rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { any: [ { fact: egfr, op: gte, value: 30 } ] } }
  - { id: b, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }`));
    expect(out.find((x) => x.code === "contradictory-band")).toBeUndefined();
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

  it("a criterion whose only leaves are neq (nothing analyzable) is not accused of anything", () => {
    const out = detectConflicts(rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { fact: age, op: neq, value: 5 } }`));
    expect(out).toHaveLength(0);
  });
});
