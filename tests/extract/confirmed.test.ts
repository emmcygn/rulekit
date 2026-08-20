import { describe, it, expect } from "vitest";
import { parseFactsFile } from "../../src/extract/schema.js";
import { confirmedFactsToPatient, pendingReview } from "../../src/extract/confirmed.js";
import type { FactEntry, FactsFile } from "../../src/extract/schema.js";

const FILE = parseFactsFile(`
patient: SYN-042
facts:
  - fact: age
    value: 71
    unit: years
    status: confirmed
    extractedBy: pipeline
  - fact: egfr
    value: 58
    unit: mL/min/1.73m2
    status: confirmed
    extractedBy: pipeline
  - fact: nyha_class
    value: III
    status: confirmed
    confidence: 0.94
    extractedBy: llm/claude-opus-5
    source: { doc: echo-2026-03-12, quote: "NYHA class III" }
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T10:00:00Z
  - fact: lvef
    value: 42
    unit: "%"
    status: proposed
    confidence: 0.71
    extractedBy: llm/claude-opus-5
    source: { doc: echo-2026-01-22, quote: "EF visually estimated at 40-45%" }
    reviewedBy: null
  - fact: on_anticoagulant
    value: true
    status: rejected
    confidence: 0.55
    extractedBy: llm/claude-opus-5
    source: { doc: clinic-2026-04-02, quote: "no anticoagulant use" }
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T10:02:00Z
  - fact: potassium
    value: 4.3
    unit: mmol/L
    status: confirmed
    extractedBy: human
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T10:04:00Z
`);

describe("confirmedFactsToPatient — the rulekit invariant (spec G11)", () => {
  const patient = confirmedFactsToPatient(FILE);

  it("keeps the patient id", () => {
    expect(patient.patient).toBe("SYN-042");
  });

  it("admits deterministic pipeline facts", () => {
    expect(patient.facts.age).toBe(71);
    expect(patient.facts.egfr).toBe(58);
  });

  it("admits human-confirmed llm facts", () => {
    expect(patient.facts.nyha_class).toBe("III");
  });

  it("admits human-entered facts", () => {
    expect(patient.facts.potassium).toBe(4.3);
  });

  it("NEVER admits a proposed fact", () => {
    expect(patient.facts).not.toHaveProperty("lvef");
  });

  it("NEVER admits a rejected fact", () => {
    expect(patient.facts).not.toHaveProperty("on_anticoagulant");
  });

  it("admits exactly the four decided facts and nothing else", () => {
    expect(Object.keys(patient.facts).sort()).toEqual(["age", "egfr", "nyha_class", "potassium"]);
  });

  it("drops a pipeline fact a human explicitly rejected", () => {
    const f: FactsFile = {
      patient: "SYN-1",
      facts: [
        {
          fact: "egfr",
          value: 58,
          unit: "mL/min/1.73m2",
          status: "rejected",
          extractedBy: "pipeline",
          reviewedBy: "e.cuyugan",
          reviewedAt: "2026-08-20T10:00:00Z",
        },
      ],
    };
    expect(confirmedFactsToPatient(f).facts).toEqual({});
  });

  it("cannot be handed a proposed pipeline fact — the state is unrepresentable", () => {
    // 'pipeline or confirmed' only reads unambiguously because a deterministic
    // fact can never be 'proposed'. The schema is what makes that true.
    expect(() =>
      parseFactsFile(`
patient: SYN-1
facts:
  - { fact: egfr, value: 58, unit: mL/min/1.73m2, status: proposed, extractedBy: pipeline }
`),
    ).toThrow(/never 'proposed'/);
  });

  it("carries code-valued facts through unchanged", () => {
    const f: FactsFile = {
      patient: "SYN-1",
      facts: [
        {
          fact: "medications",
          value: [{ code: "warfarin", system: "rxnorm", daysAgo: 5 }],
          status: "confirmed",
          extractedBy: "pipeline",
        },
      ],
    };
    expect(confirmedFactsToPatient(f).facts.medications).toEqual([{ code: "warfarin", system: "rxnorm", daysAgo: 5 }]);
  });

  it("throws rather than silently picking a winner on conflicting live entries", () => {
    // parseFactsFile blocks this, so it can only arrive from code — and a
    // silent last-write-wins here would be an unexplainable verdict.
    const dup = (value: number): FactEntry => ({
      fact: "egfr",
      value,
      unit: "mL/min/1.73m2",
      status: "confirmed",
      extractedBy: "pipeline",
    });
    const f: FactsFile = { patient: "SYN-1", facts: [dup(58), dup(41)] };
    expect(() => confirmedFactsToPatient(f)).toThrow(/conflicting.*egfr/i);
  });

  it("tolerates a byte-identical duplicate", () => {
    const same: FactEntry = { fact: "egfr", value: 58, unit: "mL/min/1.73m2", status: "confirmed", extractedBy: "pipeline" };
    expect(confirmedFactsToPatient({ patient: "SYN-1", facts: [same, { ...same }] }).facts.egfr).toBe(58);
  });

  it("is a pure read — it does not mutate the facts file", () => {
    const before = JSON.stringify(FILE);
    confirmedFactsToPatient(FILE);
    expect(JSON.stringify(FILE)).toBe(before);
  });

  it("no confirmed fact can be conjured by flipping only extractedBy", () => {
    // The gate is (pipeline OR confirmed) AND NOT rejected — not "llm means no".
    const f: FactsFile = {
      patient: "SYN-1",
      facts: [
        {
          fact: "nyha_class",
          value: "III",
          status: "proposed",
          confidence: 0.99,
          extractedBy: "llm/claude-opus-5",
          source: { doc: "d", quote: "q" },
          reviewedBy: null,
        },
      ],
    };
    expect(confirmedFactsToPatient(f).facts).toEqual({});
  });
});

describe("pendingReview — the 'not evaluable, pending review' sub-state", () => {
  it("counts and lists the proposed facts", () => {
    const p = pendingReview(FILE);
    expect(p.count).toBe(1);
    expect(p.facts).toEqual(["lvef"]);
  });

  it("reports zero once everything is decided", () => {
    expect(pendingReview({ patient: "SYN-1", facts: [] })).toEqual({ count: 0, facts: [] });
  });
});
