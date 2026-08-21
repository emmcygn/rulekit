/**
 * The review queue's store — the rulekit invariant (G11) applied to the
 * workbench cohort, and the band effect it produces (G10).
 *
 * A proposed fact is invisible to the engine until a human confirms it. What
 * the engine *does* keep seeing is the structured record the fixture already
 * carried: withholding a model's proposal is the invariant, deleting a lab
 * result is not, and the difference is triage cluster B(c).
 */
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";
import { parseFactsFile } from "../../src/extract/schema.js";
import { computeFunnel } from "../src/funnel/compute.js";
import { displayBandOf } from "../src/funnel/bands.js";
import { realEngine } from "../src/engine/real.js";
import { resolveChartReview } from "../src/engine/chart-review.js";
import { DEMO_COHORT, DEMO_FACTS, DEMO_NOTES, DEMO_RULESET_CURRENT } from "../src/data/index.js";
import {
  allowedValues,
  applyReview,
  asOfLabel,
  buildCards,
  cardId,
  checkCardEdit,
  decide,
  decisionsYaml,
  factsRead,
  initialReviewState,
  loadReviewState,
  parseEdit,
  pendingCount,
  REVIEWER,
  reviewProgress,
  saveReviewState,
  STORAGE_KEY,
  type ReviewState,
} from "../src/review/store.js";
import { DEMO_FACT_MODEL } from "../src/data/index.js";

const initial = initialReviewState(DEMO_FACTS);
const engine = {
  ...realEngine,
  evalPatient: (yaml: string, p: (typeof DEMO_COHORT)[number]) =>
    resolveChartReview(realEngine.evalPatient(yaml, p), p),
};
const evalsFor = (state: ReviewState) =>
  applyReview(DEMO_COHORT, DEMO_FACTS, state).map((p) =>
    engine.evalPatient(DEMO_RULESET_CURRENT, p),
  );
const bandsFor = (state: ReviewState) => computeFunnel(evalsFor(state)).bands;
const bandOfPatient = (state: ReviewState, id: string) =>
  displayBandOf(evalsFor(state).find((e) => e.patient === id)!);

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

