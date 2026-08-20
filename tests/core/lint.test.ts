import { describe, it, expect } from "vitest";
import { lintRuleSet } from "../../src/core/lint.js";
import { parseRuleSet, parseFactModel } from "../../src/core/schema.js";

const FM = parseFactModel(`
name: patient-facts/v1
facts:
  age: { type: number, unit: years }
  egfr: { type: number, unit: mL/min/1.73m2 }
  medications: { type: code, systems: [rxnorm, rxnorm-class] }
`);

const rs = (body: string) => parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
${body}`);

describe("lintRuleSet", () => {
  it("clean rule set → no error findings", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: age, op: gte, value: 18 } }`);
    expect(lintRuleSet(r, FM).filter((f) => f.level === "error")).toHaveLength(0);
  });

  it("unknown fact → error", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: lvef, op: lte, value: 40 } }`);
    const f = lintRuleSet(r, FM).find((x) => x.code === "unknown-fact");
    expect(f?.level).toBe("error");
    expect(f?.criteria).toEqual(["a"]);
  });

  it("unit mismatch → warning naming both units", () => {
    const r = rs(`  - { id: a, kind: inclusion, verbatim: v, when: { fact: egfr, op: gte, value: 30, unit: mL/min } }`);
    const f = lintRuleSet(r, FM).find((x) => x.code === "unit-mismatch");
    expect(f?.level).toBe("warning");
    expect(f?.message).toContain("mL/min");
    expect(f?.message).toContain("mL/min/1.73m2");
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
});
