import { describe, it, expect } from "vitest";
import { evalPatient, evalCriterion } from "../../src/core/evaluator.js";
import { parseRuleSet } from "../../src/core/schema.js";

const RS = parseRuleSet(`
ruleset: r
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - { id: age-min, kind: inclusion, verbatim: "Age >= 18", when: { fact: age, op: gte, value: 18 } }
  - { id: anticoag-washout, kind: exclusion, verbatim: "Anticoagulant within 30d", when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: [warfarin] }, windowDays: 30 } }
  - { id: nyha-class-iv, kind: exclusion, verbatim: "NYHA IV", unmodeled: true }
`);

describe("criterion orientation (spec §7 example)", () => {
  it("64yo on warfarin: age-min pass, washout FAIL (exclusion fired), overall ineligible", () => {
    const e = evalPatient(RS, { patient: "P", facts: { age: 64, medications: [{ code: "warfarin", system: "rxnorm", daysAgo: 5 }] } });
    const byId = Object.fromEntries(e.results.map((r) => [r.id, r.verdict]));
    expect(byId["age-min"]).toBe("pass");
    expect(byId["anticoag-washout"]).toBe("fail");
    expect(e.overall).toBe("ineligible");
  });

  it("exclusion condition false → verdict pass", () => {
    const r = evalCriterion(RS.criteria[1]!, { patient: "P", facts: { medications: [] } });
    expect(r.verdict).toBe("pass");
  });

  it("unmodeled criterion → verdict unknown, no trace", () => {
    const r = evalCriterion(RS.criteria[2]!, { patient: "P", facts: {} });
    expect(r.verdict).toBe("unknown");
    expect(r.unmodeled).toBe(true);
    expect(r.trace).toBeUndefined();
  });

  it("overall: no fail + some unknown → undetermined; all pass on modeled + unmodeled present → undetermined", () => {
    const e = evalPatient(RS, { patient: "P", facts: { age: 40, medications: [] } });
    expect(e.overall).toBe("undetermined"); // nyha-class-iv is unknown
  });

  it("fail beats unknown: ineligible even when other criteria unknown", () => {
    const e = evalPatient(RS, { patient: "P", facts: { age: 12 } });
    expect(e.overall).toBe("ineligible");
  });
});
