/**
 * Adversarial probes — mess/normalize round trip and the code-list dedup
 * (attack surface 2, "duplicate entries after mess-injection dedup").
 *
 * These two stages produce corpus/normalized, which is what `rules screen`
 * and the workbench funnel count. A defect here is a defect in every number
 * the demo shows.
 */
import { describe, it, expect } from "vitest";
import { messPatient } from "../../scripts/lib/mess.js";
import { normalizePatient } from "../../scripts/lib/normalize.js";
import { evalCondition } from "../../src/core/evaluator.js";
import type { Condition, PatientFacts } from "../../src/core/schema.js";

const washout: Condition = {
  fact: "medications",
  op: "anyWithin",
  codes: { system: "rxnorm", values: ["855332"] },
  windowDays: 90,
};

describe("H1 — an undated medication stays undated (REGRESSION: duplicate-med invented a recency)", () => {
  // mess.ts used to write `daysAgo: Math.max(0, (src.daysAgo ?? 0) + r.int(0, 6))`,
  // so an undated row was treated as "0 days ago" and its copy stamped with a
  // date inside the last week. The mess injector is allowed to corrupt data; it
  // is not allowed to add information.
  const undated: PatientFacts = {
    patient: "UNDATED-MED",
    facts: { age: 70, medications: [{ code: "855332", system: "rxnorm" }] },
  };

  it("the engine's honest 'unknown' survives mess + normalize", () => {
    expect(evalCondition(washout, undated).result).toBe("unknown");

    // Find a seed that draws the duplicate (rate 0.35), then normalize.
    let messed: PatientFacts | undefined;
    for (let seed = 1; seed < 200 && messed === undefined; seed++) {
      const { patient, log } = messPatient(undated, seed);
      if (log.some((r) => r.op === "duplicate-med")) messed = patient;
    }
    expect(messed).toBeDefined();
    const meds = messed!.facts["medications"] as { code: string; daysAgo?: number }[];
    expect(meds.length).toBeGreaterThan(1);
    expect(meds.every((m) => m.daysAgo === undefined)).toBe(true);

    const { patient: clean } = normalizePatient(messed!);
    const finalMeds = clean.facts["medications"] as { code: string; daysAgo?: number }[];
    expect(finalMeds).toHaveLength(1);
    expect(finalMeds[0]!.daysAgo).toBeUndefined();
    // The washout exclusion cannot fire on evidence that never existed.
    expect(evalCondition(washout, clean).result).toBe("unknown");
  });

  it("a DATED row still gets its jitter — the corruption itself is intact", () => {
    const dated: PatientFacts = {
      patient: "DATED-MED",
      facts: { age: 70, medications: [{ code: "855332", system: "rxnorm", daysAgo: 40 }] },
    };
    let messed: PatientFacts | undefined;
    for (let seed = 1; seed < 200 && messed === undefined; seed++) {
      const { patient, log } = messPatient(dated, seed);
      if (log.some((r) => r.op === "duplicate-med")) messed = patient;
    }
    const meds = messed!.facts["medications"] as { daysAgo?: number }[];
    expect(meds.length).toBeGreaterThan(1);
    expect(meds.every((m) => m.daysAgo !== undefined && m.daysAgo >= 40 && m.daysAgo <= 46)).toBe(true);
  });
});

describe("H2 — normalize dedups on (system, code) (REGRESSION: `code` alone deleted a diagnosis)", () => {
  // The evaluator's codeMatch requires system AND code to match, so a dedup
  // keyed on `code` alone could delete the very row a criterion looks for.
  const twoSystems: PatientFacts = {
    patient: "COLLIDING-CODES",
    facts: {
      conditions: [
        { code: "49436004", system: "snomed", daysAgo: 200 }, // atrial fibrillation
        { code: "49436004", system: "site-local", daysAgo: 3 }, // unrelated local code, same digits
      ],
    },
  };

  const afib: Condition = { fact: "conditions", op: "in", codes: { system: "snomed", values: ["49436004"] } };

  it("both systems survive, and the diagnosis the exclusion looks for is still there", () => {
    expect(evalCondition(afib, twoSystems).result).toBe("true");
    const { patient: clean, log } = normalizePatient(twoSystems);
    expect(log.some((r) => r.kind === "deduplicated")).toBe(false);
    expect(clean.facts["conditions"]).toEqual([
      { code: "49436004", system: "site-local", daysAgo: 3 },
      { code: "49436004", system: "snomed", daysAgo: 200 },
    ]);
    expect(evalCondition(afib, clean).result).toBe("true");
  });

  it("a true duplicate — same system, same code — still collapses", () => {
    const dupes: PatientFacts = {
      patient: "REAL-DUPES",
      facts: {
        conditions: [
          { code: "49436004", system: "snomed", daysAgo: 200 },
          { code: "49436004", system: "snomed", daysAgo: 12 },
        ],
      },
    };
    const { patient: clean, log } = normalizePatient(dupes);
    expect(log.some((r) => r.kind === "deduplicated")).toBe(true);
    expect(clean.facts["conditions"]).toEqual([{ code: "49436004", system: "snomed", daysAgo: 12 }]);
  });
});

describe("H3 — dedup keeps the most recent date, which is the right call (attack failed)", () => {
  it("a dated duplicate beats an undated row, and the earliest date wins", () => {
    const p: PatientFacts = {
      patient: "DUPES",
      facts: {
        medications: [
          { code: "855332", system: "rxnorm", daysAgo: 400 },
          { code: "855332", system: "rxnorm", daysAgo: 12 },
        ],
      },
    };
    const { patient: clean } = normalizePatient(p);
    expect((clean.facts["medications"] as { daysAgo?: number }[])[0]!.daysAgo).toBe(12);
    expect(evalCondition(washout, clean).result).toBe("true");
  });
});
