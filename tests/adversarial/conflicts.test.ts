/**
 * Adversarial probes — static conflict / interval analysis (attack surface 3).
 *
 * The headline claim these findings attack is the one in the messages
 * themselves: "for all inputs, not just a test corpus". Two directions:
 *   - the analysis asserting something that is provably false (B1);
 *   - the analysis staying silent on a contradiction while `rules check`
 *     prints "0 conflict(s)" (B3, B4, B5).
 */
import { describe, it, expect } from "vitest";
import { detectConflicts, checkRuleSet } from "../../src/core/conflicts.js";
import { evalPatientUnsafe as evalPatient } from "../../src/core/evaluator.js";
import type { Criterion, FactModel, RuleSet } from "../../src/core/schema.js";

const FM: FactModel = {
  name: "probe/v1",
  facts: {
    age: { type: "number" },
    egfr: { type: "number" },
    lvef: { type: "number" },
    index_hospital_days: { type: "number" },
  },
};

const rs = (...criteria: Criterion[]): RuleSet => ({
  ruleset: "probe",
  rulesetVersion: "1.0.0",
  factModel: "probe/v1",
  criteria,
});

describe("B1 — a multi-fact exclusion is skipped from band analysis (REGRESSION: was a FALSE claim)", () => {
  const set = rs(
    { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
    {
      id: "frail-long-stay",
      kind: "exclusion",
      verbatim: "Age over 80 AND index hospitalisation longer than 21 days",
      when: { all: [{ fact: "age", op: "gt", value: 80 }, { fact: "index_hospital_days", op: "gt", value: 21 }] },
    },
  );

  it("makes no band claim: firing needs every conjunct, so 'for all inputs' cannot be shown", () => {
    expect(detectConflicts(set).filter((f) => f.level === "error")).toEqual([]);
  });

  it("the counterexample the old claim could not survive is now consistent with the analysis", () => {
    // 85 years old, in the interval the old message named, three-day index stay.
    const p = { patient: "COUNTEREXAMPLE", facts: { age: 85, index_hospital_days: 3 } };
    const ev = evalPatient(set, p);
    expect(ev.results.find((r) => r.id === "frail-long-stay")!.verdict).toBe("pass");
    expect(ev.overall).toBe("eligible");
  });

  it("`rules check` exits 0 on this rule set — it has no defect", () => {
    expect(checkRuleSet(set, FM).filter((f) => f.level === "error")).toEqual([]);
  });

  it("a non-interval conjunct disables the band claim for the same reason", () => {
    const withCode = rs(
      { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
      {
        id: "frail-with-afib",
        kind: "exclusion",
        verbatim: "Age over 80 AND atrial fibrillation",
        when: {
          all: [
            { fact: "age", op: "gt", value: 80 },
            { fact: "conditions", op: "in", codes: { system: "snomed", values: ["49436004"] } },
          ],
        },
      },
    );
    expect(detectConflicts(withCode).filter((f) => f.code === "contradictory-band")).toEqual([]);
    // ...and the evaluator agrees: an 85-year-old with no afib passes.
    expect(evalPatient(withCode, { patient: "NO-AFIB", facts: { age: 85, conditions: [] } }).overall).toBe("eligible");
  });
});

describe("B2 — neq leaves close a degenerate interval (REGRESSION: were dropped from analysis)", () => {
  it("a criterion that can never fire is reported as unsatisfiable", () => {
    const set = rs({
      id: "impossible-lvef",
      kind: "inclusion",
      verbatim: "LVEF exactly 40 and not 40",
      when: {
        all: [
          { fact: "lvef", op: "gte", value: 40 },
          { fact: "lvef", op: "lte", value: 40 },
          { fact: "lvef", op: "neq", value: 40 },
        ],
      },
    });
    const f = detectConflicts(set).find((x) => x.code === "unsatisfiable-criterion")!;
    expect(f.level).toBe("error");
    expect(f.criteria).toEqual(["impossible-lvef"]);
    expect(f.evidence).toContain("lvef");
    expect(evalPatient(set, { patient: "P", facts: { lvef: 40 } }).overall).toBe("ineligible");
  });

  it("two inclusions that admit nobody are reported as contradictory-inclusions", () => {
    const set = rs(
      { id: "lvef-exactly-40", kind: "inclusion", verbatim: "LVEF = 40", when: { fact: "lvef", op: "eq", value: 40 } },
      { id: "lvef-not-40", kind: "inclusion", verbatim: "LVEF != 40", when: { fact: "lvef", op: "neq", value: 40 } },
    );
    const errors = checkRuleSet(set, FM).filter((f) => f.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("contradictory-inclusions");
    expect(errors[0]!.criteria.sort()).toEqual(["lvef-exactly-40", "lvef-not-40"]);
    for (const v of [39, 40, 41]) {
      expect(evalPatient(set, { patient: `P${v}`, facts: { lvef: v } }).overall).toBe("ineligible");
    }
  });

  it("a neq that does not close the admitted interval reports only analysis scope", () => {
    const set = rs(
      { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
      { id: "not-fifty", kind: "inclusion", verbatim: "Age != 50", when: { fact: "age", op: "neq", value: 50 } },
    );
    const findings = detectConflicts(set);
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    expect(findings.find((f) => f.code === "analysis-incomplete")).toBeDefined();
  });
});

describe("B3 — opaque branches do not hide necessary sibling contradictions", () => {
  it("an unsatisfiable all-chain remains reported when an unrelated `any` is added", () => {
    const contradiction: Criterion = {
      id: "age-band",
      kind: "inclusion",
      verbatim: "Aged 18 to 10",
      when: { all: [{ fact: "age", op: "gte", value: 18 }, { fact: "age", op: "lte", value: 10 }] },
    };
    expect(detectConflicts(rs(contradiction))[0]!.code).toBe("unsatisfiable-criterion");

    const withAny: Criterion = {
      ...contradiction,
      when: {
        all: [
          { fact: "age", op: "gte", value: 18 },
          { fact: "age", op: "lte", value: 10 },
          { any: [{ fact: "lvef", op: "lte", value: 40 }, { fact: "egfr", op: "gte", value: 30 }] },
        ],
      },
    };
    expect(detectConflicts(rs(withAny)).some((f) => f.code === "unsatisfiable-criterion")).toBe(true);
  });

  it("unsupported disjunction is labeled as incomplete rather than silently certified", () => {
    const set = rs({
      id: "impossible-any",
      kind: "inclusion",
      verbatim: "Aged over 130 or under -5",
      when: { any: [{ fact: "age", op: "gte", value: 130 }, { fact: "age", op: "lte", value: -5 }] },
    });
    const findings = checkRuleSet(set, FM);
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    expect(findings.some((f) => f.code === "analysis-incomplete")).toBe(true);
  });
});

describe("B4 — contradictory-inclusions attribution", () => {
  it("names every inclusion touching the fact, including innocent ones", () => {
    const set = rs(
      { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
      { id: "paediatric", kind: "inclusion", verbatim: "Age <= 10", when: { fact: "age", op: "lte", value: 10 } },
      { id: "not-a-neonate", kind: "inclusion", verbatim: "Age >= 5", when: { fact: "age", op: "gte", value: 5 } },
    );
    const f = detectConflicts(set).find((x) => x.code === "contradictory-inclusions")!;
    // The real contradiction is adult ∩ paediatric. `not-a-neonate` is
    // consistent with both and is blamed anyway.
    expect(f.criteria).toEqual(["adult", "paediatric"]);
    expect(f.message).not.toContain('"not-a-neonate"');
  });

  it("exactly two contributors reads correctly", () => {
    const set = rs(
      { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
      { id: "paediatric", kind: "inclusion", verbatim: "Age <= 10", when: { fact: "age", op: "lte", value: 10 } },
    );
    expect(detectConflicts(set).find((x) => x.code === "contradictory-inclusions")!.criteria).toEqual(["adult", "paediatric"]);
  });
});

describe("B5 — boundary arithmetic the engine gets right (attacks that failed)", () => {
  const band = (incl: Criterion["when"], excl: Criterion["when"]) =>
    detectConflicts(rs(
      { id: "incl", kind: "inclusion", verbatim: "i", when: incl },
      { id: "excl", kind: "exclusion", verbatim: "e", when: excl },
    )).filter((f) => f.code === "unsatisfiable-ruleset");

  it("inclusion eq 45 vs exclusion lt 45 → no band (touching, half-open)", () => {
    expect(band({ fact: "egfr", op: "eq", value: 45 }, { fact: "egfr", op: "lt", value: 45 })).toEqual([]);
  });

  it("inclusion gte 60 vs exclusion lt 60 → no band", () => {
    expect(band({ fact: "egfr", op: "gte", value: 60 }, { fact: "egfr", op: "lt", value: 60 })).toEqual([]);
  });

  it("inclusion lte 65 vs exclusion gte 65 is only a partial overlap", () => {
    const f = band({ fact: "age", op: "lte", value: 65 }, { fact: "age", op: "gte", value: 65 });
    expect(f).toHaveLength(0);
    expect(evalPatient(rs(
      { id: "incl", kind: "inclusion", verbatim: "i", when: { fact: "age", op: "lte", value: 65 } },
      { id: "excl", kind: "exclusion", verbatim: "e", when: { fact: "age", op: "gte", value: 65 } },
    ), { patient: "P65", facts: { age: 65 } }).overall).toBe("ineligible");
  });

  it("a normal upper-age exclusion is not a release-blocking contradiction", () => {
    const f = band({ fact: "age", op: "gte", value: 18 }, { fact: "age", op: "gt", value: 80 });
    expect(f).toHaveLength(0);
  });

  it("an exclusion covering the whole admitted interval is a contradiction", () => {
    const f = band({ fact: "age", op: "gte", value: 18 }, { fact: "age", op: "gte", value: 18 });
    expect(f).toHaveLength(1);
  });
});
