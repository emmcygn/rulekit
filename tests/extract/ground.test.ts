import { describe, it, expect } from "vitest";
import { parseFactModel } from "../../src/core/schema.js";
import {
  groundProposedFacts,
  verifyFactEntry,
  quoteAppearsVerbatim,
  quoteObviouslyNegatesValue,
  normalizeNewlines,
  type ProposedFact,
  type GroundingContext,
} from "../../src/extract/ground.js";
import { loadNotesDir, toDocuments, NOTES_DIR } from "../../src/extract/notes.js";
import type { FactEntry } from "../../src/extract/schema.js";

const MODEL = parseFactModel(`
name: patient-facts/v1
facts:
  age: { type: number, unit: years }
  lvef: { type: number, unit: "%" }
  egfr: { type: number, unit: mL/min/1.73m2 }
  nyha_class: { type: enum, values: [I, II, III, IV] }
  on_anticoagulant: { type: boolean }
  medications: { type: code, systems: [rxnorm, rxnorm-class] }
`);

const NOTE = [
  "The patient reports marked limitation of physical activity;",
  "symptoms consistent with NYHA class III heart failure.",
  "LVEF 32% by biplane Simpson's method.",
  "eGFR 58 mL/min/1.73m2 drawn 2026-01-28.",
  "There has been no anticoagulant use since the GI bleed in March 2024.",
].join("\n");

const ctx: GroundingContext = { factModel: MODEL, documents: { "echo-x": { text: NOTE } } };
const OPTS = { doc: "echo-x", extractedBy: "llm/claude-opus-5", ctx };

const p = (over: Partial<ProposedFact>): ProposedFact => ({
  fact: "nyha_class",
  value: "III",
  confidence: 0.9,
  quote: "symptoms consistent with NYHA class III heart failure",
  ...over,
});