describe("applyReview — withhold the proposal, keep the record", () => {
  it("keeps the structured value while the proposal is pending", () => {
    // fixtures/patients/SYN-007.yaml asserts egfr 38; corpus/facts proposes 58.
    // The engine sees 38 — the record — until a human says otherwise.
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, initial).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBe(38);
    expect(syn007.facts["age"]).toBe(61);
  });

  it("never manufactures a not-evaluable patient out of data it already had", () => {
    // The three patients with facts files all have structured values, so none of
    // them is un-evaluable at rest (uiux B6).
    const bands = bandsFor(initial);
    expect(bands["not-evaluable"]).toBe(0);
    for (const id of ["SYN-007", "SYN-019", "SYN-042"]) {
      expect(bandOfPatient(initial, id)).not.toBe("not-evaluable");
    }
  });

  it("hands the engine the confirmed value, and only after a human confirms", () => {
    const confirmed = decide(initial, cardId("SYN-007", "egfr"), "confirmed");
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, confirmed).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBe(58);
  });

  it("leaves the record standing when a proposal is rejected", () => {
    const rejected = decide(initial, cardId("SYN-007", "egfr"), "rejected");
    const syn007 = applyReview(DEMO_COHORT, DEMO_FACTS, rejected).find(
      (p) => p.patient === "SYN-007",
    )!;
    expect(syn007.facts["egfr"]).toBe(38);
  });

  it("uses the human's corrected value when the card was edited", () => {
    const edited = decide(initial, cardId("SYN-007", "egfr"), "confirmed", 47);
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

describe("parseEdit — a correction is usable or it is refused", () => {
  it("refuses a value that will not coerce, instead of falling back to the model's", () => {
    const bad = parseEdit("banana", 62, "mL/min/1.73m2");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toContain("not a number");
      expect(bad.message).toContain("mL/min/1.73m2");
    }
  });

  it("refuses an empty correction", () => {
    expect(parseEdit("   ", 62).ok).toBe(false);
  });

  it("accepts a number, a boolean and an enum member", () => {
    expect(parseEdit(" 47 ", 62)).toEqual({ ok: true, value: 47 });
    expect(parseEdit("false", true)).toEqual({ ok: true, value: false });
    expect(parseEdit("IV", "III")).toEqual({ ok: true, value: "IV" });
  });

  it("checks a card against the type its displayed value implies", () => {
    expect(checkCardEdit({ value: "62", unit: "mL/min" }, "banana").ok).toBe(false);
    expect(checkCardEdit({ value: "62" }, "47")).toEqual({ ok: true, value: 47 });
    expect(checkCardEdit({ value: "III" }, "IV")).toEqual({ ok: true, value: "IV" });
  });

  it("offers the fact model's closed value set for an enum fact", () => {
    expect(allowedValues("nyha_class", DEMO_FACT_MODEL)).toEqual(["I", "II", "III", "IV"]);
    expect(allowedValues("egfr", DEMO_FACT_MODEL)).toBeUndefined();
  });
});

describe("coverage — which facts a decision can actually move", () => {
  const read = factsRead(DEMO_RULESET_CURRENT);

  it("names every fact a criterion reads, chart-review facts included", () => {
    expect([...read].sort()).toEqual(["age", "egfr", "lvef", "medications", "nyha_class"]);
  });

  it("counts only those in the 'as of N of M facts reviewed' stamp", () => {
    const p = reviewProgress(DEMO_FACTS, initial, read);
    expect(p.total).toBe(17);
    expect(p.relevantTotal).toBe(5);
    expect(p.chartReviewOnly).toBe(12);
    expect(p.patients).toBe(3);
    expect(asOfLabel(p)).toBe("as of 0 of 5 facts reviewed");
  });

  it("moves the stamp when a relevant fact is decided, not when a note fact is", () => {
    const relevant = decide(initial, cardId("SYN-007", "egfr"), "confirmed");
    expect(asOfLabel(reviewProgress(DEMO_FACTS, relevant, read))).toBe(
      "as of 1 of 5 facts reviewed",
    );
    const irrelevant = decide(initial, cardId("SYN-007", "potassium"), "confirmed");
    expect(asOfLabel(reviewProgress(DEMO_FACTS, irrelevant, read))).toBe(
      "as of 0 of 5 facts reviewed",
    );
  });
});

describe("G10 — deciding a fact moves the bands", () => {
  it("starts with everyone either failed or waiting on a chart review", () => {
    expect(bandsFor(initial)).toEqual({
      "screen-fail": 7,
      "not-evaluable": 0,
      "pending-chart-review": 3,
      "potentially-eligible": 0,
    });
  });

  it("confirming a higher eGFR moves SYN-019 out of screen fail", () => {
    // The structured record says 42, which fires E3 (< 45). The note says 62.
    // Confirming is an override, and the funnel reflects it immediately.
    expect(bandOfPatient(initial, "SYN-019")).toBe("screen-fail");
    const one = decide(initial, cardId("SYN-019", "egfr"), "confirmed");
    expect(bandOfPatient(one, "SYN-019")).toBe("pending-chart-review");
    expect(bandsFor(one)["screen-fail"]).toBe(6);
  });

  it("rejecting decides the card without moving anyone", () => {
    const rejected = decide(initial, cardId("SYN-019", "egfr"), "rejected");
    expect(bandsFor(rejected)).toEqual(bandsFor(initial));
    expect(pendingCount(DEMO_FACTS, rejected)).toBe(pendingCount(DEMO_FACTS, initial) - 1);
  });
});

describe("decisionsYaml — the audit trail leaves the browser", () => {
  const state = decide(
    decide(initial, cardId("SYN-019", "egfr"), "confirmed", undefined, "2026-08-21T10:00:00Z"),
    cardId("SYN-019", "nyha_class"),
    "confirmed",
    "IV",
    "2026-08-21T10:05:00Z",
  );
  const text = decisionsYaml(DEMO_FACTS, state, "2026-08-21T10:06:00Z");

  it("emits one parseable facts file per patient with a decision", () => {
    const docs = parseAllDocuments(text).map((d) => d.toJS() as unknown);
    expect(docs).toHaveLength(1);
    const file = parseFactsFile(text);
    expect(file.patient).toBe("SYN-019");
    expect(file.facts.map((f) => f.fact).sort()).toEqual(["egfr", "nyha_class"]);
  });

  it("stamps every entry with the reviewer and the time", () => {
    const file = parseFactsFile(text);
    for (const f of file.facts) {
      expect(f.reviewedBy).toBe(REVIEWER);
      expect(f.reviewedAt).toMatch(/^2026-08-21T10:0[05]:00Z$/);
      expect(f.status).toBe("confirmed");
    }
  });

  it("records a human correction as human provenance, keeping the original quote", () => {
    const nyha = parseFactsFile(text).facts.find((f) => f.fact === "nyha_class")!;
    expect(nyha.value).toBe("IV");
    expect(nyha.extractedBy).toBe("human");
    expect(nyha.source?.doc).toBe("clinic-2026-04-02");
  });

  it("says so rather than emitting an empty document when nothing was decided", () => {
    expect(decisionsYaml(DEMO_FACTS, initial)).toContain("No decisions to export");
  });
});

describe("persistence", () => {
  it("round-trips through a Storage-shaped object", () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const state = decide(initial, cardId("SYN-007", "egfr"), "confirmed", undefined, "T");
    saveReviewState(fake, state);
    expect(store.has(STORAGE_KEY)).toBe(true);
    expect(loadReviewState(fake)).toEqual(state);
  });

  it("survives a missing or corrupt store rather than throwing", () => {
    expect(loadReviewState(undefined)).toEqual({});
    expect(loadReviewState({ getItem: () => "{{{" })).toEqual({});
  });
});

