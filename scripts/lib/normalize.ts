/**
 * Stage 3 (pure half): the cleaning stage.
 *
 * Undoes what the mess injector did — and, more to the point, what a real
 * extract does — in four passes per lab:
 *
 *   1. resolve the lab code (LOINC as-is, or site-local via the committed
 *      mapping table) and rename the fact to the canonical slug;
 *   2. normalize the unit to the UCUM spelling declared in lib/loinc.ts,
 *      converting the value where the conversion is scoped to this analyte;
 *   3. quarantine anything it cannot make into a trustworthy number;
 *   4. collapse duplicate rows in the code lists.
 *
 * The governing rule: **never guess a number.** An unresolvable code, an
 * unrecognised unit or a non-numeric value all end the same way — the fact is
 * omitted and preserved as a `<fact>_raw` string. The evaluator then sees a
 * missing fact and returns `unknown`, which is the honest answer. The one
 * assumption the stage does make is explicit and logged: a lab whose unit was
 * dropped but whose code resolved is given that LOINC's conventional unit.
 */
import type { CodeEntry, FactValue, PatientFacts } from "../../src/core/schema.js";
import { LAB_BY_LOINC, LAB_BY_SLUG } from "./loinc.js";
import { loadLocalCodes, loadUnits } from "./mappings.js";

export type NormalizeKind =
  | "mapped-code"
  | "unresolvable-code"
  | "unit-alias"
  | "converted"
  | "assumed-unit"
  | "unknown-unit"
  | "quarantined-value"
  | "deduplicated";

export type NormalizeIssue = { kind: NormalizeKind; target: string; detail: string };
export type NormalizeResult = { patient: PatientFacts; log: NormalizeIssue[] };

const SUFFIXES = ["_unit", "_code", "_days_ago", "_raw"] as const;

/** Lab base keys (`lab_creatinine`), whatever they are currently called. */
function labKeys(facts: Record<string, FactValue>): string[] {
  const bases = new Set<string>();
  for (const k of Object.keys(facts)) {
    if (!k.startsWith("lab_")) continue;
    const suffix = SUFFIXES.find((s) => k.endsWith(s));
    bases.add(suffix ? k.slice(0, -suffix.length) : k);
  }
  return [...bases].sort();
}

const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** LOINC + canonical slug for a lab code, or undefined if unresolvable. */
export function resolveLabCode(code: string): { loinc: string; slug: string } | undefined {
  const direct = LAB_BY_LOINC.get(code);
  if (direct) return { loinc: direct.loinc, slug: direct.slug };
  const local = loadLocalCodes().find((c) => c.local === code);
  if (local) return { loinc: local.loinc, slug: local.slug };
  return undefined;
}

export function normalizePatient(p: PatientFacts): NormalizeResult {
  const facts: Record<string, FactValue> = structuredClone(p.facts);
  const log: NormalizeIssue[] = [];
  const note = (kind: NormalizeKind, target: string, detail: string): void => void log.push({ kind, target, detail });
  const { aliases, conversions } = loadUnits();

  for (const key of labKeys(facts)) {
    const code = facts[`${key}_code`];
    const declaredSlug = key.slice("lab_".length);
    const resolved =
      typeof code === "string"
        ? resolveLabCode(code)
        : // No code fact survived the extract: fall back to the fact's own name,
          // which is only trusted when it is already a declared slug.
          LAB_BY_SLUG.has(declaredSlug)
          ? { loinc: LAB_BY_SLUG.get(declaredSlug)!.loinc, slug: declaredSlug }
          : undefined;

    // 1. Rename to the canonical slug.
    let base = key;
    if (resolved && resolved.slug !== declaredSlug) {
      const renamed = `lab_${resolved.slug}`;
      for (const suffix of ["", ...SUFFIXES]) {
        const from = `${base}${suffix}`;
        if (facts[from] === undefined) continue;
        facts[`${renamed}${suffix}`] = facts[from];
        delete facts[from];
      }
      note("mapped-code", renamed, `${typeof code === "string" ? code : declaredSlug} -> LOINC ${resolved.loinc}`);
      base = renamed;
    }

    const quarantine = (reason: NormalizeKind, detail: string): void => {
      const value = facts[base];
      const unit = facts[`${base}_unit`];
      facts[`${base}_raw`] = [value, unit].filter((v) => v !== undefined).join(" ");
      delete facts[base];
      delete facts[`${base}_unit`];
      note(reason, base, detail);
    };

    // Already quarantined by an earlier run: leave it exactly as it is, so
    // normalizing twice is the same as normalizing once.
    if (facts[base] === undefined && facts[`${base}_raw`] !== undefined) continue;

    if (!resolved) {
      quarantine("unresolvable-code", `no LOINC for ${typeof code === "string" ? `"${code}"` : "an unnamed lab"}`);
      continue;
    }
    facts[`${base}_code`] = resolved.loinc;

    // 2. Units.
    const canonical = LAB_BY_SLUG.get(resolved.slug)?.unit;
    const value = facts[base];
    const rawUnit = facts[`${base}_unit`];
    if (canonical !== undefined && value !== undefined) {
      if (rawUnit === undefined) {
        facts[`${base}_unit`] = canonical;
        note("assumed-unit", base, `unit missing; adopted the LOINC's conventional unit ${canonical}`);
      } else if (rawUnit !== canonical) {
        const unit = String(rawUnit);
        const alias = aliases[unit];
        const conv = conversions.find((c) => c.slug === resolved.slug && c.from === unit && c.to === canonical);
        if (alias === canonical) {
          facts[`${base}_unit`] = canonical;
          note("unit-alias", base, `"${unit}" -> ${canonical}`);
        } else if (conv) {
          if (typeof value === "number") facts[base] = round(value * conv.factor);
          facts[`${base}_unit`] = canonical;
          note("converted", base, `${unit} -> ${canonical} (x${conv.factor})`);
        } else {
          quarantine("unknown-unit", `no ${resolved.slug} conversion from "${unit}" to ${canonical}`);
          continue;
        }
      }
    }

    // 3. Values that are not numbers.
    const finalValue = facts[base];
    if (finalValue !== undefined && typeof finalValue !== "number") {
      quarantine("quarantined-value", `value "${String(finalValue)}" is not numeric`);
    }
  }

  // 4. Duplicate rows in the code lists.
  for (const listName of ["medications", "conditions"]) {
    const list = facts[listName];
    if (!Array.isArray(list)) continue;
    const byCode = new Map<string, CodeEntry>();
    for (const e of list as CodeEntry[]) {
      const prev = byCode.get(e.code);
      if (!prev || (e.daysAgo ?? Infinity) < (prev.daysAgo ?? Infinity)) byCode.set(e.code, e);
    }
    if (byCode.size !== list.length) note("deduplicated", listName, `${list.length} rows -> ${byCode.size}`);
    facts[listName] = [...byCode.values()].sort(
      (a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0) || a.code.localeCompare(b.code),
    );
  }

  // Stable key order so a re-run produces an identical file.
  const ordered: Record<string, FactValue> = {};
  for (const k of Object.keys(facts).sort()) ordered[k] = facts[k] as FactValue;
  return { patient: { patient: p.patient, facts: ordered }, log };
}
