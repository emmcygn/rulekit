import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { parsePatient } from "../../src/core/schema.js";
import type { CodeEntry, PatientFacts } from "../../src/core/schema.js";
import { DEFAULT_RATES, labSlugsOf, messPatient, sloppyUnitFor } from "../../scripts/lib/mess.js";

const clean = (n: number): PatientFacts => ({
  patient: `SYN-TEST${String(n).padStart(3, "0")}`,
  facts: {
    age: 60 + (n % 30),
    sex: n % 2 === 0 ? "male" : "female",
    conditions: [
      { code: "88805009", system: "snomed", daysAgo: 400 + n },
      { code: "53741008", system: "snomed", daysAgo: 900 + n },
    ],
    medications: [
      { code: "855332", system: "rxnorm", daysAgo: 10 + (n % 50) },
      { code: "316672", system: "rxnorm", daysAgo: 40 + (n % 50) },
    ],
    lab_creatinine: 1.24,
    lab_creatinine_unit: "mg/dL",
    lab_creatinine_code: "38483-4",
    lab_creatinine_days_ago: 12,
    lab_egfr: 54.2,
    lab_egfr_unit: "mL/min/{1.73_m2}",
    lab_egfr_code: "33914-3",
    lab_egfr_days_ago: 12,
    lab_lvef: 32,
    lab_lvef_unit: "%",
    lab_lvef_code: "10230-1",
    lab_lvef_days_ago: 40,
    lab_hemoglobin: 13.1,
    lab_hemoglobin_unit: "g/dL",
    lab_hemoglobin_code: "718-7",
    lab_hemoglobin_days_ago: 12,
  },
});

const cohort = Array.from({ length: 60 }, (_, i) => clean(i));

describe("labSlugsOf", () => {
  it("finds the lab slugs carried by a patient", () => {
    expect(labSlugsOf(clean(0).facts).sort()).toEqual(["creatinine", "egfr", "hemoglobin", "lvef"]);
  });

  it("ignores the satellite facts", () => {
    expect(labSlugsOf({ lab_creatinine_unit: "mg/dL" })).toEqual([]);
  });
});

describe("sloppyUnitFor", () => {
  it("only offers spellings the normalize table can undo", () => {
    expect(sloppyUnitFor("mg/dL")).toContain("mg/dl");
    expect(sloppyUnitFor("mm[Hg]")).toContain("mmHg");
    expect(sloppyUnitFor("nope")).toEqual([]);
  });
});

describe("messPatient", () => {
  it("is deterministic for a given seed", () => {
    expect(messPatient(clean(1), 42)).toEqual(messPatient(clean(1), 42));
  });

  it("produces different corruption for a different seed", () => {
    const a = JSON.stringify(cohort.map((p) => messPatient(p, 42).patient));
    const b = JSON.stringify(cohort.map((p) => messPatient(p, 43).patient));
    expect(a).not.toEqual(b);
  });

  it("does not depend on how many patients ran before it", () => {
    const solo = messPatient(cohort[7] as PatientFacts, 42);
    const inOrder = cohort.map((p) => messPatient(p, 42))[7];
    expect(inOrder).toEqual(solo);
  });

  it("leaves the input untouched", () => {
    const input = clean(3);
    const before = JSON.stringify(input);
    messPatient(input, 42);
    expect(JSON.stringify(input)).toEqual(before);
  });

  it("still emits something the PatientFacts schema accepts", () => {
    for (const p of cohort) {
      const messy = messPatient(p, 42).patient;
      expect(() => parsePatient(stringify(messy))).not.toThrow();
    }
  });

  it("keeps the patient id, so stages can be joined", () => {
    expect(messPatient(cohort[2] as PatientFacts, 42).patient.patient).toBe(cohort[2]?.patient);
  });

  it("applies every corruption somewhere across a 60-patient cohort", () => {
    const ops = new Set(cohort.flatMap((p) => messPatient(p, 42).log.map((r) => r.op)));
    expect([...ops].sort()).toEqual(
      ["backdate", "convert-unit", "drop-unit", "duplicate-med", "local-code", "sloppy-unit", "stringify-value"].sort(),
    );
  });

  it("drops units by deleting the unit fact", () => {
    const results = cohort.map((p) => messPatient(p, 42));
    const hit = results.find((r) => r.log.some((l) => l.op === "drop-unit"));
    const dropped = hit?.log.find((l) => l.op === "drop-unit");
    expect(hit?.patient.facts[`${dropped?.target}_unit`]).toBeUndefined();
    expect(hit?.patient.facts[`${dropped?.target}`]).toBeDefined();
  });

  it("replaces LOINC with a site-local code and renames the fact with it", () => {
    const results = cohort.map((p) => messPatient(p, 42));
    const hit = results.find((r) => r.log.some((l) => l.op === "local-code"));
    const rec = hit?.log.find((l) => l.op === "local-code");
    const code = hit?.patient.facts[`${rec?.target}_code`];
    expect(typeof code).toBe("string");
    expect(String(code)).not.toMatch(/^\d+-\d$/); // no longer a LOINC
  });

  it("stringifies some lab values into forms a number parser rejects", () => {
    const results = cohort.map((p) => messPatient(p, 42));
    const hit = results.find((r) => r.log.some((l) => l.op === "stringify-value"));
    const rec = hit?.log.find((l) => l.op === "stringify-value");
    const value = hit?.patient.facts[String(rec?.target)];
    expect(typeof value).toBe("string");
    expect(Number.isFinite(Number(value))).toBe(false);
  });

  it("duplicates medication entries rather than inventing new drugs", () => {
    const results = cohort.map((p, i) => ({ before: cohort[i] as PatientFacts, after: messPatient(p, 42) }));
    const hit = results.find((r) => r.after.log.some((l) => l.op === "duplicate-med"));
    const before = hit?.before.facts["medications"] as CodeEntry[];
    const after = hit?.after.patient.facts["medications"] as CodeEntry[];
    expect(after.length).toBeGreaterThan(before.length);
    expect(new Set(after.map((m) => m.code))).toEqual(new Set(before.map((m) => m.code)));
  });

  it("backdates timestamps, never forward-dates them", () => {
    for (const p of cohort) {
      const messy = messPatient(p, 42);
      for (const rec of messy.log.filter((l) => l.op === "backdate")) {
        const key = rec.target;
        const after = messy.patient.facts[key];
        const before = p.facts[key];
        if (typeof after === "number" && typeof before === "number") expect(after).toBeGreaterThan(before);
      }
    }
  });

  it("honours a rate of zero", () => {
    const off = Object.fromEntries(Object.keys(DEFAULT_RATES).map((k) => [k, 0]));
    const messy = messPatient(clean(5), 42, off);
    expect(messy.log).toEqual([]);
    expect(messy.patient).toEqual(clean(5));
  });
});
