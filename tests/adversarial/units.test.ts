/**
 * Adversarial probes — units (attack surface 4).
 *
 * The lint used to warn only when the leaf HAD a `unit:` that differed from the
 * declared one, which made omitting `unit:` the quiet path and pointed the
 * incentive backwards. C1 is the regression for `unit-undeclared`.
 */
import { describe, it, expect } from "vitest";
import { checkRuleSet } from "../../src/core/conflicts.js";
import { evalPatient } from "../../src/core/evaluator.js";
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

describe("C1 — omitting `unit:` is warned about (REGRESSION: used to be the quiet path)", () => {
  it("`unit-undeclared` fires on the bare threshold, and names both units in play", () => {
    const rs = withUnit(undefined);
    const warn = checkRuleSet(rs, FM).filter((f) => f.code === "unit-undeclared");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.level).toBe("warning");
    expect(warn[0]!.criteria).toEqual(["uncontrolled-diabetes"]);
    expect(warn[0]!.message).toContain("mmol/L");
    expect(warn[0]!.message).toContain("compared as-is");

    const ev = evalPatient(rs, diabetic);
    // The verdict is still wrong — the lint is a diagnostic, not a converter —
    // but it is no longer silent, which is the whole point.
    expect(ev.results.find((r) => r.id === "uncontrolled-diabetes")!.verdict).toBe("pass");
    expect(ev.overall).toBe("eligible");
  });

  it("the honest form still gets `unit-mismatch`, and only that", () => {
    const rs = withUnit("mg/dL");
    const warn = checkRuleSet(rs, FM).filter((f) => f.level === "warning");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.code).toBe("unit-mismatch");
    // Same wrong verdict either way; only the diagnostic differs.
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

  it("both unit findings stay warnings, so `rules check` still exits 0", () => {
    expect(checkRuleSet(withUnit("mg/dL"), FM).filter((f) => f.level === "error")).toEqual([]);
    expect(checkRuleSet(withUnit(undefined), FM).filter((f) => f.level === "error")).toEqual([]);
  });
});

describe("C2 — the fact model's own unit is never enforced against patient data", () => {
  it("nothing validates that a patient file's numbers are in the declared unit", () => {
    // parsePatient takes bare numbers; there is no per-patient unit lint at all.
    // A corpus in mg/dL and a rule in mmol/L agree on the schema and disagree
    // on reality.
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
    expect(checkRuleSet(rs, FM).filter((f) => f.level !== "info")).toEqual([]); // rule is perfect
    // ...and the mg/dL patient is excluded on a value of 135 mmol/L, which is
    // not a survivable blood glucose.
    expect(evalPatient(rs, { patient: "MGDL", facts: { glucose: 135 } }).overall).toBe("ineligible");
  });
});
