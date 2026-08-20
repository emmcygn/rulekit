/**
 * Stage 1 (pure half): FHIR R4 Bundle -> PatientFacts.
 *
 * Two deliberate choices worth knowing about:
 *
 * 1. **Fixed reference date, no `Date.now()`.** Everything ages against
 *    REFERENCE_DATE (2026-06-30), so the corpus is byte-identical on any day.
 *
 * 2. **Timeline shift.** The Synthea sample set stops in September 2019. Aged
 *    against 2026 every medication would be ~2,500 days old and every
 *    `anyWithin` criterion would be dead on the whole corpus. So each patient's
 *    own latest recorded event is treated as "roughly now": recency is measured
 *    back from that anchor, plus a deterministic 0-45 day jitter so patients
 *    are not all anchored to the same instant. Age is computed at the shifted
 *    instant too, so age and event recency stay consistent with each other.
 *    This is documented in docs/data-pipeline.md — it is a fixture-shaping
 *    decision, not a claim about the source data.
 */
import type { CodeEntry, FactValue, PatientFacts } from "../../src/core/schema.js";
import { LAB_BY_LOINC } from "./loinc.js";
import { patientRng } from "./rng.js";
import { REFERENCE_DATE } from "./paths.js";

const DAY_MS = 86_400_000;
const LOINC_SYSTEM = "http://loinc.org";
const SNOMED_SYSTEM = "http://snomed.info/sct";
const RXNORM_SYSTEM = "http://www.nlm.nih.gov/research/umls/rxnorm";
/** Medications older than this and not marked active are dropped. */
export const MED_WINDOW_DAYS = 365;
export const MAX_JITTER_DAYS = 45;

/** SNOMED codes that mark a heart-failure patient in the Synthea sample set. */
export const HF_SNOMED = ["88805009", "84114007", "42343007"];
/** SNOMED codes standing for significant coronary artery disease. */
export const CAD_SNOMED = ["53741008", "414545008", "22298006", "399211009"];

export type FlattenOptions = {
  referenceDate?: string;
  /** Override the per-patient jitter; tests pin it, the CLI never sets it. */
  jitterDays?: number;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  if (Number.isNaN(ms)) throw new Error(`unparseable date pair: ${a} / ${b}`);
  return Math.round(ms / DAY_MS);
}

/** Every resource of one type in a bundle. */
export function bundleEntries(bundle: unknown, resourceType: string): Json[] {
  return arr(obj(bundle)?.entry)
    .map((e) => obj(obj(e)?.resource))
    .filter((r): r is Json => r !== undefined && r["resourceType"] === resourceType);
}

function codingOf(concept: unknown, system: string): { code: string; display?: string } | undefined {
  for (const c of arr(obj(concept)?.coding)) {
    const co = obj(c);
    if (co?.["system"] === system && typeof co["code"] === "string") {
      return { code: co["code"], display: str(co["display"]) };
    }
  }
  return undefined;
}

/** The date a resource happened, whichever field carries it. */
function eventDate(r: Json): string | undefined {
  return (
    str(r["effectiveDateTime"]) ??
    str(r["authoredOn"]) ??
    str(r["onsetDateTime"]) ??
    str(obj(r["effectivePeriod"])?.["start"]) ??
    undefined
  );
}

/** Latest recorded event in the bundle — the anchor the timeline shifts onto. */
export function anchorDate(bundle: unknown): string | undefined {
  let best: string | undefined;
  for (const type of ["Observation", "MedicationRequest", "Condition", "Encounter", "Procedure"]) {
    for (const r of bundleEntries(bundle, type)) {
      const d = eventDate(r);
      if (d && (best === undefined || Date.parse(d) > Date.parse(best))) best = d;
    }
  }
  return best;
}

export function patientIdOf(bundle: unknown): string {
  const p = bundleEntries(bundle, "Patient")[0];
  const id = str(p?.["id"]);
  if (!id) throw new Error("bundle has no Patient resource with an id");
  return `SYN-${id.slice(0, 8).toUpperCase()}`;
}

