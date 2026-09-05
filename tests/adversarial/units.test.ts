/**
 * Adversarial probes — units (attack surface 4).
 *
 * The lint used to warn only when the leaf HAD a `unit:` that differed from the
 * declared one, which made omitting `unit:` the quiet path and pointed the
 * incentive backwards. C1 is the regression for `unit-undeclared`.
 */
import { describe, it, expect } from "vitest";
import { checkRuleSet } from "../../src/core/conflicts.js";
import { evalPatientUnsafe as evalPatient, evalPatientChecked } from "../../src/core/evaluator.js";
import type { FactModel, RuleSet } from "../../src/core/schema.js";

// The classic pair. Glucose in mmol/L is ~1/18 of the mg/dL number.
const FM: FactModel = {
  name: "probe/v1",
  facts: {
    age: { type: "number", unit: "years" },
    glucose: { type: "number", unit: "mmol/L" },
  },
};

const withUnit = (unit?: string): RuleSet => ({
  ruleset: "glucose-probe",
  rulesetVersion: "1.0.0",
  factModel: "probe/v1",
  criteria: [
    { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18, unit: "years" } },
    {
      id: "uncontrolled-diabetes",
      kind: "exclusion",
      verbatim: "Fasting plasma glucose at or above 126 mg/dL",
      // The author transcribed the protocol's mg/dL number.
      when: { fact: "glucose", op: "gte", value: 126, ...(unit === undefined ? {} : { unit }) },
    },
  ],
});

// 7.5 mmol/L == 135 mg/dL: frankly diabetic, must be excluded.
const diabetic = { patient: "SYN-GLU", facts: { age: 62, glucose: 7.5 } };

describe("C1 — unsafe units block validation", () => {
  it("`unit-undeclared` is a hard error on a bare threshold", () => {
    const rs = withUnit(undefined);
    const finding = checkRuleSet(rs, FM).find((f) => f.code === "unit-undeclared")!;
    expect(finding.level).toBe("error");
    expect(finding.criteria).toEqual(["uncontrolled-diabetes"]);
    expect(finding.message).toContain("mmol/L");

    const ev = evalPatient(rs, diabetic);
    // The low-level evaluator is pure; checked entry points refuse this rule.
    expect(ev.results.find((r) => r.id === "uncontrolled-diabetes")!.verdict).toBe("pass");
    expect(ev.overall).toBe("eligible");
  });

  it("an explicit mismatch is also a hard error", () => {
    const rs = withUnit("mg/dL");
    const errors = checkRuleSet(rs, FM).filter((f) => f.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("unit-mismatch");
    expect(evalPatient(rs, diabetic).overall).toBe("eligible");
  });

  it("declaring the right unit is the only clean form", () => {
    const rs = withUnit("mmol/L");
    expect(checkRuleSet(rs, FM).filter((f) => f.level !== "info")).toEqual([]);
  });

  it("a unit-less fact declaration does not demand a unit on the leaf", () => {
    const noUnitModel: FactModel = { name: "probe/v1", facts: { hba1c_ratio: { type: "number" } } };
    const rs: RuleSet = {
      ruleset: "u",
      rulesetVersion: "1.0.0",
      factModel: "probe/v1",
      criteria: [{ id: "ratio", kind: "inclusion", verbatim: "v", when: { fact: "hba1c_ratio", op: "gte", value: 2 } }],
    };
    expect(checkRuleSet(rs, noUnitModel).filter((f) => f.level !== "info")).toEqual([]);
  });

  it("both unit findings prevent checked execution", () => {
    expect(checkRuleSet(withUnit("mg/dL"), FM).some((f) => f.level === "error")).toBe(true);
    expect(checkRuleSet(withUnit(undefined), FM).some((f) => f.level === "error")).toBe(true);
  });
});

describe("C2 — patient numbers use the fact model's canonical unit", () => {
  it("the checked boundary rejects unsafe rules before comparing canonical numbers", () => {
    const rs: RuleSet = {
      ruleset: "u",
      rulesetVersion: "1.0.0",
      factModel: "probe/v1",
      criteria: [
        {
          id: "uncontrolled-diabetes",
          kind: "exclusion",
          verbatim: "Fasting plasma glucose >= 7.0 mmol/L",
          when: { fact: "glucose", op: "gte", value: 7.0, unit: "mmol/L" },
        },
      ],
    };
    expect(checkRuleSet(rs, FM).filter((f) => f.level !== "info")).toEqual([]);
    expect(evalPatientChecked(rs, FM, { patient: "MMOL", facts: { glucose: 7.5 } }).overall).toBe("ineligible");

    const unsafe = withUnit("mg/dL");
    expect(() => evalPatientChecked(unsafe, FM, diabetic)).toThrow(/unit-mismatch/);
  });
});
