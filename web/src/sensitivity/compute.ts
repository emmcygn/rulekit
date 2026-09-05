/**
 * Threshold-impact math (design spec §9.2, G8).
 *
 * Everything here is exploratory: `setKnob` returns *new YAML text*, which the
 * app evaluates against the cohort. The editor's document is only touched when
 * the author explicitly copies a threshold back.
 */
import { parseDocument } from "yaml";
import { evalCriterion } from "../../../src/core/evaluator.js";
import { parseRuleSet, type Condition, type Criterion, type PatientFacts, type RuleSet } from "../../../src/core/schema.js";
import type { Engine, Evaluation } from "../engine/api.js";
import { symbolOf } from "../engine/ops.js";
import { displayBandCounts, type DisplayBandCounts } from "../funnel/bands.js";

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
  /** Criterion position in the parsed rule set and its evaluation results. */
  criterionIndex: number;
  /** "eGFR < 45" / "medications within 30d". */
  label: string;
};

function targetsIn(
  c: Condition,
  base: (string | number)[],
  criterion: Criterion,
  criterionIndex: number,
  out: Target[],
): void {
  if ("all" in c) {
    c.all.forEach((child, i) => targetsIn(child, [...base, "all", i], criterion, criterionIndex, out));
    return;
  }
  if ("any" in c) {
    c.any.forEach((child, i) => targetsIn(child, [...base, "any", i], criterion, criterionIndex, out));
    return;
  }
  if ("not" in c) {
    targetsIn(c.not, [...base, "not"], criterion, criterionIndex, out);
    return;
  }
  const common = {
    criterionId: criterion.id,
    ref: criterion.ref,
    criterionKind: criterion.kind,
    fact: c.fact,
    op: c.op,
    criterionIndex,
  };
  if ("value" in c && typeof c.value === "number") {
    const sym = symbolOf(c.op);
    out.push({
      ...common,
      knob: "value",
      value: c.value,
      unit: "unit" in c ? c.unit : undefined,
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
export function numericTargetsFromRuleSet(rs: RuleSet): Target[] {
  const out: Target[] = [];
  rs.criteria.forEach((c, i) => {
    if (!c.when) return;
    targetsIn(c.when, ["criteria", i, "when"], c, i, out);
  });
  return out;
}

export function numericTargets(rulesetYaml: string): Target[] {
  return numericTargetsFromRuleSet(parseRuleSet(rulesetYaml));
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
  /**
   * Patients this relaxation returns from the screen-fail band.
   *
   * Not "patients it makes potentially eligible": a rule set with an unmodeled
   * criterion pins everyone short of that band, so that measure reads +0 for
   * every knob and the list says nothing. What a feasibility reader is asking is
   * "how many does this criterion cost me", and that is the screen-fail band.
   */
  delta: number;
  target: Target;
};

type PreparedPatient = {
  facts: PatientFacts;
  results: { id: string; verdict: Evaluation["results"][number]["verdict"]; unmodeled: boolean }[];
  failCount: number;
  modeledUnknownCount: number;
  parkedUnknownCount: number;
};

export type PreparedSensitivity = {
  ruleset: RuleSet;
  targets: Target[];
  before: DisplayBandCounts;
  patients: PreparedPatient[];
};

function replaceAt(value: unknown, path: readonly (string | number)[], replacement: number): unknown {
  if (path.length === 0) return replacement;
  const [head, ...tail] = path;
  if (head === undefined) return replacement;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = replaceAt(copy[head as number], tail, replacement);
    return copy;
  }
  const object = value as Record<string, unknown>;
  return { ...object, [head]: replaceAt(object[head], tail, replacement) };
}

const parked = (r: { unmodeled: boolean; verdict: Evaluation["results"][number]["verdict"] }): boolean =>
  r.unmodeled && r.verdict === "unknown";

/** Prepare one baseline evaluation; every knob then re-evaluates one criterion. */
export function prepareSensitivity(
  ruleset: RuleSet,
  cohort: readonly PatientFacts[],
  evaluations: readonly Evaluation[],
): PreparedSensitivity {
  if (cohort.length !== evaluations.length) {
    throw new Error("sensitivity baseline must contain one evaluation per patient");
  }
  const patients = cohort.map((facts, index) => {
    const evaluation = evaluations[index]!;
    return {
      facts,
      results: evaluation.results.map(({ id, verdict, unmodeled }) => ({ id, verdict, unmodeled })),
      failCount: evaluation.results.filter((r) => r.verdict === "fail").length,
      modeledUnknownCount: evaluation.results.filter((r) => r.verdict === "unknown" && !r.unmodeled).length,
      parkedUnknownCount: evaluation.results.filter(parked).length,
    };
  });
  return {
    ruleset,
    targets: numericTargetsFromRuleSet(ruleset),
    before: displayBandCounts(evaluations),
    patients,
  };
}

/** Display-band counts after changing one numeric knob, in O(N) patient work. */
export function sensitivityCounts(
  prepared: PreparedSensitivity,
  target: Target,
  value: number,
): DisplayBandCounts {
  const baseCriterion = prepared.ruleset.criteria[target.criterionIndex];
  if (baseCriterion === undefined) throw new Error(`criterion ${target.criterionId} is missing`);
  const criterion = replaceAt(baseCriterion, target.path.slice(2), value) as Criterion;
  const counts: DisplayBandCounts = {
    "screen-fail": 0,
    "not-evaluable": 0,
    "pending-chart-review": 0,
    "potentially-eligible": 0,
  };
  for (const patient of prepared.patients) {
    const old = patient.results[target.criterionIndex];
    if (old?.id !== target.criterionId) {
      throw new Error(`sensitivity baseline is not aligned at ${target.criterionId}`);
    }
    const next = evalCriterion(criterion, patient.facts);
    const failCount = patient.failCount - (old.verdict === "fail" ? 1 : 0) + (next.verdict === "fail" ? 1 : 0);
    if (failCount > 0) {
      counts["screen-fail"] += 1;
      continue;
    }
    const modeledUnknownCount =
      patient.modeledUnknownCount - (old.verdict === "unknown" && !old.unmodeled ? 1 : 0) +
      (next.verdict === "unknown" && !next.unmodeled ? 1 : 0);
    const parkedUnknownCount =
      patient.parkedUnknownCount - (parked(old) ? 1 : 0) + (parked(next) ? 1 : 0);
    if (modeledUnknownCount > 0) counts["not-evaluable"] += 1;
    else if (parkedUnknownCount > 0) counts["pending-chart-review"] += 1;
    else counts["potentially-eligible"] += 1;
  }
  return counts;
}

export function yieldsFromPrepared(prepared: PreparedSensitivity): Yield[] {
  return prepared.targets
    .map((target): Yield | undefined => {
      const to = relaxedValue(target.criterionKind, target.op, target.value);
      if (to === target.value) return undefined;
      const counts = sensitivityCounts(prepared, target, to);
      return {
        criterionId: target.criterionId,
        ref: target.ref,
        label: target.label,
        from: target.value,
        to,
        delta: prepared.before["screen-fail"] - counts["screen-fail"],
        target,
      };
    })
    .filter((value): value is Yield => value !== undefined)
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Price every knob: how many patients does relaxing it by one step return?
 *
 * *Every* knob, including the ones that buy nothing. Dropping the +0 rows hid
 * the criterion the coordinator had actually come to ask about (operator M4:
 * she picked E3 and E3 was not in the list), and left three tied +1 rows
 * numbered 1/2/3 as if the order meant something (uiux M7). Nothing is filtered
 * and nothing is ranked unless the deltas actually differ.
 */
export function topYield(
  rulesetYaml: string,
  cohort: readonly PatientFacts[],
  engine: Engine,
): Yield[] {
  const ruleset = parseRuleSet(rulesetYaml);
  const evaluations = cohort.map((patient) => engine.evalPatient(rulesetYaml, patient));
  return yieldsFromPrepared(prepareSensitivity(ruleset, cohort, evaluations));
}

/** Is there a real ordering here, or do the top rows just tie? */
export const yieldsAreRanked = (ranked: readonly Yield[]): boolean =>
  ranked.length > 1 && ranked[0]!.delta !== ranked[1]!.delta;

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
