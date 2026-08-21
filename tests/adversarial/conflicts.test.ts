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
import { evalPatient } from "../../src/core/evaluator.js";
import type { Criterion, FactModel, RuleSet } from "../../src/core/schema.js";

const FM: FactModel = {
  name: "probe/v1",
  facts: {
    age: { type: "number", unit: "years" },
    egfr: { type: "number", unit: "mL/min/1.73m2" },
    lvef: { type: "number", unit: "%" },
    index_hospital_days: { type: "number", unit: "days" },
  },
};

const rs = (...criteria: Criterion[]): RuleSet => ({
  ruleset: "probe",
  rulesetVersion: "1.0.0",
  factModel: "probe/v1",
  criteria,
});

describe("B1 — contradictory-band is per-fact, so a multi-fact exclusion produces a FALSE claim", () => {
  const set = rs(
    { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } },
    {
      id: "frail-long-stay",
      kind: "exclusion",
      verbatim: "Age over 80 AND index hospitalisation longer than 21 days",
      when: { all: [{ fact: "age", op: "gt", value: 80 }, { fact: "index_hospital_days", op: "gt", value: 21 }] },
    },
  );

  it("reports an error claiming every patient over 80 is excluded", () => {
    const found = detectConflicts(set);
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe("contradictory-band");
    expect(found[0]!.message).toContain("every patient with age in (80, ∞) passes inclusion and is then excluded");
    expect(found[0]!.message).toContain("for all inputs, not just a test corpus");
  });

  it("...and the evaluator disproves it on the first patient you try", () => {
    // 85 years old, in the reported band, three-day index stay.
    const p = { patient: "COUNTEREXAMPLE", facts: { age: 85, index_hospital_days: 3 } };
    const ev = evalPatient(set, p);
    expect(ev.results.find((r) => r.id === "frail-long-stay")!.verdict).toBe("pass");
    // BUG: the static analysis said this is impossible "for all inputs".
    expect(ev.overall).toBe("eligible");
  });

  it("`rules check` would exit non-zero on a rule set with no defect", () => {
    expect(checkRuleSet(set, FM).filter((f) => f.level === "error")).toHaveLength(1);
  });
});

describe("B2 — neq leaves are dropped from interval analysis, hiding real contradictions", () => {
  it("a criterion that can never fire is reported as clean", () => {
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
    // BUG: interval analysis sees [40, 40] and stops; `neq` is not in INTERVAL_OPS.
    expect(detectConflicts(set)).toEqual([]);
    expect(evalPatient(set, { patient: "P", facts: { lvef: 40 } }).overall).toBe("ineligible");
  });

  it("two inclusions that admit nobody are reported as clean when one uses neq", () => {
    const set = rs(
      { id: "lvef-exactly-40", kind: "inclusion", verbatim: "LVEF = 40", when: { fact: "lvef", op: "eq", value: 40 } },
      { id: "lvef-not-40", kind: "inclusion", verbatim: "LVEF != 40", when: { fact: "lvef", op: "neq", value: 40 } },
    );
    // BUG: this rule set admits literally nobody and `check` says so nowhere.
    expect(checkRuleSet(set, FM).filter((f) => f.level === "error")).toEqual([]);
    for (const v of [39, 40, 41]) {
      expect(evalPatient(set, { patient: `P${v}`, facts: { lvef: v } }).overall).toBe("ineligible");
    }
  });
});

describe("B3 — any/not anywhere in a criterion disables ALL analysis of that criterion", () => {
  it("an unsatisfiable all-chain goes unreported once an unrelated `any` is added", () => {
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
    // BUG: adding a clause that cannot possibly repair the contradiction
    // silences the diagnostic. allChainLeaves() returns null for the whole tree.
    expect(detectConflicts(rs(withAny))).toEqual([]);
  });

  it("a rule set that admits nobody prints '0 conflict(s), 0 warning(s)'", () => {
    const set = rs({
      id: "impossible-any",
      kind: "inclusion",
      verbatim: "Aged over 130 or under -5",
      when: { any: [{ fact: "age", op: "gte", value: 130 }, { fact: "age", op: "lte", value: -5 }] },
    });
    const findings = checkRuleSet(set, FM);
    // MISLEADS: `rules check` prints exactly "0 conflict(s), 0 warning(s)" and
    // exits 0. Nothing in the output says the analysis declined to look.
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    expect(findings.filter((f) => f.level === "warning")).toEqual([]);
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
    expect(f.criteria).toEqual(["adult", "paediatric", "not-a-neonate"]);
    expect(f.message).toContain('"not-a-neonate"');
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
    )).filter((f) => f.code === "contradictory-band");

  it("inclusion eq 45 vs exclusion lt 45 → no band (touching, half-open)", () => {
    expect(band({ fact: "egfr", op: "eq", value: 45 }, { fact: "egfr", op: "lt", value: 45 })).toEqual([]);
  });

  it("inclusion gte 60 vs exclusion lt 60 → no band", () => {
    expect(band({ fact: "egfr", op: "gte", value: 60 }, { fact: "egfr", op: "lt", value: 60 })).toEqual([]);
  });

  it("inclusion lte 65 vs exclusion gte 65 → a real one-point band at 65", () => {
    const f = band({ fact: "age", op: "lte", value: 65 }, { fact: "age", op: "gte", value: 65 });
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence).toContain("[65, 65]");
    expect(evalPatient(rs(
      { id: "incl", kind: "inclusion", verbatim: "i", when: { fact: "age", op: "lte", value: 65 } },
      { id: "excl", kind: "exclusion", verbatim: "e", when: { fact: "age", op: "gte", value: 65 } },
    ), { patient: "P65", facts: { age: 65 } }).overall).toBe("ineligible");
  });

  it("an exclusion overlapping an inclusion on ONE fact is a real, reachable band", () => {
    // Reported as an error even though 'adults, but not the very old' is a
    // normal protocol shape. Noted as a design wart, not a wrong answer:
    // every patient in the band really is admitted then excluded.
    const f = band({ fact: "age", op: "gte", value: 18 }, { fact: "age", op: "gt", value: 80 });
    expect(f).toHaveLength(1);
  });
});
