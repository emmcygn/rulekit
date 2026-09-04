import { describe, it, expect } from "vitest";
import { evalCondition, evalPatientChecked } from "../../src/core/evaluator.js";
import type { Condition, FactModel, PatientFacts, RuleSet } from "../../src/core/schema.js";

const patient = (facts: PatientFacts["facts"]): PatientFacts => ({ patient: "P1", facts });

describe("numeric leaves", () => {
  const geAdult: Condition = { fact: "age", op: "gte", value: 18 };
  it("compares present numbers", () => {
    expect(evalCondition(geAdult, patient({ age: 63 })).result).toBe("true");
    expect(evalCondition(geAdult, patient({ age: 12 })).result).toBe("false");
  });
  it("missing fact → unknown", () => {
    expect(evalCondition(geAdult, patient({})).result).toBe("unknown");
  });
  it("non-numeric value (string lab like \">60\") → unknown", () => {
    expect(evalCondition({ fact: "egfr", op: "gte", value: 30 }, patient({ egfr: ">60" })).result).toBe("unknown");
  });
  it("trace detail names the observed value and the requirement", () => {
    const t = evalCondition(geAdult, patient({ age: 12 }));
    expect(t.detail).toContain("age = 12");
    expect(t.detail).toContain(">= 18");
  });
});

describe("set and exists leaves", () => {
  const onAnticoag: Condition = { fact: "medications", op: "in", codes: { system: "rxnorm", values: ["warfarin"] } };
  it("in matches system+code", () => {
    expect(evalCondition(onAnticoag, patient({ medications: [{ code: "warfarin", system: "rxnorm" }] })).result).toBe("true");
    expect(evalCondition(onAnticoag, patient({ medications: [{ code: "warfarin", system: "atc" }] })).result).toBe("false");
  });
  it("in on missing fact → unknown; exists is presence-only", () => {
    expect(evalCondition(onAnticoag, patient({})).result).toBe("unknown");
    expect(evalCondition({ fact: "egfr", op: "exists" }, patient({})).result).toBe("unknown");
    expect(evalCondition({ fact: "egfr", op: "exists" }, patient({ egfr: 50 })).result).toBe("true");
  });
});

describe("scalar leaves", () => {
  it("compares enum strings and booleans", () => {
    expect(evalCondition({ fact: "sex", op: "eq", value: "female" }, patient({ sex: "female" })).result).toBe("true");
    expect(evalCondition({ fact: "consented", op: "neq", value: false }, patient({ consented: true })).result).toBe("true");
  });

  it("a runtime scalar type mismatch is unknown", () => {
    expect(evalCondition({ fact: "consented", op: "eq", value: true }, patient({ consented: "yes" })).result).toBe("unknown");
  });
});

describe("checked evaluation", () => {
  const fm: FactModel = { name: "patient/v1", facts: { age: { type: "number", unit: "years" } } };
  const rs: RuleSet = {
    ruleset: "r", rulesetVersion: "1.0.0", factModel: "patient/v1",
    criteria: [{ id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18, unit: "years" } }],
  };

  it("runs only after both sides of the fact-model contract validate", () => {
    expect(evalPatientChecked(rs, fm, patient({ age: 21 })).overall).toBe("eligible");
    expect(() => evalPatientChecked(rs, fm, patient({ age: "21" }))).toThrow(/invalid-patient-fact/);
    expect(() => evalPatientChecked({ ...rs, factModel: "other/v1" }, fm, patient({ age: 21 }))).toThrow(/fact-model-mismatch/);
  });
});

describe("anyWithin temporal leaf", () => {
  const washout: Condition = { fact: "medications", op: "anyWithin", codes: { system: "rxnorm", values: ["warfarin"] }, windowDays: 30 };
  it("inside window → true, outside → false", () => {
    expect(evalCondition(washout, patient({ medications: [{ code: "warfarin", system: "rxnorm", daysAgo: 21 }] })).result).toBe("true");
    expect(evalCondition(washout, patient({ medications: [{ code: "warfarin", system: "rxnorm", daysAgo: 90 }] })).result).toBe("false");
  });
  it("matching med with missing daysAgo → unknown; missing fact → unknown", () => {
    expect(evalCondition(washout, patient({ medications: [{ code: "warfarin", system: "rxnorm" }] })).result).toBe("unknown");
    expect(evalCondition(washout, patient({})).result).toBe("unknown");
  });
});

describe("combinators propagate Kleene results with child traces", () => {
  const cond: Condition = { all: [{ fact: "age", op: "gte", value: 18 }, { fact: "egfr", op: "gte", value: 30 }] };
  it("all(true, unknown) = unknown, children preserved", () => {
    const t = evalCondition(cond, patient({ age: 40 }));
    expect(t.result).toBe("unknown");
    expect(t.children).toHaveLength(2);
    expect(t.children![1]!.result).toBe("unknown");
  });
  it("not inverts, unknown stays", () => {
    expect(evalCondition({ not: { fact: "age", op: "gte", value: 18 } }, patient({ age: 40 })).result).toBe("false");
    expect(evalCondition({ not: { fact: "age", op: "gte", value: 18 } }, patient({})).result).toBe("unknown");
  });
});
