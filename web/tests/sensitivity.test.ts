import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { mockEngine } from "../src/engine/mock.js";
import { cohortCounts } from "../src/funnel/compute.js";
import {
  factValues,
  histogram,
  numericTargets,
  relaxedValue,
  setKnob,
  topYield,
} from "../src/sensitivity/compute.js";
import { DEMO_COHORT, DEMO_RULESET_CURRENT } from "../src/data/index.js";

const targets = numericTargets(DEMO_RULESET_CURRENT);
const evalAll = (yaml: string) => DEMO_COHORT.map((p) => mockEngine.evalPatient(yaml, p));

describe("numericTargets", () => {
  it("finds every draggable knob in the rule set", () => {
    expect(targets.map((t) => `${t.criterionId}.${t.knob}`)).toEqual([
      "age-min.value",
      "lvef-max.value",
      "egfr-min.value",
      "anticoag-washout.windowDays",
      "renal-safety.value",
    ]);
  });

  it("carries the path, unit and a human label", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    expect(renal.path).toEqual(["criteria", 5, "when", "value"]);
    expect(renal.label).toBe("eGFR < 45");
    expect(renal.fact).toBe("egfr");
    const egfrMin = targets.find((t) => t.criterionId === "egfr-min")!;
    expect(egfrMin.unit).toBe("mL/min");
  });
});

describe("setKnob", () => {
  it("writes the new threshold back into the YAML text", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const next = setKnob(DEMO_RULESET_CURRENT, renal.path, 40);
    const parsed = parseRuleSet(next);
    const criterion = parsed.criteria.find((c) => c.id === "renal-safety")!;
    expect(criterion.when).toEqual({ fact: "egfr", op: "lt", value: 40 });
  });

  it("leaves the rest of the document — comments included — alone", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const next = setKnob(DEMO_RULESET_CURRENT, renal.path, 40);
    expect(next).toContain("# DEMO DATA");
    expect(next).toContain("verbatim: \"Age 18 years or older\"");
    expect(next.split("\n").length).toBe(DEMO_RULESET_CURRENT.split("\n").length);
  });
});

describe("relaxedValue", () => {
  it("relaxes an inclusion by admitting more patients", () => {
    expect(relaxedValue("inclusion", "gte", 30)).toBe(25);
    expect(relaxedValue("inclusion", "lte", 40)).toBe(45);
  });

  it("relaxes an exclusion by firing less often", () => {
    expect(relaxedValue("exclusion", "lt", 45)).toBe(40);
    expect(relaxedValue("exclusion", "gt", 60)).toBe(65);
  });

  it("halves a temporal window", () => {
    expect(relaxedValue("exclusion", "anyWithin", 30)).toBe(15);
    expect(relaxedValue("exclusion", "anyWithin", 1)).toBe(1);
  });
});

describe("live re-count", () => {
  it("returns the 40–45 band to the pool when the renal exclusion is relaxed", () => {
    const before = cohortCounts(evalAll(DEMO_RULESET_CURRENT));
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const after = cohortCounts(evalAll(setKnob(DEMO_RULESET_CURRENT, renal.path, 40)));
    expect(before.potentiallyEligible).toBe(2);
    expect(after.potentiallyEligible).toBe(3);
    expect(after.screenFail).toBe(before.screenFail - 1);
    expect(after.notEvaluable).toBe(before.notEvaluable);
  });

  it("tightening a threshold moves patients the other way", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const after = cohortCounts(evalAll(setKnob(DEMO_RULESET_CURRENT, renal.path, 60)));
    expect(after.potentiallyEligible).toBe(1);
  });
});

describe("topYield", () => {
  const ranked = topYield(DEMO_RULESET_CURRENT, DEMO_COHORT, mockEngine);

  it("ranks criteria by how many patients relaxing them returns", () => {
    expect(ranked[0]!.criterionId).toBe("lvef-max");
    expect(ranked[0]!.delta).toBe(2);
    expect(ranked.map((r) => r.delta)).toEqual([...ranked.map((r) => r.delta)].sort((a, b) => b - a));
  });

  it("describes the move it priced", () => {
    expect(ranked[0]!.from).toBe(40);
    expect(ranked[0]!.to).toBe(45);
  });

  it("drops knobs that buy nothing", () => {
    expect(ranked.map((r) => r.criterionId)).not.toContain("age-min");
  });
});

describe("histogram", () => {
  it("buckets cohort values on a round grid", () => {
    const bins = histogram([31, 33, 38, 41, 42], 5);
    expect(bins[0]).toEqual({ lo: 30, hi: 35, count: 2 });
    expect(bins.at(-1)).toEqual({ lo: 40, hi: 45, count: 2 });
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(5);
  });

  it("keeps a single value from collapsing to an empty range", () => {
    const bins = histogram([42], 5);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(1);
  });

  it("separates numeric cohort values from unusable ones", () => {
    const { numeric, unusable } = factValues(DEMO_COHORT, "egfr");
    expect(numeric).toHaveLength(15);
    expect(unusable).toEqual([{ patient: "SYN-077", value: ">60" }]);
  });
});