function fullYearsBetween(birthDate: string, atMs: number): number {
  const b = new Date(Date.parse(birthDate));
  const at = new Date(atMs);
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

type Lab = { slug: string; value: number; unit: string; loinc: string; date: string };

function collectLabs(bundle: unknown): Map<string, Lab> {
  const latest = new Map<string, Lab>();
  const offer = (lab: Lab): void => {
    const prev = latest.get(lab.slug);
    if (!prev || Date.parse(lab.date) > Date.parse(prev.date)) latest.set(lab.slug, lab);
  };
  for (const o of bundleEntries(bundle, "Observation")) {
    const date = eventDate(o);
    if (!date) continue;
    const readings: { concept: unknown; quantity: unknown }[] = [
      { concept: o["code"], quantity: o["valueQuantity"] },
      ...arr(o["component"]).map((c) => ({ concept: obj(c)?.["code"], quantity: obj(c)?.["valueQuantity"] })),
    ];
    for (const { concept, quantity } of readings) {
      const coding = codingOf(concept, LOINC_SYSTEM);
      const def = coding && LAB_BY_LOINC.get(coding.code);
      const value = num(obj(quantity)?.["value"]);
      const unit = str(obj(quantity)?.["unit"]);
      if (!def || value === undefined || unit === undefined) continue;
      offer({ slug: def.slug, value, unit, loinc: def.loinc, date });
    }
  }
  return latest;
}

/** Round a lab to a sane number of digits — FHIR floats carry 13 of them. */
const roundLab = (v: number): number => Math.round(v * 100) / 100;

export function flattenBundle(bundle: unknown, opts: FlattenOptions = {}): PatientFacts {
  const referenceDate = opts.referenceDate ?? REFERENCE_DATE;
  const patient = patientIdOf(bundle);
  const p = bundleEntries(bundle, "Patient")[0] as Json;
  const birthDate = str(p["birthDate"]);
  if (!birthDate) throw new Error(`${patient}: Patient has no birthDate`);

  const anchor = anchorDate(bundle) ?? referenceDate;
  const jitter = opts.jitterDays ?? patientRng(0, patient, "jitter").int(0, MAX_JITTER_DAYS);
  /** Days before the reference date, on the shifted timeline. */
  const agoOf = (date: string): number => daysBetween(date, anchor) + jitter;

  const facts: Record<string, FactValue> = {
    age: fullYearsBetween(birthDate, Date.parse(anchor) + jitter * DAY_MS),
    sex: str(p["gender"]) ?? "unknown",
  };

  const collapse = (entries: CodeEntry[]): CodeEntry[] => {
    const byCode = new Map<string, CodeEntry>();
    for (const e of entries) {
      const prev = byCode.get(e.code);
      if (!prev || (e.daysAgo ?? Infinity) < (prev.daysAgo ?? Infinity)) byCode.set(e.code, e);
    }
    return [...byCode.values()].sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0) || a.code.localeCompare(b.code));
  };

  const conditions: CodeEntry[] = [];
  for (const c of bundleEntries(bundle, "Condition")) {
    const coding = codingOf(c["code"], SNOMED_SYSTEM);
    const date = eventDate(c);
    if (!coding || !date) continue;
    conditions.push({ code: coding.code, system: "snomed", daysAgo: Math.max(0, agoOf(date)) });
  }
  if (conditions.length > 0) facts["conditions"] = collapse(conditions);

  const meds: CodeEntry[] = [];
  for (const m of bundleEntries(bundle, "MedicationRequest")) {
    const coding = codingOf(m["medicationCodeableConcept"], RXNORM_SYSTEM);
    const date = eventDate(m);
    if (!coding || !date) continue;
    const daysAgo = Math.max(0, agoOf(date));
    if (m["status"] !== "active" && daysAgo > MED_WINDOW_DAYS) continue;
    meds.push({ code: coding.code, system: "rxnorm", daysAgo });
  }
  if (meds.length > 0) facts["medications"] = collapse(meds);

  for (const lab of [...collectLabs(bundle).values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    facts[`lab_${lab.slug}`] = roundLab(lab.value);
    facts[`lab_${lab.slug}_unit`] = lab.unit;
    facts[`lab_${lab.slug}_code`] = lab.loinc;
    facts[`lab_${lab.slug}_days_ago`] = Math.max(0, agoOf(lab.date));
  }

  return { patient, facts };
}

export function isHfPatient(p: PatientFacts): boolean {
  const conditions = p.facts["conditions"];
  if (!Array.isArray(conditions)) return false;
  return conditions.some((c) => HF_SNOMED.includes(c.code));
}

const ANTICOAGULANTS = ["855332", "1114195", "1364430", "1599538"];

