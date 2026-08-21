import { describe, expect, it } from "vitest";
import { realEngine } from "../src/engine/real.js";
import {
  DEMO_COHORT,
  DEMO_FACT_MODEL,
  DEMO_RULESET_CURRENT,
  DEMO_RULESET_PRIOR,
} from "../src/data/index.js";

const patient = (id: string) => DEMO_COHORT.find((p) => p.patient === id)!;
const evaluate = (id: string) => realEngine.evalPatient(DEMO_RULESET_CURRENT, patient(id));
const verdict = (id: string, criterion: string) =>
  evaluate(id).results.find((r) => r.id === criterion)!;

describe("realEngine.evalPatient", () => {
  it("never turns missing data into a verdict", () => {
    // SYN-042 has no `medications` fact at all: the list never arrived.
    const r = verdict("SYN-042", "anticoag-washout");
    expect(r.verdict).toBe("unknown");
    expect(r.trace?.detail).toContain("missing");
  });

  it("treats a non-numeric lab value as not evaluable rather than guessing", () => {
    const messy = { patient: "SYN-999", facts: { age: 69, lvef: 39, egfr: ">60" } };
    const results = realEngine.evalPatient(DEMO_RULESET_CURRENT, messy).results;
    const at = (id: string) => results.find((r) => r.id === id)!;
    expect(at("egfr-min").verdict).toBe("unknown");
    expect(at("renal-safety").verdict).toBe("unknown");
    expect(at("renal-safety").trace?.detail).toContain("non-numeric");
  });

  it("fires an exclusion into a fail and traces the comparison", () => {
    const r = verdict("SYN-042", "renal-safety");
    expect(r.verdict).toBe("fail");
    expect(r.trace?.detail).toBe("egfr = 41, required < 45");
    expect(r.trace?.observed).toBe(41);
  });

  it("holds boundary values inside the criteria", () => {
    const edge = { patient: "SYN-998", facts: { age: 18, lvef: 40, egfr: 45, medications: [] } };
    const results = realEngine.evalPatient(DEMO_RULESET_CURRENT, edge).results;
    const at = (id: string) => results.find((r) => r.id === id)!.verdict;
    expect(at("age-min")).toBe("pass"); // age = 18, rule is >= 18
    expect(at("lvef-max")).toBe("pass"); // lvef = 40, rule is <= 40
    expect(at("renal-safety")).toBe("pass"); // egfr = 45, exclusion is strict < 45
  });

  it("keeps an unmodeled criterion unknown for everyone", () => {
    const r = verdict("SYN-061", "nyha-class-iv");
    expect(r.unmodeled).toBe(true);
    expect(r.verdict).toBe("unknown");
    // Core reports no trace for an unmodeled criterion; the views must not need one.
    expect(r.trace).toBeUndefined();
    expect(evaluate("SYN-061").overall).toBe("undetermined");
  });

  it("reads a temporal window against the recorded recency", () => {
    expect(verdict("SYN-088", "anticoag-washout").verdict).toBe("fail"); // 21d, window 30d
    expect(verdict("SYN-104", "anticoag-washout").verdict).toBe("pass"); // 200d ago
  });

  it("calls a matching medication with no date unknown, not outside the window", () => {
    const undated = {
      patient: "SYN-997",
      facts: {
        age: 40,
        lvef: 34,
        egfr: 60,
        medications: [{ code: "anticoagulants", system: "rxnorm-class" }],
      },
    };
    const r = realEngine
      .evalPatient(DEMO_RULESET_CURRENT, undated)
      .results.find((x) => x.id === "anticoag-washout")!;
    expect(r.verdict).toBe("unknown");
  });

  it("agrees with the funnel story on the whole fixture cohort", () => {
    const overall = DEMO_COHORT.map((p) => realEngine.evalPatient(DEMO_RULESET_CURRENT, p).overall);
    expect(overall.filter((o) => o === "ineligible")).toHaveLength(7);
    expect(overall.filter((o) => o === "undetermined")).toHaveLength(3);
    expect(overall.filter((o) => o === "eligible")).toHaveLength(0);
  });
});

