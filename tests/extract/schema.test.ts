import { describe, it, expect } from "vitest";
import { parseFactsFile } from "../../src/extract/schema.js";

const VALID = `
patient: SYN-042
asOf: 2026-08-20
facts:
  - fact: nyha_class
    value: III
    status: proposed
    confidence: 0.92
    extractedBy: llm/claude-opus-5
    source:
      doc: echo-2026-03-12
      quote: "symptoms consistent with NYHA class III heart failure"
    reviewedBy: null
  - fact: lvef
    value: 32
    unit: "%"
    status: confirmed
    confidence: 0.97
    extractedBy: llm/claude-opus-5
    source:
      doc: echo-2026-03-12
      quote: "LVEF 32%"
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T10:00:00Z
  - fact: age
    value: 71
    status: confirmed
    extractedBy: pipeline
    reviewedBy: null
`;

describe("parseFactsFile", () => {
  it("parses the spec's facts.yaml shape", () => {
    const f = parseFactsFile(VALID);
    expect(f.patient).toBe("SYN-042");
    expect(f.facts).toHaveLength(3);
    expect(f.facts[0]!.status).toBe("proposed");
    expect(f.facts[0]!.source!.quote).toContain("NYHA class III");
    expect(f.facts[1]!.unit).toBe("%");
    expect(f.facts[2]!.extractedBy).toBe("pipeline");
  });

  it("keeps reviewedBy null on a proposed fact", () => {
    expect(parseFactsFile(VALID).facts[0]!.reviewedBy).toBeNull();
  });

  it("accepts a code-valued fact from the deterministic pipeline", () => {
    const f = parseFactsFile(`
patient: SYN-001
facts:
  - fact: medications
    value:
      - { code: warfarin, system: rxnorm, daysAgo: 5 }
    status: confirmed
    extractedBy: pipeline
`);
    expect(f.facts[0]!.value).toEqual([{ code: "warfarin", system: "rxnorm", daysAgo: 5 }]);
  });

  it("accepts a measuredAt + validWithinDays window declaration", () => {
    const f = parseFactsFile(`
patient: SYN-001
facts:
  - fact: egfr
    value: 58
    unit: "mL/min/1.73m2"
    measuredAt: 2026-01-04
    validWithinDays: 90
    status: confirmed
    extractedBy: pipeline
`);
    expect(f.facts[0]!.measuredAt).toBe("2026-01-04");
    expect(f.facts[0]!.validWithinDays).toBe(90);
  });

  it("rejects an unknown status", () => {
    expect(() => parseFactsFile(VALID.replace("status: proposed", "status: maybe"))).toThrow(
      /invalid facts file.*status/s,
    );
  });

  it("rejects an unknown extractedBy tier", () => {
    expect(() => parseFactsFile(VALID.replace("extractedBy: pipeline", "extractedBy: intern"))).toThrow(
      /extractedBy/,
    );
  });

  it("accepts any llm/<model> tag", () => {
    const f = parseFactsFile(VALID.replace(/llm\/claude-opus-5/g, "llm/claude-sonnet-5"));
    expect(f.facts[0]!.extractedBy).toBe("llm/claude-sonnet-5");
  });

  it("rejects confidence outside 0..1", () => {
    expect(() => parseFactsFile(VALID.replace("confidence: 0.92", "confidence: 92"))).toThrow(/confidence/);
  });

  it("rejects an llm-extracted fact with no source", () => {
    const bad = `
patient: SYN-042
facts:
  - fact: nyha_class
    value: III
    status: proposed
    confidence: 0.9
    extractedBy: llm/claude-opus-5
`;
    expect(() => parseFactsFile(bad)).toThrow(/source/);
  });

  it("rejects an llm-extracted fact with no confidence", () => {
    const bad = `
patient: SYN-042
facts:
  - fact: nyha_class
    value: III
    status: proposed
    extractedBy: llm/claude-opus-5
    source: { doc: echo-2026-03-12, quote: "NYHA class III" }
`;
    expect(() => parseFactsFile(bad)).toThrow(/confidence/);
  });

  it("rejects a confirmed fact with no reviewer", () => {
    const bad = VALID.replace("reviewedBy: e.cuyugan", "reviewedBy: null");
    expect(() => parseFactsFile(bad)).toThrow(/reviewedBy/);
  });

  it("rejects a confirmed fact with a reviewer but no timestamp", () => {
    const bad = VALID.replace("    reviewedAt: 2026-08-20T10:00:00Z\n", "");
    expect(() => parseFactsFile(bad)).toThrow(/reviewedAt/);
  });

  it("rejects a proposed fact that claims a reviewer", () => {
    const bad = VALID.replace(
      "    reviewedBy: null\n  - fact: lvef",
      "    reviewedBy: e.cuyugan\n  - fact: lvef",
    );
    expect(() => parseFactsFile(bad)).toThrow(/reviewedBy/);
  });

  it("rejects unknown keys (no silent typos)", () => {
    expect(() => parseFactsFile(VALID.replace("confidence: 0.92", "confidance: 0.92"))).toThrow(
      /confidance|Unrecognized/,
    );
  });

  it("rejects duplicate entries for the same fact name", () => {
    const bad = `
patient: SYN-001
facts:
  - { fact: lvef, value: 32, unit: "%", status: confirmed, extractedBy: pipeline }
  - { fact: lvef, value: 33, unit: "%", status: confirmed, extractedBy: pipeline }
`;
    expect(() => parseFactsFile(bad)).toThrow(/duplicate/);
  });

  it("allows a duplicate fact name when one entry is rejected", () => {
    const ok = `
patient: SYN-001
facts:
  - fact: lvef
    value: 45
    unit: "%"
    status: rejected
    confidence: 0.5
    extractedBy: llm/claude-opus-5
    source: { doc: echo-2026-01-22, quote: "EF visually estimated at 40-45%" }
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T10:00:00Z
  - { fact: lvef, value: 32, unit: "%", status: confirmed, extractedBy: pipeline }
`;
    expect(parseFactsFile(ok).facts).toHaveLength(2);
  });

  it("reports the offending path in the error message", () => {
    expect(() => parseFactsFile(VALID.replace("value: 32", "value: {}"))).toThrow(/facts\.1\.value/);
  });

  it("rejects a file with no patient id", () => {
    expect(() => parseFactsFile("facts: []")).toThrow(/patient/);
  });
});
