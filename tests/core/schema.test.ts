import { describe, it, expect } from "vitest";
import { PARSE_LIMITS, parseRuleSet, parseFactModel, parsePatient, parseTestSuite } from "../../src/core/schema.js";

const VALID_RULESET = `
ruleset: demo-hf-001-eligibility
rulesetVersion: 1.1.0
factModel: patient-facts/v1
criteria:
  - id: age-min
    ref: I1
    kind: inclusion
    verbatim: "Age 18 years or older"
    when: { fact: age, op: gte, value: 18 }
  - id: renal-safety
    ref: E3
    kind: exclusion
    verbatim: "eGFR below 45 at screening"
    when: { fact: egfr, op: lt, value: 45 }
  - id: nyha-class-iv
    ref: E4
    kind: exclusion
    verbatim: "NYHA class IV heart failure"
    unmodeled: true
`;

describe("parseRuleSet", () => {
  it("parses a valid rule set", () => {
    const rs = parseRuleSet(VALID_RULESET);
    expect(rs.ruleset).toBe("demo-hf-001-eligibility");
    expect(rs.criteria).toHaveLength(3);
    expect(rs.criteria[2]!.unmodeled).toBe(true);
  });

  it("rejects a criterion with neither when nor unmodeled", () => {
    const bad = VALID_RULESET.replace("    when: { fact: age, op: gte, value: 18 }\n", "");
    expect(() => parseRuleSet(bad)).toThrow(/when|unmodeled/);
  });

  it("rejects an unknown op (closed language)", () => {
    const bad = VALID_RULESET.replace("op: gte", "op: matchesRegex");
    expect(() => parseRuleSet(bad)).toThrow(/op/);
  });

  it("rejects duplicate criterion ids", () => {
    const bad = VALID_RULESET.replaceAll("renal-safety", "age-min");
    expect(() => parseRuleSet(bad)).toThrow(/duplicate/i);
  });

  it("reserves overall for the aggregate test outcome", () => {
    const bad = VALID_RULESET.replace("age-min", "overall");
    expect(() => parseRuleSet(bad)).toThrow(/overall.*reserved/);
  });

  it("parses nested all/any/not conditions", () => {
    const rs = parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - id: c1
    kind: inclusion
    verbatim: "x"
    when:
      all:
        - { fact: age, op: gte, value: 18 }
        - not: { fact: conditions, op: in, codes: { system: snomed, values: ["77386006"] } }
`);
    const when = rs.criteria[0]!.when as { all: unknown[] };
    expect(when.all).toHaveLength(2);
  });

  it("rejects pathological condition depth and rule/count breadth", () => {
    let nested: unknown = { fact: "age", op: "gte", value: 18 };
    for (let i = 0; i <= PARSE_LIMITS.nestingDepth; i += 1) nested = { not: nested };
    const base = { ruleset: "r", rulesetVersion: "1.0.0", factModel: "patient-facts/v1" };
    expect(() => parseRuleSet(JSON.stringify({ ...base, criteria: [{ id: "deep", kind: "inclusion", verbatim: "v", when: nested }] }))).toThrow(/nesting exceeds/);

    const criteria = Array.from({ length: PARSE_LIMITS.criteria + 1 }, (_, i) => ({ id: `c${i}`, kind: "inclusion", verbatim: "v", when: { fact: "age", op: "gte", value: 18 } }));
    expect(() => parseRuleSet(JSON.stringify({ ...base, criteria }))).toThrow(/Too big|too big|1000/);

    const values = Array.from({ length: PARSE_LIMITS.codeValues + 1 }, (_, i) => `code-${i}`);
    const codeCriterion = [{ id: "codes", kind: "inclusion", verbatim: "v", when: { fact: "conditions", op: "in", codes: { system: "snomed", values } } }];
    expect(() => parseRuleSet(JSON.stringify({ ...base, criteria: codeCriterion }))).toThrow(/Too big|too big|1000/);
  });
});

describe("parseFactModel / parsePatient / parseTestSuite", () => {
  it("parses a fact model", () => {
    const fm = parseFactModel(`
name: patient-facts/v1
facts:
  age: { type: number, unit: years }
  egfr: { type: number, unit: mL/min/1.73m2 }
  medications: { type: code, systems: [rxnorm, rxnorm-class] }
  sex: { type: enum, values: [male, female] }
`);
    expect(fm.facts["age"]).toEqual({ type: "number", unit: "years" });
  });

  it("parses a patient", () => {
    const p = parsePatient(`
patient: SYN-042
facts:
  age: 63
  medications:
    - { code: warfarin, system: rxnorm, daysAgo: 5 }
`);
    expect(p.facts["age"]).toBe(63);
  });

  it("rejects oversized patient fact bags and code lists", () => {
    const facts = Object.fromEntries(Array.from({ length: PARSE_LIMITS.facts + 1 }, (_, i) => [`f${i}`, i]));
    expect(() => parsePatient(JSON.stringify({ patient: "P", facts }))).toThrow(/more than 10000 facts/);
    const codes = Array.from({ length: PARSE_LIMITS.codeEntries + 1 }, (_, i) => ({ code: String(i), system: "snomed" }));
    expect(() => parsePatient(JSON.stringify({ patient: "P", facts: { conditions: codes } }))).toThrow(/Too big|too big|10000/);
  });

  it("rejects documents above the explicit input-size boundary before parsing", () => {
    expect(() => parsePatient(" ".repeat(PARSE_LIMITS.documentChars + 1))).toThrow(/document exceeds/);
  });

  it("parses a test suite", () => {
    const s = parseTestSuite(`
cases:
  - name: adult passes age-min
    facts: { age: 40 }
    expect: { age-min: pass, overall: eligible }
`);
    expect(s.cases[0]!.expect["age-min"]).toBe("pass");
  });
});
