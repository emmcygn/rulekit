import { describe, expect, it } from "vitest";
import { bundleEntries, daysBetween, flattenBundle, isHfPatient, mutateForHf } from "../../scripts/lib/flatten.js";
import type { CodeEntry } from "../../src/core/schema.js";

const REF = "2026-06-30";

/**
 * A hand-built bundle in the exact shape Synthea emits. The latest event is
 * 2019-09-10, i.e. ~7 years before the reference date, which is precisely why
 * flatten shifts the timeline (see the flatten header).
 */
const bundle = {
  resourceType: "Bundle",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "5cbc121b-cd71-4428-b8b7-31e53eba8184",
        birthDate: "1949-09-10",
        gender: "male",
      },
    },
    {
      resource: {
        resourceType: "Condition",
        clinicalStatus: { coding: [{ code: "active" }] },
        code: { coding: [{ system: "http://snomed.info/sct", code: "88805009", display: "Chronic congestive heart failure (disorder)" }] },
        onsetDateTime: "2017-03-01T09:00:00-05:00",
      },
    },
    {
      resource: {
        resourceType: "Condition",
        clinicalStatus: { coding: [{ code: "active" }] },
        code: { coding: [{ system: "http://snomed.info/sct", code: "53741008", display: "Coronary Heart Disease" }] },
        onsetDateTime: "2016-01-05T09:00:00-05:00",
      },
    },
    {
      resource: {
        resourceType: "MedicationRequest",
        status: "active",
        medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "855332", display: "Warfarin Sodium 5 MG Oral Tablet" }] },
        authoredOn: "2019-08-01T07:22:41-04:00",
      },
    },
    {
      // An older duplicate of the same drug: flatten keeps the most recent only.
      resource: {
        resourceType: "MedicationRequest",
        status: "stopped",
        medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "855332", display: "Warfarin Sodium 5 MG Oral Tablet" }] },
        authoredOn: "2018-02-01T07:22:41-05:00",
      },
    },
    {
      // Ancient med, outside the recency window: dropped.
      resource: {
        resourceType: "MedicationRequest",
        status: "stopped",
        medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "310965", display: "Ibuprofen 200 MG Oral Tablet" }] },
        authoredOn: "2005-05-21T07:22:41-04:00",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "38483-4", display: "Creatinine" }] },
        effectiveDateTime: "2018-09-10T06:00:00-04:00",
        valueQuantity: { value: 3.1, unit: "mg/dL" },
      },
    },
    {
      // Newer creatinine wins.
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "38483-4", display: "Creatinine" }] },
        effectiveDateTime: "2019-09-10T06:00:00-04:00",
        valueQuantity: { value: 1.24, unit: "mg/dL" },
      },
    },
    {
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "33914-3", display: "Estimated Glomerular Filtration Rate" }] },
        effectiveDateTime: "2019-09-10T06:00:00-04:00",
        valueQuantity: { value: 54.2, unit: "mL/min/{1.73_m2}" },
      },
    },
    {
      // Blood pressure arrives as a panel with two components.
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "55284-4", display: "Blood Pressure" }] },
        effectiveDateTime: "2019-09-10T06:00:00-04:00",
        component: [
          { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] }, valueQuantity: { value: 78, unit: "mm[Hg]" } },
          { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] }, valueQuantity: { value: 132, unit: "mm[Hg]" } },
        ],
      },
    },
    {
      // Not in LAB_DEFS: dropped rather than smuggled into the fact model.
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "72514-3", display: "Pain severity" }] },
        effectiveDateTime: "2019-09-10T06:00:00-04:00",
        valueQuantity: { value: 3, unit: "{score}" },
      },
    },
    {
      // Non-quantity value: dropped.
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "72166-2", display: "Tobacco smoking status NHIS" }] },
        effectiveDateTime: "2019-09-10T06:00:00-04:00",
        valueCodeableConcept: { coding: [{ code: "266919005", display: "Never smoker" }] },
      },
    },
  ],
};

describe("daysBetween", () => {
  it("counts whole days between ISO dates", () => {
    expect(daysBetween("2026-06-01", "2026-06-30")).toBe(29);
    expect(daysBetween("2026-06-30", "2026-06-01")).toBe(-29);
    expect(daysBetween("2019-09-10T06:00:00-04:00", "2019-09-11T06:00:00-04:00")).toBe(1);
  });
});

describe("bundleEntries", () => {
  it("selects by resourceType", () => {
    expect(bundleEntries(bundle, "Observation")).toHaveLength(6);
    expect(bundleEntries(bundle, "Patient")).toHaveLength(1);
    expect(bundleEntries({}, "Patient")).toHaveLength(0);
  });
});

