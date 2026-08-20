/**
 * Amendment view math (design spec §8): structural diff, flip grouping, and the
 * already-enrolled check the CLI diff has no place to put.
 *
 * Pure: rule sets in, evaluations in, rows out.
 */
import type { Condition, Criterion, RuleSet } from "../../../src/core/schema.js";
import type { Evaluation, Flip } from "../engine/api.js";

export type StructuralChange = {
  kind: "added" | "removed" | "changed";
  id: string;
  ref?: string;
  verbatim: string;
  criterionKind: Criterion["kind"];
  /** For `changed`: the scalars that moved, e.g. "windowDays 14 → 30". */
  summary: string;
};

/** Criterion ids in rule-set order — the tie-break for attributing a flip. */
export function criterionOrder(rs: RuleSet): string[] {
  return rs.criteria.map((c) => c.id);
}

/** Every scalar in a condition tree, keyed by its structural path. */
function scalars(c: Condition | undefined, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (!c) return out;
  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${prefix}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
      return;
    }
    out.set(prefix, String(node));
  };
  walk(c, path);
  return out;
}

function changeSummary(before: Criterion, after: Criterion): string {
  const a = scalars(before.when);
  const b = scalars(after.when);
  const sameShape = a.size === b.size && [...a.keys()].every((k) => b.has(k));
  if (!sameShape) return "condition rewritten";
  const moved = [...a.entries()]
    .filter(([k, v]) => b.get(k) !== v)
    .map(([k, v]) => `${k.split(".").pop()} ${v} → ${b.get(k)}`);
  if (moved.length === 0) {
    return before.kind !== after.kind ? `${before.kind} → ${after.kind}` : "metadata changed";
  }
  return moved.join(", ");
}

function sameCondition(a: Criterion, b: Criterion): boolean {
  return JSON.stringify(a.when ?? null) === JSON.stringify(b.when ?? null) && a.kind === b.kind;
}

export function structuralDiff(from: RuleSet, to: RuleSet): StructuralChange[] {
  const before = new Map(from.criteria.map((c) => [c.id, c]));
  const after = new Map(to.criteria.map((c) => [c.id, c]));
  const out: StructuralChange[] = [];

  for (const c of to.criteria) {
    const prev = before.get(c.id);
    if (!prev) {
      out.push({
        kind: "added",
        id: c.id,
        ref: c.ref,
        verbatim: c.verbatim,
        criterionKind: c.kind,
        summary: "",
      });
    } else if (!sameCondition(prev, c)) {
      out.push({
        kind: "changed",
        id: c.id,
        ref: c.ref,
        verbatim: c.verbatim,
        criterionKind: c.kind,
        summary: changeSummary(prev, c),
      });
    }
  }
  for (const c of from.criteria) {
    if (after.has(c.id)) continue;
    out.push({
      kind: "removed",
      id: c.id,
      ref: c.ref,
      verbatim: c.verbatim,
      criterionKind: c.kind,
      summary: "",
    });
  }
  return out;
}

export type FlipGroup = { criterionId: string; flips: Flip[] };

/**
 * One group per flip: a flip with several responsible criteria is filed under
 * the earliest one in rule-set order, so the group sizes sum to the flip count.
 */
export function groupFlips(flips: Flip[], order: string[]): FlipGroup[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const groups = new Map<string, Flip[]>();
  for (const flip of flips) {
    const primary =
      [...flip.responsible].sort(
        (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity),
      )[0] ?? "";
    const bucket = groups.get(primary);
    if (bucket) bucket.push(flip);
    else groups.set(primary, [flip]);
  }
  return [...groups.entries()]
    .map(([criterionId, f]) => ({ criterionId, flips: f }))
    .sort((a, b) => b.flips.length - a.flips.length || (rank.get(a.criterionId) ?? Infinity) - (rank.get(b.criterionId) ?? Infinity));
}

export type EnrolledRow = {
  participant: string;
  site: string;
  randomized: string;
  before: Evaluation;
  after: Evaluation;
};

export type EnrolledImpact = {
  participant: string;
  site: string;
  randomized: string;
  reasons: { id: string; ref?: string; detail: string }[];
};

/**
 * Participants already randomized who the amended criteria would now exclude —
 * a continuation / re-consent decision, not a screening one.
 */
export function enrolledImpact(rows: EnrolledRow[]): EnrolledImpact[] {
  const out: EnrolledImpact[] = [];
  for (const row of rows) {
    if (row.before.overall === "ineligible") continue;
    if (row.after.overall !== "ineligible") continue;
    const wasFailing = new Set(
      row.before.results.filter((r) => r.verdict === "fail").map((r) => r.id),
    );
    const reasons = row.after.results
      .filter((r) => r.verdict === "fail" && !wasFailing.has(r.id))
      .map((r) => ({ id: r.id, ref: r.ref, detail: r.trace?.detail ?? "" }));
    out.push({
      participant: row.participant,
      site: row.site,
      randomized: row.randomized,
      reasons,
    });
  }
  return out;
}
