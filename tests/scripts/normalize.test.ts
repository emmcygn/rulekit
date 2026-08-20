import { describe, expect, it } from "vitest";
import type { CodeEntry, FactValue, PatientFacts } from "../../src/core/schema.js";
import { messPatient } from "../../scripts/lib/mess.js";
import type { MessRates } from "../../scripts/lib/mess.js";
import { normalizePatient } from "../../scripts/lib/normalize.js";

const patient = (facts: Record<string, FactValue>): PatientFacts => ({ patient: "SYN-TEST001", facts });
const norm = (facts: Record<string, FactValue>) => normalizePatient(patient(facts));

describe("unit normalization", () => {
  it("repairs a sloppy spelling without touching the value", () => {
    const { patient: out } = norm({ lab_creatinine: 1.24, lab_creatinine_unit: "mg/dl", lab_creatinine_code: "38483-4" });
    expect(out.facts.lab_creatinine).toBe(1.24);
    expect(out.facts.lab_creatinine_unit).toBe("mg/dL");
  });

  it("converts an analyte-scoped unit and the value with it", () => {
    const { patient: out, log } = norm({ lab_creatinine: 110, lab_creatinine_unit: "umol/L", lab_creatinine_code: "38483-4" });
    expect(out.facts.lab_creatinine).toBeCloseTo(1.24, 2);
    expect(out.facts.lab_creatinine_unit).toBe("mg/dL");
    expect(log.some((l) => l.kind === "converted")).toBe(true);
  });

  it("does not apply another analyte's conversion factor", () => {
    // umol/L -> mg/dL is scoped to creatinine; glucose in umol/L is not
    // silently multiplied by creatinine's molar mass, it is quarantined.
    const { patient: out, log } = norm({ lab_glucose: 110, lab_glucose_unit: "umol/L", lab_glucose_code: "2339-0" });
    expect(out.facts.lab_glucose).toBeUndefined();
    expect(out.facts.lab_glucose_raw).toBe("110 umol/L");
    expect(log.some((l) => l.kind === "unknown-unit")).toBe(true);
  });

  it("adopts the LOINC's conventional unit when the extract dropped it, and says so", () => {
    const { patient: out, log } = norm({ lab_creatinine: 1.24, lab_creatinine_code: "38483-4" });
    expect(out.facts.lab_creatinine_unit).toBe("mg/dL");
    expect(log.find((l) => l.kind === "assumed-unit")?.detail).toContain("mg/dL");
  });

  it("relabels eGFR reported without the body-surface-area qualifier", () => {
    const { patient: out } = norm({ lab_egfr: 54.2, lab_egfr_unit: "mL/min", lab_egfr_code: "33914-3" });
    expect(out.facts.lab_egfr).toBe(54.2);
    expect(out.facts.lab_egfr_unit).toBe("mL/min/{1.73_m2}");
  });
});

describe("code mapping", () => {
  it("maps a site-local code to LOINC and renames the fact to the canonical slug", () => {
    const { patient: out, log } = norm({
      lab_creat_s: 1.24,
      lab_creat_s_unit: "mg/dL",
      lab_creat_s_code: "CREAT-S",
      lab_creat_s_days_ago: 12,
    });
    expect(out.facts.lab_creatinine).toBe(1.24);
    expect(out.facts.lab_creatinine_code).toBe("38483-4");
    expect(out.facts.lab_creatinine_days_ago).toBe(12);
    expect(out.facts.lab_creat_s).toBeUndefined();
    expect(log.some((l) => l.kind === "mapped-code")).toBe(true);
  });

  it("quarantines a lab whose code cannot be resolved", () => {
    const { patient: out, log } = norm({ lab_xlab_77: 41, lab_xlab_77_unit: "U/L", lab_xlab_77_code: "XLAB-77" });
    expect(out.facts.lab_xlab_77).toBeUndefined();
    expect(out.facts.lab_xlab_77_raw).toBe("41 U/L");
    expect(log.some((l) => l.kind === "unresolvable-code")).toBe(true);
  });

  it("falls back to the fact name when no code fact survived", () => {
    const { patient: out } = norm({ lab_creatinine: 1.24, lab_creatinine_unit: "mg/dL" });
    expect(out.facts.lab_creatinine).toBe(1.24);
    expect(out.facts.lab_creatinine_code).toBe("38483-4");
  });
});

