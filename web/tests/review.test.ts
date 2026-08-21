/**
 * The review queue's store — the rulekit invariant (G11) applied to the
 * workbench cohort, and the funnel effect it produces (G10).
 *
 * A proposed fact is invisible to the engine. The workbench therefore evaluates
 * the cohort with every still-pending proposal withheld, and confirming one puts
 * it in front of the engine — which is the only thing that can shrink the
 * "not evaluable" band.
 */
import { describe, expect, it } from "vitest";
import { computeFunnel } from "../src/funnel/compute.js";
import { realEngine } from "../src/engine/real.js";
import { DEMO_COHORT, DEMO_FACTS, DEMO_NOTES, DEMO_RULESET_CURRENT } from "../src/data/index.js";
import {
  applyReview,
  buildCards,
  cardId,
  decide,
  initialReviewState,
  pendingCount,
} from "../src/review/store.js";

const initial = initialReviewState(DEMO_FACTS);
const funnelFor = (state: typeof initial) =>
  computeFunnel(
    applyReview(DEMO_COHORT, DEMO_FACTS, state).map((p) =>
      realEngine.evalPatient(DEMO_RULESET_CURRENT, p),
    ),
  );

describe("the bundled proposed facts", () => {
  it("covers the demo patients that have a facts file, and nobody else", () => {
    expect(DEMO_FACTS.map((f) => f.patient).sort()).toEqual(["SYN-007", "SYN-019", "SYN-042"]);
    const cohort = new Set(DEMO_COHORT.map((p) => p.patient));
    for (const f of DEMO_FACTS) expect(cohort).toContain(f.patient);
  });

  it("carries the note body each quote is grounded in", () => {
    for (const f of DEMO_FACTS) {
      for (const e of f.facts) {
        if (e.source === undefined) continue;
        const body = DEMO_NOTES[e.source.doc];
        expect(body, `${f.patient} ${e.fact} -> ${e.source.doc}`).toBeDefined();
        expect(body).toContain(e.source.quote);
      }
    }
  });
});

describe("applyReview — a proposed fact never reaches the engine", () => {
  it("withholds every pending proposal from the patient the engine sees", () => {
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, initial).find(
      (p) => p.patient === "SYN-007",
    )!;
    // The fixture asserts egfr 38; corpus/facts/SYN-007.yaml proposes 58 and
    // nobody has confirmed it, so the engine sees neither.
    expect(syn007.facts["egfr"]).toBeUndefined();
    expect(syn007.facts["age"]).toBe(61);
  });

  it("hands the engine the confirmed value, and only after a human confirms", () => {
    const confirmed = decide(initial, cardId("SYN-007", "egfr"), "confirmed");
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, confirmed).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBe(58);
  });

  it("keeps a rejected proposal out for good", () => {
    const rejected = decide(initial, cardId("SYN-007", "egfr"), "rejected");
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, rejected).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBeUndefined();
  });

  it("uses the human's corrected value when the card was edited", () => {
    const edited = decide(initial, cardId("SYN-007", "egfr"), "confirmed", "47");
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, edited).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBe(47);
  });

  it("leaves patients without a facts file untouched", () => {
    const before = DEMO_COHORT.find((p) => p.patient === "SYN-088")!;
    const after = applyReview(DEMO_COHORT, DEMO_FACTS, initial).find(
      (p) => p.patient === "SYN-088",
    )!;
    expect(after.facts).toEqual(before.facts);
  });
});

describe("G10 — confirming shrinks the not-evaluable band", () => {
  it("starts with the three patients whose ruleset facts are pending review", () => {
    const f = funnelFor(initial);
    expect(f.notEvaluable).toBe(3);
    expect(f.remaining).toBe(3);
    expect(f.screenFail + f.notEvaluable + f.remaining).toBe(10);
  });

  it("shrinks the band by one and adds one potentially-eligible patient per confirm", () => {
    const one = decide(initial, cardId("SYN-007", "egfr"), "confirmed");
    expect(funnelFor(one).notEvaluable).toBe(2);
    expect(funnelFor(one).remaining).toBe(4);

    const two = decide(one, cardId("SYN-019", "egfr"), "confirmed");
    expect(funnelFor(two).notEvaluable).toBe(1);
    expect(funnelFor(two).remaining).toBe(5);
  });

  it("rejecting decides the card without moving anyone out of the band", () => {
    const rejected = decide(initial, cardId("SYN-007", "egfr"), "rejected");
    expect(funnelFor(rejected).notEvaluable).toBe(3);
    expect(pendingCount(DEMO_FACTS, rejected)).toBe(pendingCount(DEMO_FACTS, initial) - 1);
  });
});

describe("buildCards", () => {
  const cards = buildCards({
    cohort: DEMO_COHORT,
    files: DEMO_FACTS,
    notes: DEMO_NOTES,
    rulesetYaml: DEMO_RULESET_CURRENT,
    engine: realEngine,
    state: initial,
  });

  it("queues every pending proposal for the demo cohort", () => {
    expect(cards).toHaveLength(pendingCount(DEMO_FACTS, initial));
    expect(cards.every((c) => c.noteContext.includes(c.quote))).toBe(true);
  });

  it("flags the facts that would change a verdict, and only those", () => {
    const egfr007 = cards.find((c) => c.id === cardId("SYN-007", "egfr"))!;
    expect(egfr007.flipsVerdict).toBe(true);
    expect(egfr007.impact).toBe("not evaluable → potentially eligible");

    // nt_probnp is in the fact model but no criterion reads it.
    const peptide = cards.find((c) => c.id === cardId("SYN-007", "nt_probnp"))!;
    expect(peptide.flipsVerdict).toBe(false);
  });

  it("drops a card once it has been decided", () => {
    const after = buildCards({
      cohort: DEMO_COHORT,
      files: DEMO_FACTS,
      notes: DEMO_NOTES,
      rulesetYaml: DEMO_RULESET_CURRENT,
      engine: realEngine,
      state: decide(initial, cardId("SYN-007", "egfr"), "confirmed"),
    });
    expect(after.map((c) => c.id)).not.toContain(cardId("SYN-007", "egfr"));
    expect(after).toHaveLength(cards.length - 1);
  });
});
