/**
 * Stage 2 (pure half): the mess injector.
 *
 * Synthea is format-accurate and unrealistically clean — every lab has a
 * LOINC, a UCUM unit and a numeric value. Real extracts do not. This stage
 * puts the mess back, deterministically, so the normalize stage has something
 * to prove and the README can show clean vs. messed side by side.
 *
 * Every corruption here is reversible by scripts/lib/normalize.ts *except*
 * the two that are meant not to be: a stringified lab value (">60") and the
 * unresolvable local code (XLAB-77). Those exist so the quarantine path — the
 * fact disappears and the engine sees `unknown`, rather than a number being
 * guessed at — is exercised on real corpus data.
 *
 * Determinism: the PRNG is seeded per (seed, patient, stream), so a patient's
 * corruption never depends on how many patients were processed first.
 */
import type { CodeEntry, FactValue, PatientFacts } from "../../src/core/schema.js";
import { LAB_BY_SLUG } from "./loinc.js";
import { UNRESOLVABLE_LOCAL_CODE, loadLocalCodes, loadUnits, slugifyCode } from "./mappings.js";
import { patientRng } from "./rng.js";

export type MessOp =
  | "drop-unit"
  | "sloppy-unit"
  | "convert-unit"
  | "local-code"
  | "stringify-value"
  | "duplicate-med"
  | "backdate";

export type MessRecord = { op: MessOp; target: string; detail: string };
export type MessRates = Record<MessOp, number>;

/**
 * Per-item probabilities. Tuned so roughly two thirds of patients carry at
 * least one corruption and no single lab is corrupted so often that the corpus
 * stops looking like data.
 */
export const DEFAULT_RATES: MessRates = {
  "drop-unit": 0.22,
  "sloppy-unit": 0.25,
  "convert-unit": 0.1,
  "local-code": 0.18,
  "stringify-value": 0.07,
  "duplicate-med": 0.35,
  backdate: 0.15,
};

/** Lab slugs a patient actually carries (`lab_creatinine` -> `creatinine`). */
export function labSlugsOf(facts: Record<string, FactValue>): string[] {
  return Object.keys(facts)
    .filter((k) => k.startsWith("lab_") && !/_(unit|code|days_ago)$/.test(k))
    .map((k) => k.slice("lab_".length));
}

/** Sloppy spellings of a canonical unit that the units table can undo. */
export function sloppyUnitFor(canonical: string): string[] {
  const { aliases } = loadUnits();
  return Object.entries(aliases)
    .filter(([, to]) => to === canonical)
    .map(([from]) => from);
}

