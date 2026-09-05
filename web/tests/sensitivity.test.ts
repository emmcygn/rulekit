import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { realEngine } from "../src/engine/real.js";
import { cohortCounts } from "../src/funnel/compute.js";
import { displayBandCounts } from "../src/funnel/bands.js";
import { resolveChartReview } from "../src/engine/chart-review.js";
import {
  factValues,
  histogram,
  numericTargets,
  prepareSensitivity,
  relaxedValue,
  sensitivityCounts,
  setKnob,
  topYield,
  yieldsAreRanked,
} from "../src/sensitivity/compute.js";
import { DEMO_COHORT, DEMO_RULESET_CURRENT } from "../src/data/index.js";

const targets = numericTargets(DEMO_RULESET_CURRENT);
const evalAll = (yaml: string) => DEMO_COHORT.map((p) => realEngine.evalPatient(yaml, p));
const evalResolved = (yaml: string) =>
  DEMO_COHORT.map((p) => resolveChartReview(realEngine.evalPatient(yaml, p), p));

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
    expect(renal.path).toEqual(["criteria", 4, "when", "value"]);
    expect(renal.label).toBe("eGFR < 45");
    expect(renal.fact).toBe("egfr");
    const egfrMin = targets.find((t) => t.criterionId === "egfr-min")!;
    expect(egfrMin.unit).toBe("mL/min/1.73m2");
  });
});

describe("setKnob", () => {
  it("writes the new threshold back into the YAML text", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const next = setKnob(DEMO_RULESET_CURRENT, renal.path, 40);
    const parsed = parseRuleSet(next);
    const criterion = parsed.criteria.find((c) => c.id === "renal-safety")!;
    expect(criterion.when).toEqual({ fact: "egfr", op: "lt", value: 40, unit: "mL/min/1.73m2" });
  });

  it("leaves the rest of the document — comments included — alone", () => {
    const renal = targets.find((t) => t.criterionId === "renal-safety")!;
    const next = setKnob(DEMO_RULESET_CURRENT, renal.path, 40);
    expect(next).toContain('protocol: "DEMO-HF-001 v3.0 (Amendment 2)"');
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
  const renal = targets.find((t) => t.criterionId === "renal-safety")!;

  it("returns the 40–45 band to the pool when the renal exclusion is relaxed", () => {
    // SYN-019 (42) and SYN-042 (41) come back — the same two patients the CLI's
    // `diff` reports, in the same direction (operator M1).
    const before = displayBandCounts(evalResolved(DEMO_RULESET_CURRENT));
    const after = displayBandCounts(evalResolved(setKnob(DEMO_RULESET_CURRENT, renal.path, 40)));
    expect(before["screen-fail"]).toBe(7);
    expect(after["screen-fail"]).toBe(5);
    expect(after["pending-chart-review"]).toBe(before["pending-chart-review"]);
    expect(after["not-evaluable"]).toBe(before["not-evaluable"] + 2);
  });

  it("tightening a threshold moves patients the other way", () => {
    const after = displayBandCounts(evalResolved(setKnob(DEMO_RULESET_CURRENT, renal.path, 60)));
    expect(after["screen-fail"]).toBe(9);
  });

  it("keeps the shared three-band vocabulary identical to the CLI's", () => {
    const counts = cohortCounts(evalAll(DEMO_RULESET_CURRENT));
    expect(counts).toEqual({ potentiallyEligible: 0, screenFail: 7, notEvaluable: 3 });
  });
});

describe("topYield", () => {
  const ranked = topYield(DEMO_RULESET_CURRENT, DEMO_COHORT, realEngine);

  it("ranks criteria by how many patients relaxing them returns from screen fail", () => {
    // The criterion the coordinator came to ask about is now first, because it
    // is the one that costs the most patients (operator M4: E3 was missing
    // entirely, and a +1 age relaxation to 13 was ranked #1 — uiux M7).
    expect(ranked[0]!.criterionId).toBe("renal-safety");
    expect(ranked[0]!.delta).toBe(2);
    expect(ranked.map((r) => r.delta)).toEqual([...ranked.map((r) => r.delta)].sort((a, b) => b - a));
  });

  it("matches full cohort evaluation while recomputing only the changed criterion", () => {
    const prepared = prepareSensitivity(
      parseRuleSet(DEMO_RULESET_CURRENT),
      DEMO_COHORT,
      evalResolved(DEMO_RULESET_CURRENT),
    );
    for (const target of prepared.targets) {
      const value = relaxedValue(target.criterionKind, target.op, target.value);
      expect(sensitivityCounts(prepared, target, value)).toEqual(
        displayBandCounts(evalResolved(setKnob(DEMO_RULESET_CURRENT, target.path, value))),
      );
    }
  });

  it("lists every numeric knob, including the ones that buy nothing", () => {
    expect(ranked.map((r) => r.criterionId).sort()).toEqual([
      "age-min",
      "anticoag-washout",
      "egfr-min",
      "lvef-max",
      "renal-safety",
    ]);
    expect(ranked.find((r) => r.criterionId === "egfr-min")!.delta).toBe(0);
  });

  it("suppresses the ranking when the top yields tie", () => {
    expect(yieldsAreRanked(ranked)).toBe(true);
    expect(yieldsAreRanked([])).toBe(false);
    const tied = [
      { delta: 1 },
      { delta: 1 },
    ] as unknown as Parameters<typeof yieldsAreRanked>[0];
    expect(yieldsAreRanked(tied)).toBe(false);
  });

  it("describes the move it priced", () => {
    const lvef = ranked.find((r) => r.criterionId === "lvef-max")!;
    expect(lvef.from).toBe(40);
    expect(lvef.to).toBe(45);
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
    expect(numeric).toHaveLength(10);
    expect(unusable).toEqual([]);
    const messy = [...DEMO_COHORT, { patient: "SYN-999", facts: { egfr: ">60" } }];
    expect(factValues(messy, "egfr").unusable).toEqual([{ patient: "SYN-999", value: ">60" }]);
  });
});