describe("realEngine.check", () => {
  const findings = realEngine.check(DEMO_RULESET_CURRENT, DEMO_FACT_MODEL);

  it("reports exactly the seeded conflict, the unit warning and the honesty ledger", () => {
    expect(findings.map((f) => [f.level, f.code])).toEqual([
      ["error", "contradictory-band"],
      ["warning", "unit-mismatch"],
      ["info", "unmodeled-criterion"],
    ]);
  });

  it("catches the seeded contradictory band with the interval evidence", () => {
    const conflict = findings.find((f) => f.code === "contradictory-band")!;
    expect(conflict.level).toBe("error");
    expect(conflict.criteria).toEqual(["egfr-min", "renal-safety"]);
    // Exact characters matter: the checks panel renders this string verbatim.
    expect(conflict.evidence).toBe(
      "egfr: inclusion admits [30, ∞) ∩ exclusion fires (−∞, 45) → contradictory band [30, 45)",
    );
  });

  it("warns when a rule's unit is not the fact model's unit", () => {
    const unit = findings.find((f) => f.code === "unit-mismatch")!;
    expect(unit.level).toBe("warning");
    expect(unit.criteria).toEqual(["egfr-min"]);
  });

  it("records unmodeled criteria as info, not as silence", () => {
    const info = findings.find((f) => f.code === "unmodeled-criterion")!;
    expect(info.criteria).toEqual(["nyha-class-iv"]);
  });

  it("finds no conflict in the pre-amendment rule set", () => {
    const prior = realEngine.check(DEMO_RULESET_PRIOR, DEMO_FACT_MODEL);
    expect(prior.filter((f) => f.level === "error")).toEqual([]);
  });

  it("sorts errors before warnings before info", () => {
    const rank = { error: 0, warning: 1, info: 2 };
    const levels = findings.map((f) => rank[f.level]);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("reports a malformed rule set as one schema error instead of throwing", () => {
    const bad = realEngine.check("ruleset: x\ncriteria: []\n", DEMO_FACT_MODEL);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.code).toBe("schema");
    expect(bad[0]!.level).toBe("error");
  });

  it("still runs the conflict pass when the fact model does not parse", () => {
    const codes = realEngine.check(DEMO_RULESET_CURRENT, "name: 1\n").map((f) => f.code);
    expect(codes).toContain("contradictory-band");
    expect(codes).toContain("fact-model-schema");
  });

  it("flags a rule that references a fact the model does not declare", () => {
    const bad = DEMO_RULESET_CURRENT.replace("fact: lvef, op: lte", "fact: ejection_fraction, op: lte");
    expect(realEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "unknown-fact")).toBe(true);
  });

  it("flags a numeric comparison against a non-numeric fact", () => {
    const bad = DEMO_RULESET_CURRENT.replace("fact: age, op: gte", "fact: sex, op: gte");
    expect(realEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "type-mismatch")).toBe(true);
  });

  it("flags a code system the fact model does not declare", () => {
    const bad = DEMO_RULESET_CURRENT.replace("system: rxnorm-class", "system: local-formulary");
    expect(
      realEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "unknown-code-system"),
    ).toBe(true);
  });

  it("flags a criterion that can never fire", () => {
    const bad = DEMO_RULESET_CURRENT.replace(
      "when: { fact: age, op: gte, value: 18 }",
      "when:\n      all:\n        - { fact: age, op: gte, value: 65 }\n        - { fact: age, op: lte, value: 40 }",
    );
    expect(
      realEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "unsatisfiable-criterion"),
    ).toBe(true);
  });
});

describe("realEngine.behavioralDiff", () => {
  const flips = realEngine.behavioralDiff(DEMO_RULESET_PRIOR, DEMO_RULESET_CURRENT, DEMO_COHORT);

  it("finds the fixtures the amendment flips", () => {
    expect(flips.map((f) => f.patient).sort()).toEqual([
      "SYN-007",
      "SYN-019",
      "SYN-042",
      "SYN-058",
      "SYN-088",
    ]);
    expect(flips.every((f) => f.to === "ineligible")).toBe(true);
  });

  it("names the criterion whose verdict changed", () => {
    expect(flips.find((f) => f.patient === "SYN-088")!.responsible).toEqual(["anticoag-washout"]);
    expect(flips.find((f) => f.patient === "SYN-007")!.responsible).toEqual(["renal-safety"]);
  });
});
