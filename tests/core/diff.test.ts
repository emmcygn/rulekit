import { describe, it, expect } from "vitest";
import { structuralDiff, behavioralDiff } from "../../src/core/diff.js";
import { parseRuleSet } from "../../src/core/schema.js";

const V1 = parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: age-min, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }
  - { id: anticoag-washout, kind: exclusion, verbatim: v, when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: [warfarin] }, windowDays: 14 } }
`);
const V2 = parseRuleSet(`
ruleset: r
rulesetVersion: 1.1.0
factModel: patient-facts/v1
criteria:
  - { id: age-min, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }
  - { id: anticoag-washout, kind: exclusion, verbatim: v, when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: [warfarin] }, windowDays: 30 } }
  - { id: renal-safety, kind: exclusion, verbatim: v, when: { fact: egfr, op: lt, value: 45 } }
`);

describe("structuralDiff", () => {
  it("finds added and changed criteria; version bump alone is not a change", () => {
    expect(structuralDiff(V1, V2)).toEqual({ added: ["renal-safety"], removed: [], changed: ["anticoag-washout"] });
    expect(structuralDiff(V1, V1)).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("behavioralDiff (the amendment money shot)", () => {
  it("reports flips with the responsible criterion", () => {
    const corpus = [
      { patient: "SYN-088", facts: { age: 47, egfr: 60, medications: [{ code: "warfarin", system: "rxnorm", daysAgo: 21 }] } }, // flips: widened washout window
      { patient: "SYN-007", facts: { age: 61, egfr: 38, medications: [] } },   // flips: new renal-safety
      { patient: "OK-1", facts: { age: 40, egfr: 60, medications: [] } },      // no flip
    ];
    const flips = behavioralDiff(V1, V2, corpus);
    expect(flips).toHaveLength(2);
    const byPatient = Object.fromEntries(flips.map((f) => [f.patient, f]));
    expect(byPatient["SYN-088"]).toEqual({ patient: "SYN-088", from: "eligible", to: "ineligible", responsible: ["anticoag-washout"] });
    expect(byPatient["SYN-007"]).toEqual({ patient: "SYN-007", from: "eligible", to: "ineligible", responsible: ["renal-safety"] });
  });
});