/**
 * The HF mutation, applied only to patients who already carry a heart-failure
 * SNOMED code. Synthea's HF module gives some of them an LVEF (LOINC 10230-1)
 * and an NT-proBNP (33762-6) but never the protocol detail COMMANDER HF
 * screens on, so this stage fills the gaps, deterministically from `seed`:
 *
 *   - lab_lvef (%) + unit/code/days_ago       — 18-48%, 10-400 days old, only
 *                                               where Synthea recorded no LVEF
 *   - lab_bnp or lab_nt_probnp (pg/mL)        — 45/45/10 (bnp / ntprobnp /
 *                                               neither), only where Synthea
 *                                               recorded neither peptide
 *   - hf_symptom_duration_months              — 1-60, always
 *   - hf_index_event_days_ago                 — 2-60, always
 *   - index_hospital_days                     — 1-30, always
 *   - a coronary-artery-disease SNOMED code   — 60% of those lacking one
 *   - a stroke SNOMED code                    — 15%, 10-400 days ago
 *   - an atrial-fibrillation SNOMED code      — 20% of those lacking one
 *   - an oral anticoagulant RxNorm code       — 25%, 1-200 days ago
 *
 * **No existing fact is overwritten.** Ages, labs and Synthea's own codes pass
 * through untouched; only the three `hf_*` / `index_*` facts, which Synthea
 * cannot produce at all, are written unconditionally. The rates are chosen so
 * every modelable COMMANDER HF criterion fires in both directions somewhere in
 * the corpus.
 */
export function mutateForHf(p: PatientFacts, seed: number): PatientFacts {
  const r = patientRng(seed, p.patient, "hf");
  const facts: Record<string, FactValue> = { ...p.facts };
  const conditions: CodeEntry[] = Array.isArray(facts["conditions"]) ? [...facts["conditions"]] : [];
  const meds: CodeEntry[] = Array.isArray(facts["medications"]) ? [...facts["medications"]] : [];
  const has = (list: CodeEntry[], codes: string[]): boolean => list.some((c) => codes.includes(c.code));

  const putLab = (slug: string, value: number, unit: string, loinc: string, daysAgo: number): void => {
    facts[`lab_${slug}`] = value;
    facts[`lab_${slug}_unit`] = unit;
    facts[`lab_${slug}_code`] = loinc;
    facts[`lab_${slug}_days_ago`] = daysAgo;
  };

  if (facts["lab_lvef"] === undefined) putLab("lvef", r.int(18, 48), "%", "10230-1", r.int(10, 400));

  const peptide = r.next();
  if (facts["lab_bnp"] === undefined && facts["lab_nt_probnp"] === undefined) {
    if (peptide < 0.45) putLab("bnp", r.int(60, 900), "pg/mL", "30934-4", r.int(1, 30));
    else if (peptide < 0.9) putLab("nt_probnp", r.int(200, 4000), "pg/mL", "33762-6", r.int(1, 30));
    // the remaining 10% get neither, so the BNP criterion evaluates unknown
  }

  facts["hf_symptom_duration_months"] = r.int(1, 60);
  facts["hf_index_event_days_ago"] = r.int(2, 60);
  facts["index_hospital_days"] = r.int(1, 30);

  if (!has(conditions, CAD_SNOMED) && r.chance(0.6)) {
    conditions.push({ code: "53741008", system: "snomed", daysAgo: r.int(120, 2000) });
  }
  // A recent stroke: injected fresh, and it must *replace* any decades-old
  // stroke Synthea already recorded, or the exclusion window never sees it.
  if (r.chance(0.15)) conditions.push({ code: "230690007", system: "snomed", daysAgo: r.int(10, 400) });
  if (!has(conditions, ["49436004"]) && r.chance(0.2)) {
    conditions.push({ code: "49436004", system: "snomed", daysAgo: r.int(30, 1500) });
  }
  if (r.chance(0.25)) meds.push({ code: r.pick(ANTICOAGULANTS), system: "rxnorm", daysAgo: r.int(1, 200) });

  /** Most recent entry per code, oldest-last — same shape flatten emits. */
  const collapse = (list: CodeEntry[]): CodeEntry[] => {
    const byCode = new Map<string, CodeEntry>();
    for (const e of list) {
      const prev = byCode.get(e.code);
      if (!prev || (e.daysAgo ?? Infinity) < (prev.daysAgo ?? Infinity)) byCode.set(e.code, e);
    }
    return [...byCode.values()].sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0) || a.code.localeCompare(b.code));
  };
  if (conditions.length > 0) facts["conditions"] = collapse(conditions);
  if (meds.length > 0) facts["medications"] = collapse(meds);

  return { patient: p.patient, facts };
}