describe("buildCards", () => {
  const cards = buildCards({
    cohort: DEMO_COHORT,
    files: DEMO_FACTS,
    notes: DEMO_NOTES,
    rulesetYaml: DEMO_RULESET_CURRENT,
    engine,
    state: initial,
  });

  it("queues every pending proposal for the demo cohort", () => {
    expect(cards).toHaveLength(pendingCount(DEMO_FACTS, initial));
    expect(cards.every((c) => c.noteContext.includes(c.quote))).toBe(true);
  });

  it("shows the value already on record beside the one being proposed", () => {
    const egfr019 = cards.find((c) => c.id === cardId("SYN-019", "egfr"))!;
    expect(egfr019.structured).toBe("42");
    expect(egfr019.value).toBe("62");
  });

  it("flags the facts that would change a band, in the funnel's own words", () => {
    const egfr019 = cards.find((c) => c.id === cardId("SYN-019", "egfr"))!;
    expect(egfr019.flipsVerdict).toBe(true);
    expect(egfr019.impact).toBe("screen fail → pending chart review");
  });

  it("marks a fact no criterion reads, and leaves it without an impact claim", () => {
    const peptide = cards.find((c) => c.id === cardId("SYN-007", "nt_probnp"))!;
    expect(peptide.usedByRules).toBe(false);
    expect(peptide.flipsVerdict).toBe(false);
    const nyha = cards.find((c) => c.id === cardId("SYN-019", "nyha_class"))!;
    expect(nyha.usedByRules).toBe(true);
  });

  it("drops a card once it has been decided", () => {
    const after = buildCards({
      cohort: DEMO_COHORT,
      files: DEMO_FACTS,
      notes: DEMO_NOTES,
      rulesetYaml: DEMO_RULESET_CURRENT,
      engine,
      state: decide(initial, cardId("SYN-007", "egfr"), "confirmed"),
    });
    expect(after.map((c) => c.id)).not.toContain(cardId("SYN-007", "egfr"));
    expect(after).toHaveLength(cards.length - 1);
  });
});
