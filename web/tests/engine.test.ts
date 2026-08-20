import { describe, expect, it } from "vitest";
import { mockEngine } from "../src/engine/mock.js";
import { DEMO_COHORT, DEMO_FACT_MODEL, DEMO_RULESET_CURRENT } from "../src/data/index.js";

const patient = (id: string) => DEMO_COHORT.find((p) => p.patient === id)!;
const evaluate = (id: string) => mockEngine.evalPatient(DEMO_RULESET_CURRENT, patient(id));
const verdict = (id: string, criterion: string) =>
  evaluate(id).results.find((r) => r.id === criterion)!;

describe("mockEngine.evalPatient", () => {
  it("never turns missing data into a verdict", () => {
    const r = verdict("SYN-042", "anticoag-washout");
    expect(r.verdict).toBe("unknown");
    expect(r.trace?.detail).toContain("not evaluable");
  });

  it("treats a non-numeric lab value as not evaluable rather than guessing", () => {
    expect(verdict("SYN-077", "egfr-min").verdict).toBe("unknown");
    expect(verdict("SYN-077", "renal-safety").verdict).toBe("unknown");
  });

  it("fires an exclusion into a fail and traces the comparison", () => {
    const r = verdict("SYN-042", "renal-safety");
    expect(r.verdict).toBe("fail");
    expect(r.trace?.detail).toBe("egfr = 41 < 45");
  });

  it("holds boundary values inside the inclusion", () => {
    expect(verdict("SYN-095", "lvef-max").verdict).toBe("pass"); // lvef = 40, rule is ≤ 40
    expect(verdict("SYN-095", "egfr-min").verdict).toBe("pass"); // egfr = 30, rule is ≥ 30
  });

  it("keeps an unmodeled criterion unknown for everyone", () => {
    const r = verdict("SYN-003", "nyha-class-iv");
    expect(r.unmodeled).toBe(true);
    expect(r.verdict).toBe("unknown");
    expect(evaluate("SYN-003").overall).toBe("undetermined");
  });

  it("reads a temporal window against the recorded recency", () => {
    expect(verdict("SYN-088", "anticoag-washout").verdict).toBe("fail"); // 21d, window 30d
    expect(verdict("SYN-003", "anticoag-washout").verdict).toBe("pass"); // no medications
  });

  it("combines an all-clause with Kleene logic", () => {
    // WOCBP with a negative pregnancy test: first clause true, second false.
    expect(verdict("SYN-095", "wocbp-no-preg-test").verdict).toBe("pass");
    expect(verdict("SYN-034", "wocbp-no-preg-test").verdict).toBe("fail");
  });
});

describe("mockEngine.check", () => {
  const findings = mockEngine.check(DEMO_RULESET_CURRENT, DEMO_FACT_MODEL);

  it("catches the seeded contradictory band with an evidence line", () => {
    const conflict = findings.find((f) => f.code === "contradictory-band")!;
    expect(conflict.level).toBe("error");
    expect(conflict.criteria).toEqual(["egfr-min", "renal-safety"]);
    expect(conflict.evidence).toContain("[30, 45)");
  });

  it("warns when a rule's unit is not the fact model's unit", () => {
    const unit = findings.find((f) => f.code === "unit-mismatch")!;
    expect(unit.level).toBe("warning");
    expect(unit.criteria).toEqual(["egfr-min"]);
  });

  it("records unmodeled criteria as info, not as silence", () => {
    expect(findings.find((f) => f.code === "unmodeled")?.criteria).toEqual(["nyha-class-iv"]);
  });

  it("sorts errors before warnings before info", () => {
    const rank = { error: 0, warning: 1, info: 2 };
    const levels = findings.map((f) => rank[f.level]);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("reports a malformed rule set as one schema error instead of throwing", () => {
    const findings = mockEngine.check("ruleset: x\ncriteria: []\n", DEMO_FACT_MODEL);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("schema");
  });

  it("flags a rule that references a fact the model does not declare", () => {
    const bad = DEMO_RULESET_CURRENT.replace("fact: lvef, op: lte", "fact: ejection_fraction, op: lte");
    expect(mockEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "unknown-fact")).toBe(true);
  });

  it("flags a criterion that can never fire", () => {
    const bad = DEMO_RULESET_CURRENT.replace(
      "when: { fact: age, op: gte, value: 18 }",
      "when:\n      all:\n        - { fact: age, op: gte, value: 65 }\n        - { fact: age, op: lte, value: 40 }",
    );
    expect(mockEngine.check(bad, DEMO_FACT_MODEL).some((f) => f.code === "unsatisfiable")).toBe(true);
  });
});
