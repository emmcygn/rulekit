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

describe("H1 — duplicate-med invents a recency for an undated medication", () => {
  // mess.ts:175 — copies.push({ ...src, daysAgo: Math.max(0, (src.daysAgo ?? 0) + r.int(0, 6)) })
  // An undated row is treated as "0 days ago" and the copy is stamped with a
  // date between today and six days ago.
  const undated: PatientFacts = {
    patient: "UNDATED-MED",
    facts: { age: 70, medications: [{ code: "855332", system: "rxnorm" }] },
  };

  it("the engine's honest 'unknown' becomes a definite 'yes, this week'", () => {
    expect(evalCondition(washout, undated).result).toBe("unknown");

    // Find a seed that draws the duplicate (rate 0.35), then normalize.
    let messed: PatientFacts | undefined;
    for (let seed = 1; seed < 200 && messed === undefined; seed++) {
      const { patient, log } = messPatient(undated, seed);
      if (log.some((r) => r.op === "duplicate-med")) messed = patient;
    }
    expect(messed).toBeDefined();
    const meds = messed!.facts["medications"] as { code: string; daysAgo?: number }[];
    expect(meds.some((m) => m.daysAgo !== undefined && m.daysAgo <= 6)).toBe(true);

    // normalize's dedup then keeps the row with the SMALLEST daysAgo, i.e. the
    // fabricated one, and drops the undated original.
    const { patient: clean } = normalizePatient(messed!);
    const finalMeds = clean.facts["medications"] as { code: string; daysAgo?: number }[];
    expect(finalMeds).toHaveLength(1);
    expect(finalMeds[0]!.daysAgo).toBeLessThanOrEqual(6);
    // BUG: a washout exclusion now fires on evidence that never existed.
    expect(evalCondition(washout, clean).result).toBe("true");
  });
});

describe("H2 — normalize dedups code lists by `code` alone, ignoring `system`", () => {
  // normalize.ts:156 — byCode.set(e.code, e) — while the evaluator's codeMatch
  // requires system AND code to match.
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

  it("the SNOMED row is deleted in favour of the more recent foreign-system row", () => {
    expect(evalCondition(afib, twoSystems).result).toBe("true");
    const { patient: clean, log } = normalizePatient(twoSystems);
    expect(log.some((r) => r.kind === "deduplicated")).toBe(true);
    expect((clean.facts["conditions"] as { system: string }[])).toEqual([{ code: "49436004", system: "site-local", daysAgo: 3 }]);
    // BUG: the diagnosis the exclusion is looking for has been normalized away.
    expect(evalCondition(afib, clean).result).toBe("false");
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
