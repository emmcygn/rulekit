/**
 * Adversarial probes — Kleene edge interactions (attack surface 1).
 *
 * These tests pin the repaired engine behavior and retain one explicit
 * closed-world-list limitation so its clinical interpretation stays visible.
 */
import { describe, it, expect } from "vitest";
import { evalCondition, evalPatientUnsafe as evalPatient } from "../../src/core/evaluator.js";
import { lintRuleSet } from "../../src/core/lint.js";
import { parseRuleSet, type Condition, type PatientFacts, type RuleSet, type FactModel } from "../../src/core/schema.js";

const patient = (facts: PatientFacts["facts"], name = "P"): PatientFacts => ({ patient: name, facts });

const FM: FactModel = {
  name: "probe/v1",
  facts: {
    age: { type: "number", unit: "years" },
    egfr: { type: "number", unit: "mL/min/1.73m2" },
    on_anticoagulant: { type: "boolean" },
    conditions: { type: "code", systems: ["snomed"] },
    medications: { type: "code", systems: ["rxnorm"] },
  },
};

describe("A1 — `exists` preserves uncertainty for missing data", () => {
  // Spec §5, verbatim: "a leaf condition over a missing fact evaluates `unknown`."
  // The guard idiom below must not turn an unmeasured renal fact into an
  // eligible outcome.
  const rs: RuleSet = {
    ruleset: "renal-guard",
    rulesetVersion: "1.0.0",
    factModel: "probe/v1",
    criteria: [
      { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
      {
        id: "severe-renal-impairment",
        kind: "exclusion",
        verbatim: "eGFR < 30 mL/min/1.73m2",
        // The "guard" idiom: only fire when we actually have the lab.
        when: { all: [{ fact: "egfr", op: "exists" }, { fact: "egfr", op: "lt", value: 30 }] },
      },
    ],
  };

  it("missing eGFR yields `undetermined`, never eligible", () => {
    const noLab = evalPatient(rs, patient({ age: 70 }, "NO-EGFR"));
    expect(noLab.results.find((r) => r.id === "severe-renal-impairment")!.verdict).toBe("unknown");
    expect(noLab.overall).toBe("undetermined");

    // Drop the guard and the same patient is correctly undetermined.
    const unguarded: RuleSet = {
      ...rs,
      criteria: [rs.criteria[0]!, { ...rs.criteria[1]!, when: { fact: "egfr", op: "lt", value: 30 } }],
    };
    expect(evalPatient(unguarded, patient({ age: 70 }, "NO-EGFR")).overall).toBe("undetermined");
  });

  it("the blanket missing-fact rule applies to exists too", () => {
    expect(evalCondition({ fact: "egfr", op: "exists" }, patient({})).result).toBe("unknown");
    expect(evalCondition({ fact: "egfr", op: "lt", value: 30 }, patient({})).result).toBe("unknown");
  });
});

describe("A2 — `exists` cannot masquerade as boolean equality", () => {
  // Presence is not boolean truth; lint must force authors to say `eq: true`.
  const rs: RuleSet = {
    ruleset: "exists-lint",
    rulesetVersion: "1.0.0",
    factModel: "probe/v1",
    criteria: [
      {
        id: "on-anticoagulant",
        kind: "exclusion",
        verbatim: "Currently on an oral anticoagulant",
        when: { fact: "on_anticoagulant", op: "exists" },
      },
    ],
  };

  it("lint blocks exists on a boolean and eq true expresses the intended rule", () => {
    expect(lintRuleSet(rs, FM).find((f) => f.code === "exists-value-type")?.level).toBe("error");
    const corrected: RuleSet = { ...rs, criteria: [{ ...rs.criteria[0]!, when: { fact: "on_anticoagulant", op: "eq", value: true } }] };
    expect(lintRuleSet(corrected, FM)).toEqual([]);
    const p = evalPatient(corrected, patient({ on_anticoagulant: false }, "NOT-ON-DOAC"));
    expect(p.results[0]!.verdict).toBe("pass");
    expect(p.overall).toBe("eligible");
  });
});

describe("A3 — closed-world code lists: an empty list is treated as proof of absence", () => {
  const afib: Condition = { fact: "conditions", op: "in", codes: { system: "snomed", values: ["49436004"] } };

  it("`conditions: []` → definite `false`; missing `conditions` → `unknown`", () => {
    expect(evalCondition(afib, patient({ conditions: [] })).result).toBe("false");
    expect(evalCondition(afib, patient({})).result).toBe("unknown");
  });

  it("so an extract that emitted an empty problem list buys `eligible`", () => {
    const rs: RuleSet = {
      ruleset: "afib-excl",
      rulesetVersion: "1.0.0",
      factModel: "probe/v1",
      criteria: [
        { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
        { id: "afib", kind: "exclusion", verbatim: "Atrial fibrillation", when: afib },
      ],
    };
    // MISLEADS: "we pulled no conditions for this patient" and "this patient
    // has no conditions" are the same input to the engine.
    expect(evalPatient(rs, patient({ age: 70, conditions: [] }, "EMPTY-LIST")).overall).toBe("eligible");
    expect(evalPatient(rs, patient({ age: 70 }, "NO-LIST")).overall).toBe("undetermined");
  });
});

describe("A4 — not/any/anyWithin nesting (engine held)", () => {
  const washout: Condition = {
    fact: "medications",
    op: "anyWithin",
    codes: { system: "rxnorm", values: ["855332"] },
    windowDays: 90,
  };

  it("not(anyWithin) over an undated matching entry stays unknown", () => {
    const undated = patient({ medications: [{ code: "855332", system: "rxnorm" }] });
    expect(evalCondition(washout, undated).result).toBe("unknown");
    expect(evalCondition({ not: washout }, undated).result).toBe("unknown");
  });

  it("any(not(unknown), true) = true and any(not(unknown), false) = unknown", () => {
    const noEgfr = patient({ age: 70 });
    const notUnknown: Condition = { not: { fact: "egfr", op: "lt", value: 30 } };
    expect(evalCondition({ any: [notUnknown, { fact: "age", op: "gte", value: 18 }] }, noEgfr).result).toBe("true");
    expect(evalCondition({ any: [notUnknown, { fact: "age", op: "gte", value: 99 }] }, noEgfr).result).toBe("unknown");
  });

  it("De Morgan holds through unknown: not(all(x, unknown)) === any(not x, unknown)", () => {
    const p = patient({ age: 70 });
    const x: Condition = { fact: "age", op: "gte", value: 18 };
    const u: Condition = { fact: "egfr", op: "lt", value: 30 };
    expect(evalCondition({ not: { all: [x, u] } }, p).result).toBe(
      evalCondition({ any: [{ not: x }, { not: u }] }, p).result,
    );
  });

  it("a fired exclusion beats an unknown inclusion — ineligible, not undetermined", () => {
    const rs: RuleSet = {
      ruleset: "precedence",
      rulesetVersion: "1.0.0",
      factModel: "probe/v1",
      criteria: [
        { id: "renal", kind: "inclusion", verbatim: "eGFR >= 30", when: { fact: "egfr", op: "gte", value: 30 } },
        { id: "afib", kind: "exclusion", verbatim: "AFib", when: { fact: "conditions", op: "in", codes: { system: "snomed", values: ["49436004"] } } },
      ],
    };
    const p = patient({ conditions: [{ code: "49436004", system: "snomed" }] }, "AFIB-NO-EGFR");
    expect(evalPatient(rs, p).overall).toBe("ineligible");
  });
});

describe("A5 — anyWithin window arithmetic", () => {
  const mk = (windowDays: number): Condition => ({
    fact: "medications",
    op: "anyWithin",
    codes: { system: "rxnorm", values: ["855332"] },
    windowDays,
  });

  it("daysAgo === windowDays is inside the window (inclusive)", () => {
    expect(evalCondition(mk(90), patient({ medications: [{ code: "855332", system: "rxnorm", daysAgo: 90 }] })).result).toBe("true");
    expect(evalCondition(mk(90), patient({ medications: [{ code: "855332", system: "rxnorm", daysAgo: 91 }] })).result).toBe("false");
  });

  it("same code twice — one inside, one outside — is true (most recent wins)", () => {
    const p = patient({ medications: [
      { code: "855332", system: "rxnorm", daysAgo: 400 },
      { code: "855332", system: "rxnorm", daysAgo: 5 },
    ] });
    expect(evalCondition(mk(90), p).result).toBe("true");
  });

  it("all dated matches outside the window + one undated match → unknown (correctly conservative)", () => {
    const p = patient({ medications: [
      { code: "855332", system: "rxnorm", daysAgo: 400 },
      { code: "855332", system: "rxnorm" },
    ] });
    expect(evalCondition(mk(90), p).result).toBe("unknown");
  });

  it("a same-system match inside the window is unaffected by an undated match — no unknown leak", () => {
    const p = patient({ medications: [
      { code: "855332", system: "rxnorm" },
      { code: "855332", system: "rxnorm", daysAgo: 3 },
    ] });
    expect(evalCondition(mk(90), p).result).toBe("true");
  });

  it("windowDays: 0 expresses an event administered today", () => {
    const yaml = `
ruleset: w0
rulesetVersion: 1.0.0
factModel: probe/v1
criteria:
  - id: today-only
    kind: exclusion
    verbatim: "IV inotropes today"
    when: { fact: medications, op: anyWithin, codes: { system: rxnorm, values: ["855332"] }, windowDays: 0 }
`;
    expect(() => parseRuleSet(yaml)).not.toThrow();
  });
});
