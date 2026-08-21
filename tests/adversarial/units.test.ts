/**
 * Adversarial probes — units (attack surface 4).
 *
 * lint.ts:38 only warns when the leaf HAS a `unit:` and it differs from the
 * declared one. Omitting `unit:` is therefore the quiet path: the evaluator
 * still compares raw numbers, and nothing warns at any level.
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
    { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
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

describe("C1 — omitting `unit:` silences the only unit check there is", () => {
  it("no warning, and the diabetic patient is enrolled", () => {
    const rs = withUnit(undefined);
    expect(checkRuleSet(rs, FM).filter((f) => f.code === "unit-mismatch")).toEqual([]);
    expect(checkRuleSet(rs, FM).filter((f) => f.level !== "info")).toEqual([]);

    const ev = evalPatient(rs, diabetic);
    // BUG (clinically): 7.5 >= 126 is false, so the exclusion does not fire.
    expect(ev.results.find((r) => r.id === "uncontrolled-diabetes")!.verdict).toBe("pass");
    expect(ev.overall).toBe("eligible");
    // The trace prints the number with no unit anywhere, so the reviewer
    // reading it has nothing to notice.
    expect(ev.results.find((r) => r.id === "uncontrolled-diabetes")!.trace!.detail).toBe(
      "glucose = 7.5, required >= 126",
    );
  });

  it("declaring the unit honestly is the ONLY way to get the warning — the incentive is backwards", () => {
    const rs = withUnit("mg/dL");
    const warn = checkRuleSet(rs, FM).filter((f) => f.code === "unit-mismatch");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.level).toBe("warning");
    // Same wrong verdict either way; only the diagnostic differs.
    expect(evalPatient(rs, diabetic).overall).toBe("eligible");
  });

  it("even the honest form is a warning, so `rules check` still exits 0", () => {
    const findings = checkRuleSet(withUnit("mg/dL"), FM);
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
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
