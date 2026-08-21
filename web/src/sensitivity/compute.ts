/**
 * Threshold-impact math (design spec §9.2, G8).
 *
 * Everything here is exploratory: `setKnob` returns *new YAML text*, which the
 * app evaluates against the cohort. The editor's document is only touched when
 * the author explicitly copies a threshold back.
 */
import { parseDocument } from "yaml";
import { parseRuleSet, type Condition, type Criterion, type PatientFacts } from "../../../src/core/schema.js";
import type { Engine } from "../engine/api.js";
import { symbolOf } from "../engine/ops.js";
import { cohortCounts } from "../funnel/compute.js";

/** Display names for the facts the demo pack declares. */
const FACT_LABEL: Record<string, string> = {
  egfr: "eGFR",
  lvef: "LVEF",
  age: "age",
  medications: "medications",
};

const label = (fact: string) => FACT_LABEL[fact] ?? fact;

export type Knob = "value" | "windowDays";

export type Target = {
  criterionId: string;
  ref?: string;
  criterionKind: Criterion["kind"];
  fact: string;
  op: string;
  knob: Knob;
  value: number;
  unit?: string;
  /** Present for `anyWithin` knobs: the code set whose recency the window measures. */
  codes?: { system: string; values: string[] };
  /** Path into the YAML document, for `setKnob`. */
  path: (string | number)[];
  /** "eGFR < 45" / "medications within 30d". */
  label: string;
};

function targetsIn(
  c: Condition,
  base: (string | number)[],
  criterion: Criterion,
  out: Target[],
): void {
  if ("all" in c) {
    c.all.forEach((child, i) => targetsIn(child, [...base, "all", i], criterion, out));
    return;
  }
  if ("any" in c) {
    c.any.forEach((child, i) => targetsIn(child, [...base, "any", i], criterion, out));
    return;
  }
  if ("not" in c) {
    targetsIn(c.not, [...base, "not"], criterion, out);
    return;
  }
  const common = {
    criterionId: criterion.id,
    ref: criterion.ref,
    criterionKind: criterion.kind,
    fact: c.fact,
    op: c.op,
  };
  if ("value" in c) {
    const sym = symbolOf(c.op);
    out.push({
      ...common,
      knob: "value",
      value: c.value,
      unit: c.unit,
      path: [...base, "value"],
      label: `${label(c.fact)} ${sym} ${c.value}`,
    });
  } else if (c.op === "anyWithin") {
    out.push({
      ...common,
      knob: "windowDays",
      value: c.windowDays,
      codes: c.codes,
      path: [...base, "windowDays"],
      label: `${label(c.fact)} within ${c.windowDays}d`,
    });
  }
}

/** Every numeric knob in the rule set, in document order. */
export function numericTargets(rulesetYaml: string): Target[] {
  const rs = parseRuleSet(rulesetYaml);
  const out: Target[] = [];
  rs.criteria.forEach((c, i) => {
    if (!c.when) return;
    targetsIn(c.when, ["criteria", i, "when"], c, out);
  });
  return out;
}

/**
 * Rewrite one number in the YAML document.
 *
 * Splices the source text over the scalar's own range rather than re-emitting
 * the document, so an author's formatting, comments and line count survive a
 * "copy threshold back to YAML" byte for byte.
 */
export function setKnob(rulesetYaml: string, path: (string | number)[], value: number): string {
  const doc = parseDocument(rulesetYaml);
  const node: unknown = doc.getIn(path, true);
  const range =
    node && typeof node === "object" && "range" in node
      ? (node as { range?: [number, number, number] }).range
      : undefined;
  if (!range) {
    doc.setIn(path, value);
    return String(doc);
  }
  return rulesetYaml.slice(0, range[0]) + String(value) + rulesetYaml.slice(range[1]);
}

/** One step in the direction that admits more patients. */
export function relaxedValue(kind: Criterion["kind"], op: string, value: number): number {
  const STEP = 5;
  if (op === "anyWithin") return Math.max(1, Math.round(value / 2));
  const admitsMoreWhenLower =
    kind === "inclusion" ? op === "gte" || op === "gt" : op === "lt" || op === "lte";
  return admitsMoreWhenLower ? value - STEP : value + STEP;
}

export type Yield = {
  criterionId: string;
  ref?: string;
  label: string;
  from: number;
  to: number;
  delta: number;
  target: Target;
};

