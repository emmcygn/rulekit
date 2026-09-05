import { describe, it, expect } from "vitest";
import { lintPatient, lintRuleSet } from "../../src/core/lint.js";
import { parseRuleSet, parseFactModel } from "../../src/core/schema.js";

const FM = parseFactModel(`
name: patient-facts/v1
facts:
  age: { type: number, unit: years }
  egfr: { type: number, unit: mL/min/1.73m2 }
  medications: { type: code, systems: [rxnorm, rxnorm-class] }
  sex: { type: enum, values: [female, male] }
  consented: { type: boolean }
`);

const rs = (body: string) => parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
${body}`);

describe("lintRuleSet", () => {
  it("clean rule set → no error findings", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18, unit: years } }`);
    expect(lintRuleSet(r, FM).filter((f) => f.level === "error")).toHaveLength(0);
  });

  it("unknown fact → error", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: lvef, op: lte, value: 40 } }`);
    const f = lintRuleSet(r, FM).find((x) => x.code === "unknown-fact");
    expect(f?.level).toBe("error");
    expect(f?.criteria).toEqual(["a"]);
  });

  it("unit mismatch → blocking error naming both units", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 30, unit: mL/min } }`);
    const f = lintRuleSet(r, FM).find((x) => x.code === "unit-mismatch");
    expect(f?.level).toBe("error");
    expect(f?.message).toContain("mL/min");
    expect(f?.message).toContain("mL/min/1.73m2");
  });

  it("rejects a unit literal on a fact declared unitless", () => {
    const model = parseFactModel(`name: patient-facts/v1\nfacts: { score: { type: number } }`);
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: score, op: gte, value: 1, unit: points } }`);
    expect(lintRuleSet(r, model).find((x) => x.code === "unit-unexpected")?.level).toBe("error");
  });

  it("code system not declared for fact → error", () => {
    const r = rs(`  - { id: a, kind: exclusion, verbatim: v, when: { fact: medications, op: in, codes: { system: atc, values: [B01] } } }`);
    expect(lintRuleSet(r, FM).find((x) => x.code === "unknown-code-system")?.level).toBe("error");
  });

  it("numeric op on a code fact → type-mismatch error; unmodeled → info", () => {
    const r = rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { fact: medications, op: gte, value: 2 } }
  - { id: b, kind: exclusion, verbatim: v, unmodeled: true }`);
    const out = lintRuleSet(r, FM);
    expect(out.find((x) => x.code === "type-mismatch")?.level).toBe("error");
    expect(out.find((x) => x.code === "unmodeled-criterion")?.level).toBe("info");
  });

  it("rejects a rule set bound to a different fact model", () => {
    const r = { ...rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18, unit: years } }`), factModel: "other/v1" };
    expect(lintRuleSet(r, FM).find((x) => x.code === "fact-model-mismatch")?.level).toBe("error");
  });

  it("validates enum/boolean equality and enum membership", () => {
    const good = rs(`
  - { id: a, kind: inclusion, verbatim: v, when: { fact: sex, op: eq, value: female } }
  - { id: b, kind: inclusion, verbatim: v, when: { fact: consented, op: eq, value: true } }`);
    expect(lintRuleSet(good, FM).filter((f) => f.level === "error")).toEqual([]);
    const bad = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: sex, op: eq, value: unknown } }`);
    expect(lintRuleSet(bad, FM).some((f) => f.code === "unknown-enum-value")).toBe(true);
  });

  it("rejects presence-only checks for enum and boolean facts", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: consented, op: exists } }`);
    expect(lintRuleSet(r, FM).some((f) => f.code === "exists-value-type")).toBe(true);
  });
});

describe("lintPatient", () => {
  it("catches declared type, enum, and code-system violations", () => {
    const out = lintPatient({ patient: "P", facts: {
      age: "old",
      sex: "unknown",
      consented: "yes",
      medications: [{ system: "atc", code: "B01" }],
    } }, FM);
    expect(out).toHaveLength(4);
    expect(out.every((f) => f.code === "invalid-patient-fact" && f.level === "error")).toBe(true);
  });

  it("validates numeric companion units, including spelling-only aliases", () => {
    const valid = lintPatient({ patient: "P", facts: { egfr: 52, egfr_unit: "mL/min/{1.73_m2}" } }, FM);
    expect(valid.filter((f) => f.level === "error")).toEqual([]);

    const invalid = lintPatient({ patient: "P", facts: { egfr: 52, egfr_unit: "mL/min" } }, FM);
    expect(invalid.find((f) => f.code === "invalid-patient-unit")?.message).toContain("conversion is required");
  });

  it("rejects a companion unit for a unitless numeric fact", () => {
    const model = parseFactModel(`name: m\nfacts: { score: { type: number } }`);
    const out = lintPatient({ patient: "P", facts: { score: 2, score_unit: "points" } }, model);
    expect(out.find((f) => f.code === "invalid-patient-unit")?.message).toContain("declared unitless");
  });
});