describe("normalizeNewlines", () => {
  it("collapses CRLF and lone CR to LF and nothing else", () => {
    expect(normalizeNewlines("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeNewlines("a  b\tc")).toBe("a  b\tc");
  });
});

describe("quoteAppearsVerbatim", () => {
  it("accepts an exact substring", () => {
    expect(quoteAppearsVerbatim("LVEF 32% by biplane", NOTE)).toBe(true);
  });

  it("accepts a quote that spans a newline once endings are normalized", () => {
    const q = "physical activity;\r\nsymptoms consistent";
    expect(quoteAppearsVerbatim(q, NOTE)).toBe(true);
  });

  it("rejects a case-folded near match", () => {
    expect(quoteAppearsVerbatim("lvef 32% by biplane", NOTE)).toBe(false);
  });

  it("rejects a whitespace-collapsed near match", () => {
    expect(quoteAppearsVerbatim("LVEF  32%  by biplane", NOTE)).toBe(false);
  });

  it("rejects a fabricated quote", () => {
    expect(quoteAppearsVerbatim("the patient has NYHA class IV symptoms", NOTE)).toBe(false);
  });

  it("rejects the empty quote (it would match anything)", () => {
    expect(quoteAppearsVerbatim("", NOTE)).toBe(false);
    expect(quoteAppearsVerbatim("   ", NOTE)).toBe(false);
  });
});

describe("obvious semantic negation", () => {
  it("recognizes a negated enum assertion without pretending to solve general NLP", () => {
    expect(quoteObviouslyNegatesValue("nyha_class", "IV", "No evidence of NYHA class IV symptoms")).toBe(true);
    expect(quoteObviouslyNegatesValue("nyha_class", "IV", "Not class III but NYHA class IV today")).toBe(false);
  });

  it("treats negation as support for false, not true, on a boolean fact", () => {
    const quote = "There has been no anticoagulant use since the GI bleed";
    expect(quoteObviouslyNegatesValue("on_anticoagulant", true, quote)).toBe(true);
    expect(quoteObviouslyNegatesValue("on_anticoagulant", false, quote)).toBe(false);
  });
});

describe("groundProposedFacts — the happy path", () => {
  it("admits a well-grounded enum fact as proposed, never confirmed", () => {
    const r = groundProposedFacts([p({})], OPTS);
    expect(r.rejected).toEqual([]);
    expect(r.grounded).toHaveLength(1);
    const f = r.grounded[0]!;
    expect(f.fact).toBe("nyha_class");
    expect(f.value).toBe("III");
    expect(f.status).toBe("proposed");
    expect(f.extractedBy).toBe("llm/claude-opus-5");
    expect(f.source).toEqual({ doc: "echo-x", quote: "symptoms consistent with NYHA class III heart failure" });
    expect(f.reviewedBy).toBeNull();
  });

  it("keeps status proposed even at confidence 1.0 (nothing auto-confirms)", () => {
    const r = groundProposedFacts([p({ confidence: 1 })], OPTS);
    expect(r.grounded[0]!.status).toBe("proposed");
  });

  it("coerces a numeric string to a number and stamps the declared unit", () => {
    const r = groundProposedFacts([p({ fact: "lvef", value: "32", unit: "%", quote: "LVEF 32% by biplane" })], OPTS);
    expect(r.rejected).toEqual([]);
    expect(r.grounded[0]!.value).toBe(32);
    expect(typeof r.grounded[0]!.value).toBe("number");
    expect(r.grounded[0]!.unit).toBe("%");
  });

  it("coerces a decimal", () => {
    const r = groundProposedFacts([p({ fact: "lvef", value: "32.5", unit: "%", quote: "LVEF 32%" })], OPTS);
    expect(r.grounded[0]!.value).toBe(32.5);
  });

  it("accepts a boolean-valued negation as false", () => {
    const r = groundProposedFacts(
      [p({ fact: "on_anticoagulant", value: "false", quote: "no anticoagulant use since the GI bleed" })],
      OPTS,
    );
    expect(r.rejected).toEqual([]);
    expect(r.grounded[0]!.value).toBe(false);
  });

  it("produces entries that parse as a facts file", async () => {
    const { parseFactsFile } = await import("../../src/extract/schema.js");
    const { stringify } = await import("yaml");
    const r = groundProposedFacts([p({}), p({ fact: "lvef", value: "32", unit: "%", quote: "LVEF 32%" })], OPTS);
    const yaml = stringify({ patient: "SYN-042", facts: r.grounded });
    expect(parseFactsFile(yaml).facts).toHaveLength(2);
  });
});

describe("groundProposedFacts — hostile fixtures", () => {
  it("rejects a fabricated quote", () => {
    const r = groundProposedFacts([p({ quote: "the patient is NYHA class III per the cardiologist" })], OPTS);
    expect(r.grounded).toEqual([]);
    expect(r.rejected[0]!.reasons).toContain("quote-not-found");
    expect(r.rejected[0]!.detail).toMatch(/verbatim/i);
  });

  it("rejects an enum value contradicted by obvious negation in its exact quote", () => {
    const note = "No evidence of NYHA class IV symptoms on today's examination.";
    const result = groundProposedFacts(
      [p({ value: "IV", quote: note })],
      { ...OPTS, ctx: { ...ctx, documents: { "echo-x": { text: note } } } },
    );
    expect(result.grounded).toEqual([]);
    expect(result.rejected[0]!.reasons).toContain("contradictory-negation");
  });

  it("rejects true when the cited phrase explicitly negates the boolean fact", () => {
    const result = groundProposedFacts(
      [p({ fact: "on_anticoagulant", value: "true", quote: "no anticoagulant use since the GI bleed" })],
      OPTS,
    );
    expect(result.grounded).toEqual([]);
    expect(result.rejected[0]!.reasons).toContain("contradictory-negation");
  });

  it("rejects a near-miss quote with one word changed", () => {
    const r = groundProposedFacts([p({ quote: "symptoms consistent with NYHA class III cardiac failure" })], OPTS);
    expect(r.grounded).toEqual([]);
    expect(r.rejected[0]!.reasons).toContain("quote-not-found");
  });

  it("rejects a near-miss quote differing only in punctuation", () => {
    const r = groundProposedFacts([p({ quote: "LVEF 32 % by biplane" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("quote-not-found");
  });

  it("rejects an unknown fact name", () => {
    const r = groundProposedFacts([p({ fact: "frailty_score", value: "4" })], OPTS);
    expect(r.grounded).toEqual([]);
    expect(r.rejected[0]!.reasons).toContain("unknown-fact");
    expect(r.rejected[0]!.detail).toMatch(/frailty_score/);
  });

  it("rejects the wrong unit on a numeric fact", () => {
    const r = groundProposedFacts(
      [p({ fact: "egfr", value: "58", unit: "mL/min", quote: "eGFR 58 mL/min/1.73m2" })],
      OPTS,
    );
    expect(r.grounded).toEqual([]);
    expect(r.rejected[0]!.reasons).toContain("unit-mismatch");
    expect(r.rejected[0]!.detail).toMatch(/mL\/min\/1\.73m2/);
  });

  it("rejects a numeric fact with no unit when the model declares one", () => {
    const r = groundProposedFacts([p({ fact: "lvef", value: "32", quote: "LVEF 32%" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("missing-unit");
  });

  it("rejects a unit on a fact the model declares unitless", () => {
    const r = groundProposedFacts([p({ fact: "nyha_class", value: "III", unit: "class" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("unit-mismatch");
  });

  it("rejects a RANGE value — the seeded 40-45% trap", () => {
    const notes = loadNotesDir(NOTES_DIR);
    const rangeCtx: GroundingContext = { factModel: MODEL, documents: toDocuments(notes) };
    const r = groundProposedFacts(
      [{ fact: "lvef", value: "40-45", unit: "%", confidence: 0.71, quote: "EF visually estimated at 40-45%" }],
      { doc: "echo-2026-01-22", extractedBy: "llm/claude-opus-5", ctx: rangeCtx },
    );
    // The quote is real. The value is not a number. That is the whole point.
    expect(r.rejected[0]!.reasons).toEqual(["type-mismatch"]);
    expect(r.grounded).toEqual([]);
  });

  it("rejects the midpoint of a range if the model invents one", () => {
    const notes = loadNotesDir(NOTES_DIR);
    const rangeCtx: GroundingContext = { factModel: MODEL, documents: toDocuments(notes) };
    const r = groundProposedFacts(
      [{ fact: "lvef", value: "42.5", unit: "%", confidence: 0.6, quote: "EF visually estimated at 42.5%" }],
      { doc: "echo-2026-01-22", extractedBy: "llm/claude-opus-5", ctx: rangeCtx },
    );
    expect(r.rejected[0]!.reasons).toContain("quote-not-found");
  });

  it.each([
    [">60", "comparator"],
    ["58 mL/min", "unit smuggled into the value"],
    ["approximately 32", "hedge"],
    ["thirty-two", "spelled out"],
    ["", "empty"],
    ["NaN", "not a number"],
    ["Infinity", "not finite"],
    ["0x20", "hex"],
    ["1e3", "exponent"],
  ])("rejects a non-numeric value %j (%s)", (value) => {
    const r = groundProposedFacts([p({ fact: "lvef", value, unit: "%", quote: "LVEF 32%" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("type-mismatch");
  });

  it("rejects an enum value outside the declared set", () => {
    const r = groundProposedFacts([p({ value: "IIIb" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("value-not-allowed");
    expect(r.rejected[0]!.detail).toMatch(/I, II, III, IV/);
  });

  it("rejects an enum value in the wrong case (no silent normalization)", () => {
    const r = groundProposedFacts([p({ value: "iii" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("value-not-allowed");
  });

  it("rejects a non-boolean value on a boolean fact", () => {
    const r = groundProposedFacts(
      [p({ fact: "on_anticoagulant", value: "yes", quote: "no anticoagulant use since the GI bleed" })],
      OPTS,
    );
    expect(r.rejected[0]!.reasons).toContain("type-mismatch");
  });

  it("rejects a bare string on a code-typed fact", () => {
    const r = groundProposedFacts([p({ fact: "medications", value: "warfarin", quote: "LVEF 32%" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("type-mismatch");
    expect(r.rejected[0]!.detail).toMatch(/deterministic/i);
  });

  it("rejects a quote against a document that does not exist", () => {
    const r = groundProposedFacts([p({})], { ...OPTS, doc: "no-such-note" });
    expect(r.rejected[0]!.reasons).toContain("doc-not-found");
  });

  it("rejects a proposal with an empty quote", () => {
    const r = groundProposedFacts([p({ quote: "" })], OPTS);
    expect(r.rejected[0]!.reasons).toContain("missing-source");
  });

  it("reports every independent failure, not just the first", () => {
    const r = groundProposedFacts([p({ fact: "lvef", value: "40-45", unit: "ml", quote: "fabricated" })], OPTS);
    expect(r.rejected[0]!.reasons).toEqual(
      expect.arrayContaining(["quote-not-found", "type-mismatch", "unit-mismatch"]),
    );
  });

  it("never silently drops — every input is either grounded or rejected", () => {
    const inputs = [
      p({}),
      p({ quote: "fabricated" }),
      p({ fact: "unknown_thing" }),
      p({ fact: "lvef", value: "40-45", unit: "%", quote: "LVEF 32%" }),
    ];
    const r = groundProposedFacts(inputs, OPTS);
    expect(r.grounded.length + r.rejected.length).toBe(inputs.length);
  });

  it("preserves the offending value on the rejection record for review", () => {
    const r = groundProposedFacts([p({ fact: "lvef", value: "40-45", unit: "%", quote: "LVEF 32%" })], OPTS);
    expect(r.rejected[0]!.value).toBe("40-45");
    expect(r.rejected[0]!.unit).toBe("%");
    expect(r.rejected[0]!.confidence).toBe(0.9);
    expect(r.rejected[0]!.source).toEqual({ doc: "echo-x", quote: "LVEF 32%" });
  });

  it("rejects a second proposal for a fact already grounded in this batch", () => {
    const r = groundProposedFacts([p({}), p({ value: "II", quote: "LVEF 32%" })], OPTS);
    expect(r.grounded).toHaveLength(1);
    expect(r.rejected[0]!.reasons).toContain("duplicate-fact");
  });
});

describe("verifyFactEntry — re-verification of a written facts.yaml", () => {
  const entry = (over: Partial<FactEntry>): FactEntry => ({
    fact: "nyha_class",
    value: "III",
    status: "confirmed",
    confidence: 0.92,
    extractedBy: "llm/claude-opus-5",
    source: { doc: "echo-x", quote: "symptoms consistent with NYHA class III heart failure" },
    reviewedBy: "e.cuyugan",
    reviewedAt: "2026-08-20T10:00:00Z",
    ...over,
  });

  it("passes a confirmed, still-grounded fact", () => {
    expect(verifyFactEntry(entry({}), ctx)).toEqual([]);
  });

  it("catches a quote that no longer matches its note", () => {
    const r = verifyFactEntry(entry({ source: { doc: "echo-x", quote: "NYHA class IV heart failure" } }), ctx);
    expect(r[0]!.reasons).toContain("quote-not-found");
  });

  it("catches a hand-edited value that broke the declared type", () => {
    const r = verifyFactEntry(entry({ fact: "lvef", value: "thirty two", unit: "%", source: { doc: "echo-x", quote: "LVEF 32%" } }), ctx);
    expect(r[0]!.reasons).toContain("type-mismatch");
  });

  it("rejects coercible scalar strings in persisted files so validation matches compilation", () => {
    const numeric = verifyFactEntry(
      entry({ fact: "lvef", value: "32", unit: "%", source: { doc: "echo-x", quote: "LVEF 32%" } }),
      ctx,
    );
    const boolean = verifyFactEntry(
      entry({
        fact: "on_anticoagulant",
        value: "false",
        source: { doc: "echo-x", quote: "no anticoagulant use since the GI bleed" },
      }),
      ctx,
    );
    expect(numeric[0]!.reasons).toContain("type-mismatch");
    expect(boolean[0]!.reasons).toContain("type-mismatch");
  });

  it("checks the type of a pipeline fact but demands no quote", () => {
    expect(verifyFactEntry({ fact: "age", value: 71, unit: "years", status: "confirmed", extractedBy: "pipeline" }, ctx)).toEqual([]);
    const bad = verifyFactEntry({ fact: "age", value: 71, unit: "months", status: "confirmed", extractedBy: "pipeline" }, ctx);
    expect(bad[0]!.reasons).toContain("unit-mismatch");
  });

  it("accepts a code-valued pipeline fact whose systems are declared", () => {
    const e: FactEntry = {
      fact: "medications",
      value: [{ code: "warfarin", system: "rxnorm", daysAgo: 5 }],
      status: "confirmed",
      extractedBy: "pipeline",
    };
    expect(verifyFactEntry(e, ctx)).toEqual([]);
  });

  it("rejects a code-valued fact using an undeclared system", () => {
    const e: FactEntry = {
      fact: "medications",
      value: [{ code: "warfarin", system: "local-formulary" }],
      status: "confirmed",
      extractedBy: "pipeline",
    };
    expect(verifyFactEntry(e, ctx)[0]!.reasons).toContain("unknown-code-system");
  });

  it("keeps a human edit honest: quote still has to match if one is kept", () => {
    const e = entry({ extractedBy: "human", value: "II", confidence: undefined });
    expect(verifyFactEntry(e, ctx)).toEqual([]);
    const bad = entry({ extractedBy: "human", value: "II", confidence: undefined, source: { doc: "echo-x", quote: "invented" } });
    expect(verifyFactEntry(bad, ctx)[0]!.reasons).toContain("quote-not-found");
  });

  it("allows a human-entered fact with no source at all", () => {
    expect(verifyFactEntry({ fact: "nyha_class", value: "II", status: "confirmed", extractedBy: "human", reviewedBy: "e.cuyugan", reviewedAt: "2026-08-20T10:00:00Z" }, ctx)).toEqual([]);
  });

  it("still verifies a rejected entry's fact name so typos surface", () => {
    const r = verifyFactEntry(entry({ fact: "nyha_klass", status: "rejected" }), ctx);
    expect(r[0]!.reasons).toContain("unknown-fact");
  });
});
