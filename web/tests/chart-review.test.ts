/**
 * Chart-review resolution — triage cluster C, the "confirm yesterday's NYHA and
 * the numbers move" flow (operator showstopper S2).
 *
 * Route taken and why: demo-hf-001's E4 stays `unmodeled: true`, because the
 * closed rule language has no way to compare an enum fact. Instead the
 * workbench declares which unmodeled criteria a human can settle from a
 * confirmed fact, and applies that between the engine and the screen. See the
 * header of `web/src/engine/chart-review.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { realEngine } from "../src/engine/real.js";
import { CHART_REVIEW_RULES, resolveChartReview } from "../src/engine/chart-review.js";
import { computeFunnel } from "../src/funnel/compute.js";
import { displayBandOf } from "../src/funnel/bands.js";
import { resultProse } from "../src/funnel/trace.js";
import { applyReview, cardId, decide, initialReviewState, type ReviewState } from "../src/review/store.js";
import { DEMO_COHORT, DEMO_FACTS, DEMO_RULESET_CURRENT } from "../src/data/index.js";

const evalsFor = (state: ReviewState) =>
  applyReview(DEMO_COHORT, DEMO_FACTS, state).map((p) =>
    resolveChartReview(realEngine.evalPatient(DEMO_RULESET_CURRENT, p), p),
  );
const bandsFor = (state: ReviewState) => computeFunnel(evalsFor(state)).bands;
const bandOf = (state: ReviewState, id: string) =>
  displayBandOf(evalsFor(state).find((e) => e.patient === id)!);
const e4Of = (state: ReviewState, id: string) =>
  evalsFor(state)
    .find((e) => e.patient === id)!
    .results.find((r) => r.id === "nyha-class-iv")!;

const initial = initialReviewState(DEMO_FACTS);

describe("the language really cannot model E4", () => {
  it("leaves nyha-class-iv unmodeled in the shipped rule set", () => {
    const e4 = parseRuleSet(DEMO_RULESET_CURRENT).criteria.find((c) => c.id === "nyha-class-iv")!;
    expect(e4.unmodeled).toBe(true);
    expect(e4.when).toBeUndefined();
  });

  it("cannot express `nyha_class eq IV`: numeric eq takes numbers only", () => {
    const withEnumEq = DEMO_RULESET_CURRENT.replace(
      "    unmodeled: true",
      "    when: { fact: nyha_class, op: eq, value: IV }",
    );
    expect(() => parseRuleSet(withEnumEq)).toThrow();
  });

  it("cannot express it as a code set either: `in` matches code lists, not enums", () => {
    const asCodes = DEMO_RULESET_CURRENT.replace(
      "    unmodeled: true",
      "    when: { fact: nyha_class, op: in, codes: { system: nyha, values: [IV] } }",
    );
    // It parses, but the evaluator refuses a bare string as a code list, so the
    // criterion would be *unknown for everyone* — a worse lie than `unmodeled`.
    const r = realEngine
      .evalPatient(asCodes, { patient: "X", facts: { nyha_class: "IV" } })
      .results.find((x) => x.id === "nyha-class-iv")!;
    expect(r.verdict).toBe("unknown");
    expect(r.trace?.detail).toContain("not a code list");
  });
});

describe("resolveChartReview", () => {
  it("declares one rule, for demo-hf-001's E4 only", () => {
    expect(CHART_REVIEW_RULES.map((r) => r.criterionId)).toEqual(["nyha-class-iv"]);
  });

  it("leaves the criterion unknown while nobody has confirmed the fact", () => {
    const r = e4Of(initial, "SYN-019");
    expect(r.verdict).toBe("unknown");
    expect(r.chartReview).toBeUndefined();
    expect(resultProse(r)).toContain("chart review required");
  });

  it("does not resolve from a proposal nobody decided", () => {
    // corpus/facts/SYN-019.yaml proposes nyha_class III. The invariant holds on
    // this path too: a proposal is not a fact until a human says so.
    const patient = applyReview(DEMO_COHORT, DEMO_FACTS, initial).find(
      (p) => p.patient === "SYN-019",
    )!;
    expect(patient.facts["nyha_class"]).toBeUndefined();
  });

  it("settles the criterion once a human confirms the fact, and says who decided it", () => {
    const state = decide(initial, cardId("SYN-019", "nyha_class"), "confirmed");
    const r = e4Of(state, "SYN-019");
    expect(r.verdict).toBe("pass");
    expect(r.unmodeled).toBe(true); // still unmodeled in the rule set — we say so
    expect(r.chartReview).toEqual({
      fact: "nyha_class",
      value: "III",
      detail: "nyha_class = III (confirmed in review) → exclusion does not fire",
    });
    expect(resultProse(r)).toBe(
      "chart review — nyha_class = III (confirmed in review) → exclusion does not fire",
    );
  });

  it("fires the exclusion when the confirmed value is IV", () => {
    const state = decide(initial, cardId("SYN-019", "nyha_class"), "confirmed", "IV");
    const r = e4Of(state, "SYN-019");
    expect(r.verdict).toBe("fail");
    expect(r.chartReview?.detail).toContain("exclusion fired");
  });
});

describe("the operator's flow: confirm yesterday's NYHA and the numbers move", () => {
  it("step 1 — overriding a stale eGFR moves SYN-019 out of screen fail", () => {
    expect(bandOf(initial, "SYN-019")).toBe("screen-fail");
    const withEgfr = decide(initial, cardId("SYN-019", "egfr"), "confirmed");
    expect(bandOf(withEgfr, "SYN-019")).toBe("pending-chart-review");
    expect(bandsFor(withEgfr)).toEqual({
      "screen-fail": 6,
      "not-evaluable": 0,
      "pending-chart-review": 4,
      "potentially-eligible": 0,
    });
  });

  it("step 2a — confirming NYHA III settles the chart review and the patient becomes eligible", () => {
    const state = decide(
      decide(initial, cardId("SYN-019", "egfr"), "confirmed"),
      cardId("SYN-019", "nyha_class"),
      "confirmed",
    );
    expect(bandOf(state, "SYN-019")).toBe("potentially-eligible");
    expect(bandsFor(state)).toEqual({
      "screen-fail": 6,
      "not-evaluable": 0,
      "pending-chart-review": 3,
      "potentially-eligible": 1,
    });
  });

  it("step 2b — editing NYHA to IV excludes the patient instead, which is the point", () => {
    // Marisol types class IV off yesterday's echo. The screen used to thank her
    // and move nothing. Now the exclusion fires and she is back in screen fail.
    const state = decide(
      decide(initial, cardId("SYN-019", "egfr"), "confirmed"),
      cardId("SYN-019", "nyha_class"),
      "confirmed",
      "IV",
    );
    expect(bandOf(state, "SYN-019")).toBe("screen-fail");
    expect(bandsFor(state)).toEqual({
      "screen-fail": 7,
      "not-evaluable": 0,
      "pending-chart-review": 3,
      "potentially-eligible": 0,
    });
  });

  it("counts the settled chart reviews on the E4 funnel row", () => {
    const state = decide(
      decide(initial, cardId("SYN-019", "egfr"), "confirmed"),
      cardId("SYN-019", "nyha_class"),
      "confirmed",
    );
    const row = computeFunnel(evalsFor(state)).rows.find((r) => r.id === "nyha-class-iv")!;
    expect(row.chartReviewResolved).toBe(1);
    expect(row.chartReview).toBe(3);
  });
});