/** Price each knob: how many patients does relaxing it by one step return? */
export function topYield(rulesetYaml: string, cohort: PatientFacts[], engine: Engine): Yield[] {
  const base = cohortCounts(cohort.map((p) => engine.evalPatient(rulesetYaml, p)));
  return numericTargets(rulesetYaml)
    .map((t): Yield | undefined => {
      const to = relaxedValue(t.criterionKind, t.op, t.value);
      if (to === t.value) return undefined;
      const yamlText = setKnob(rulesetYaml, t.path, to);
      const counts = cohortCounts(cohort.map((p) => engine.evalPatient(yamlText, p)));
      return {
        criterionId: t.criterionId,
        ref: t.ref,
        label: t.label,
        from: t.value,
        to,
        delta: counts.potentiallyEligible - base.potentiallyEligible,
        target: t,
      };
    })
    .filter((y): y is Yield => y !== undefined && y.delta > 0)
    .sort((a, b) => b.delta - a.delta);
}

export type Bin = { lo: number; hi: number; count: number };

/**
 * Bucket values onto a round grid of `width`, covering every value. `cover`
 * widens the axis (to keep a threshold line on screen) without adding counts.
 */
export function histogram(values: number[], width: number, cover: number[] = []): Bin[] {
  if (values.length === 0) return [];
  const span = [...values, ...cover];
  const lo = Math.floor(Math.min(...span) / width) * width;
  const hiValue = Math.max(...span);
  const hi = Math.max(Math.floor(hiValue / width) * width + width, lo + width);
  const bins: Bin[] = [];
  for (let edge = lo; edge < hi; edge += width) {
    bins.push({ lo: edge, hi: edge + width, count: 0 });
  }
  for (const v of values) {
    const i = Math.min(Math.floor((v - lo) / width), bins.length - 1);
    bins[i]!.count += 1;
  }
  return bins;
}

/** A bin width that gives roughly a dozen buckets, on a 1/2/5/10 grid. */
export function niceWidth(values: number[]): number {
  if (values.length === 0) return 5;
  const span = Math.max(...values) - Math.min(...values);
  if (span <= 0) return 1;
  const raw = span / 12;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const step of [1, 2, 5, 10]) {
    if (raw <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Does this value sit outside the pool at that threshold? An inclusion removes
 * the patient when its condition is false, an exclusion when it is true.
 */
export function excludes(target: Target, threshold: number, value: number): boolean {
  if (target.knob === "windowDays") return value <= threshold;
  const fires = (op: string): boolean => {
    switch (op) {
      case "gte":
        return value >= threshold;
      case "gt":
        return value > threshold;
      case "lte":
        return value <= threshold;
      case "lt":
        return value < threshold;
      case "eq":
        return value === threshold;
      case "neq":
        return value !== threshold;
      default:
        return false;
    }
  };
  return target.criterionKind === "inclusion" ? !fires(target.op) : fires(target.op);
}

export type FactValues = {
  numeric: { patient: string; value: number }[];
  unusable: { patient: string; value: string }[];
};

/**
 * The cohort values this knob acts on: the fact itself for a comparison, or the
 * recency of the matching codes for a temporal window.
 */
export function knobValues(cohort: PatientFacts[], target: Target): FactValues {
  if (target.knob === "value") return factValues(cohort, target.fact);
  const numeric: FactValues["numeric"] = [];
  const unusable: FactValues["unusable"] = [];
  for (const p of cohort) {
    const entries = p.facts[target.fact];
    if (!Array.isArray(entries)) {
      unusable.push({ patient: p.patient, value: "not recorded" });
      continue;
    }
    const wanted = new Set(target.codes?.values ?? []);
    for (const e of entries) {
      if (target.codes && (e.system !== target.codes.system || !wanted.has(e.code))) continue;
      if (e.daysAgo === undefined) unusable.push({ patient: p.patient, value: "no date" });
      else numeric.push({ patient: p.patient, value: e.daysAgo });
    }
  }
  return { numeric, unusable };
}

/**
 * Cohort values for one fact, splitting off the ones a numeric comparison
 * cannot use (`">60"` and friends) instead of coercing them.
 */
export function factValues(cohort: PatientFacts[], fact: string): FactValues {
  const numeric: FactValues["numeric"] = [];
  const unusable: FactValues["unusable"] = [];
  for (const p of cohort) {
    const v = p.facts[fact];
    if (typeof v === "number" && Number.isFinite(v)) numeric.push({ patient: p.patient, value: v });
    else if (typeof v === "string") unusable.push({ patient: p.patient, value: v });
  }
  return { numeric, unusable };
}