describe("flattenBundle", () => {
  const facts = flattenBundle(bundle, { referenceDate: REF, jitterDays: 10 }).facts;

  it("derives a stable patient id from the FHIR Patient.id", () => {
    expect(flattenBundle(bundle, { referenceDate: REF }).patient).toBe("SYN-5CBC121B");
  });

  it("ages the patient against the reference date, on the shifted timeline", () => {
    // Latest event 2019-09-10 shifts to 10 days before 2026-06-30, so the
    // patient's age is their age at that event (70) — not their 2026 age.
    expect(facts.age).toBe(70);
  });

  it("carries sex through", () => {
    expect(facts.sex).toBe("male");
  });

  it("emits conditions as SNOMED codes with recency", () => {
    const conditions = facts.conditions as CodeEntry[];
    expect(conditions.map((c) => c.code).sort()).toEqual(["53741008", "88805009"]);
    expect(conditions.every((c) => c.system === "snomed")).toBe(true);
    // 2017-03-01 is 923 days before the 2019-09-10 anchor, plus 10 days jitter.
    expect(conditions.find((c) => c.code === "88805009")?.daysAgo).toBe(933);
  });

  it("keeps only the most recent request per medication and drops stale ones", () => {
    const meds = facts.medications as CodeEntry[];
    expect(meds).toEqual([{ code: "855332", system: "rxnorm", daysAgo: 50 }]);
  });

  it("emits the latest lab per LOINC with value, unit, source code and recency", () => {
    expect(facts.lab_creatinine).toBe(1.24);
    expect(facts.lab_creatinine_unit).toBe("mg/dL");
    expect(facts.lab_creatinine_code).toBe("38483-4");
    expect(facts.lab_creatinine_days_ago).toBe(10);
    expect(facts.lab_egfr).toBe(54.2);
    expect(facts.lab_egfr_unit).toBe("mL/min/{1.73_m2}");
  });

  it("lifts blood pressure out of the panel components", () => {
    expect(facts.lab_systolic_bp).toBe(132);
    expect(facts.lab_diastolic_bp).toBe(78);
  });

  it("drops observations outside the declared fact model", () => {
    expect(Object.keys(facts).some((k) => k.includes("pain"))).toBe(false);
    expect(Object.keys(facts).some((k) => k.includes("tobacco"))).toBe(false);
  });

  it("is deterministic", () => {
    expect(flattenBundle(bundle, { referenceDate: REF })).toEqual(flattenBundle(bundle, { referenceDate: REF }));
  });
});

describe("isHfPatient", () => {
  it("detects the heart-failure SNOMED codes", () => {
    expect(isHfPatient(flattenBundle(bundle, { referenceDate: REF }))).toBe(true);
    expect(isHfPatient({ patient: "X", facts: { conditions: [{ code: "59621000", system: "snomed" }] } })).toBe(false);
  });
});

describe("mutateForHf", () => {
  const base = flattenBundle(bundle, { referenceDate: REF });
  const m = mutateForHf(base, 42).facts;

  it("adds the cardiology facts Synthea never produces", () => {
    expect(typeof m.lab_lvef).toBe("number");
    expect(m.lab_lvef_unit).toBe("%");
    expect(typeof m.hf_symptom_duration_months).toBe("number");
    expect(typeof m.index_hospital_days).toBe("number");
    expect(typeof m.hf_index_event_days_ago).toBe("number");
    expect(typeof m.lab_bnp === "number" || typeof m.lab_nt_probnp === "number").toBe(true);
  });

  it("leaves the deterministic Synthea facts untouched", () => {
    expect(m.age).toBe(base.facts.age);
    expect(m.lab_creatinine).toBe(base.facts.lab_creatinine);
  });

  it("never overwrites a cardiology fact Synthea already recorded", () => {
    const withReal = {
      patient: base.patient,
      facts: { ...base.facts, lab_lvef: 31.5, lab_lvef_days_ago: 12, lab_nt_probnp: 1120.65 },
    };
    const out = mutateForHf(withReal, 42).facts;
    expect(out.lab_lvef).toBe(31.5);
    expect(out.lab_lvef_days_ago).toBe(12);
    expect(out.lab_nt_probnp).toBe(1120.65);
    expect(out.lab_bnp).toBeUndefined();
  });

  it("is a pure function of the seed", () => {
    expect(mutateForHf(base, 42)).toEqual(mutateForHf(base, 42));
    expect(mutateForHf(base, 43)).not.toEqual(mutateForHf(base, 42));
  });
});