describe("value quarantine", () => {
  it("omits a non-numeric lab and keeps it as a raw note, so the engine sees unknown", () => {
    const { patient: out, log } = norm({ lab_egfr: ">60", lab_egfr_unit: "mL/min/{1.73_m2}", lab_egfr_code: "33914-3" });
    expect(out.facts.lab_egfr).toBeUndefined();
    expect(out.facts.lab_egfr_raw).toBe(">60 mL/min/{1.73_m2}");
    expect(out.facts.lab_egfr_unit).toBeUndefined();
    expect(log.some((l) => l.kind === "quarantined-value")).toBe(true);
  });

  it("keeps the recency of a quarantined lab", () => {
    const { patient: out } = norm({ lab_egfr: "cancelled", lab_egfr_code: "33914-3", lab_egfr_days_ago: 30 });
    expect(out.facts.lab_egfr_days_ago).toBe(30);
  });
});

describe("code-list hygiene", () => {
  it("collapses duplicate medication rows to the most recent", () => {
    const { patient: out, log } = norm({
      medications: [
        { code: "855332", system: "rxnorm", daysAgo: 12 },
        { code: "855332", system: "rxnorm", daysAgo: 15 },
        { code: "316672", system: "rxnorm", daysAgo: 3 },
      ],
    });
    expect(out.facts.medications).toEqual([
      { code: "316672", system: "rxnorm", daysAgo: 3 },
      { code: "855332", system: "rxnorm", daysAgo: 12 },
    ]);
    expect(log.some((l) => l.kind === "deduplicated")).toBe(true);
  });

  it("leaves an already-clean list alone", () => {
    const meds: CodeEntry[] = [{ code: "855332", system: "rxnorm", daysAgo: 12 }];
    const { log } = norm({ medications: meds });
    expect(log.some((l) => l.kind === "deduplicated")).toBe(false);
  });
});

describe("normalizePatient as a whole", () => {
  const messy = {
    lab_creat_s: 110,
    lab_creat_s_unit: "umol/L",
    lab_creat_s_code: "CREAT-S",
    lab_creat_s_days_ago: 12,
    lab_egfr: ">60",
    lab_egfr_code: "33914-3",
    age: 71,
  };

  it("is idempotent", () => {
    const once = normalizePatient(patient(messy)).patient;
    expect(normalizePatient(once).patient).toEqual(once);
  });

  it("leaves the input untouched", () => {
    const input = patient(messy);
    const before = JSON.stringify(input);
    normalizePatient(input);
    expect(JSON.stringify(input)).toEqual(before);
  });

  it("passes non-lab facts straight through", () => {
    expect(normalizePatient(patient(messy)).patient.facts.age).toBe(71);
  });
});

describe("mess -> normalize round trip", () => {
  /**
   * The reversible corruptions really are reversible: with the two
   * deliberately-lossy ops (stringified values, backdated timestamps) turned
   * off, normalizing a messed patient must reproduce the clean one.
   */
  const reversibleOnly: Partial<MessRates> = { "stringify-value": 0, backdate: 0, "duplicate-med": 0 };

  const clean = (n: number): PatientFacts => ({
    patient: `SYN-RT${String(n).padStart(3, "0")}`,
    facts: {
      age: 60 + n,
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

  it("recovers every clean fact for 40 patients", () => {
    for (let n = 0; n < 40; n++) {
      const source = clean(n);
      const messed = messPatient(source, 42, reversibleOnly).patient;
      const { patient: restored, log } = normalizePatient(messed);
      // XLAB-77 is unresolvable by design; those patients lose a lab and are
      // not expected to round-trip.
      if (log.some((l) => l.kind === "unresolvable-code")) continue;
      expect(Object.keys(restored.facts).sort()).toEqual(Object.keys(source.facts).sort());
      for (const [k, v] of Object.entries(source.facts)) {
        if (typeof v === "number") expect(restored.facts[k]).toBeCloseTo(v, 1);
        else expect(restored.facts[k]).toEqual(v);
      }
    }
  });
});