/** Analyte-scoped conversions away from the canonical unit, with the factor. */
function conversionsFrom(slug: string, canonical: string): { unit: string; factor: number }[] {
  return loadUnits()
    .conversions.filter((c) => c.slug === slug && c.to === canonical)
    .map((c) => ({ unit: c.from, factor: c.factor }));
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Ways a lab value stops being a number in a real extract. */
export function stringifyLabValue(value: number, pick: (items: readonly string[]) => string): string {
  const forms = [
    `>${round(value, 2)}`,
    `<${round(value, 2)}`,
    `${round(value, 2)} (see comment)`,
    "cancelled",
    "hemolyzed",
    `${value >= 1000 ? `${Math.round(value / 1000)},${String(Math.round(value % 1000)).padStart(3, "0")}` : round(value, 2)} `.trim() + " *",
  ];
  return pick(forms);
}

const localBySlug = (): Map<string, string> => new Map(loadLocalCodes().map((c) => [c.slug, c.local]));

export type MessResult = { patient: PatientFacts; log: MessRecord[] };

export function messPatient(p: PatientFacts, seed: number, rates: Partial<MessRates> = {}): MessResult {
  const rate = { ...DEFAULT_RATES, ...rates };
  const r = patientRng(seed, p.patient, "mess");
  const facts: Record<string, FactValue> = structuredClone(p.facts);
  const log: MessRecord[] = [];
  const note = (op: MessOp, target: string, detail: string): void => void log.push({ op, target, detail });

  for (const slug of labSlugsOf(facts).sort()) {
    const key = `lab_${slug}`;
    const canonical = String(facts[`${key}_unit`] ?? LAB_BY_SLUG.get(slug)?.unit ?? "");
    const value = facts[key];

    // 1. Site-local lab code, and the fact renamed to match it — the shape you
    //    get when an extract comes from a lab system that never mapped to LOINC.
    let currentKey = key;
    if (r.chance(rate["local-code"])) {
      const local = r.chance(0.12) ? UNRESOLVABLE_LOCAL_CODE : localBySlug().get(slug);
      if (local) {
        const renamed = `lab_${slugifyCode(local)}`;
        for (const suffix of ["", "_unit", "_code", "_days_ago"]) {
          const from = `${currentKey}${suffix}`;
          if (facts[from] === undefined) continue;
          facts[`${renamed}${suffix}`] = facts[from];
          delete facts[from];
        }
        facts[`${renamed}_code`] = local;
        note("local-code", renamed, `${slug} -> ${local}`);
        currentKey = renamed;
      }
    }

    // 2. Units: dropped outright, misspelled, or reported in another unit.
    if (facts[`${currentKey}_unit`] !== undefined) {
      if (r.chance(rate["drop-unit"])) {
        delete facts[`${currentKey}_unit`];
        note("drop-unit", currentKey, `dropped "${canonical}"`);
      } else if (r.chance(rate["convert-unit"])) {
        const options = conversionsFrom(slug, canonical);
        const conv = options.length > 0 ? r.pick(options) : undefined;
        if (conv && typeof value === "number") {
          facts[currentKey] = round(value / conv.factor, 2);
          facts[`${currentKey}_unit`] = conv.unit;
          note("convert-unit", currentKey, `${canonical} -> ${conv.unit}`);
        }
      } else if (r.chance(rate["sloppy-unit"])) {
        const options = sloppyUnitFor(canonical);
        if (options.length > 0) {
          const sloppy = r.pick(options);
          facts[`${currentKey}_unit`] = sloppy;
          note("sloppy-unit", currentKey, `${canonical} -> ${sloppy}`);
        }
      }
    }

    // 3. A value that is no longer a number.
    const current = facts[currentKey];
    if (typeof current === "number" && r.chance(rate["stringify-value"])) {
      const text = stringifyLabValue(current, (items) => r.pick(items));
      facts[currentKey] = text;
      note("stringify-value", currentKey, `${current} -> "${text}"`);
    }

    // 4. A stale result timestamp.
    const ago = facts[`${currentKey}_days_ago`];
    if (typeof ago === "number" && r.chance(rate.backdate)) {
      const shifted = ago + r.int(30, 400);
      facts[`${currentKey}_days_ago`] = shifted;
      note("backdate", `${currentKey}_days_ago`, `${ago} -> ${shifted}`);
    }
  }

  // 5. Duplicate medication rows — the classic artefact of joining two source
  //    systems, each with its own copy of the same prescription.
  const meds = facts["medications"];
  if (Array.isArray(meds) && meds.length > 0 && r.chance(rate["duplicate-med"])) {
    const copies: CodeEntry[] = [];
    for (let i = 0; i < r.int(1, 2); i++) {
      const src = r.pick(meds as CodeEntry[]);
      copies.push({ ...src, daysAgo: Math.max(0, (src.daysAgo ?? 0) + r.int(0, 6)) });
    }
    facts["medications"] = [...(meds as CodeEntry[]), ...copies];
    note("duplicate-med", "medications", `+${copies.length} duplicate row(s)`);
  }

  // 6. Backdated condition onsets.
  const conditions = facts["conditions"];
  if (Array.isArray(conditions) && r.chance(rate.backdate)) {
    const shift = r.int(20, 200);
    facts["conditions"] = (conditions as CodeEntry[]).map((c) => ({ ...c, daysAgo: (c.daysAgo ?? 0) + shift }));
    note("backdate", "conditions", `all onsets +${shift} days`);
  }

  return { patient: { patient: p.patient, facts }, log };
}
