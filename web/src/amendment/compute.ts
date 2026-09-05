/**
 * Amendment view math (design spec §8): structural diff, flip grouping, and the
 * already-enrolled check the CLI diff has no place to put.
 *
 * Pure: rule sets in, evaluations in, rows out.
 */
import type { Condition, Criterion, RuleSet } from "../../../src/core/schema.js";
import { structuralDiff as coreStructuralDiff } from "../../../src/core/diff.js";
import type { Evaluation, Flip } from "../engine/api.js";
import {
  BAND_LABEL,
  DISPLAY_BANDS,
  displayBandCounts,
  displayBandOf,
  type DisplayBand,
  type DisplayBandCounts,
} from "../funnel/bands.js";

export type StructuralChange = {
  kind: "added" | "removed" | "changed" | "renamed";
  id: string;
  fromId?: string;
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
  const changes = sameShape
    ? [...a.entries()]
        .filter(([k, v]) => b.get(k) !== v)
        .map(([k, v]) => `${k.split(".").pop()} ${v} → ${b.get(k)}`)
    : ["condition rewritten"];
  if (before.kind !== after.kind) changes.push(`${before.kind} → ${after.kind}`);
  if ((before.ref ?? "—") !== (after.ref ?? "—")) {
    changes.push(`ref ${before.ref ?? "—"} → ${after.ref ?? "—"}`);
  }
  if (before.verbatim !== after.verbatim) changes.push("verbatim changed");
  if ((before.unmodeled ?? false) !== (after.unmodeled ?? false)) {
    changes.push(after.unmodeled ? "now unmodeled" : "now modeled");
  }
  return changes.length === 0 ? "metadata changed" : changes.join(", ");
}

export function structuralDiff(from: RuleSet, to: RuleSet): StructuralChange[] {
  const before = new Map(from.criteria.map((c) => [c.id, c]));
  const diff = coreStructuralDiff(from, to);
  const added = new Set(diff.added);
  const removed = new Set(diff.removed);
  const changed = new Set(diff.changed);
  const renameByTo = new Map(diff.renamed.map((rename) => [rename.to, rename.from]));
  const out: StructuralChange[] = [];

  for (const c of to.criteria) {
    const fromId = renameByTo.get(c.id);
    const prev = before.get(fromId ?? c.id);
    if (fromId !== undefined) {
      out.push({
        kind: "renamed",
        id: c.id,
        fromId,
        ref: c.ref,
        verbatim: c.verbatim,
        criterionKind: c.kind,
        summary: `${fromId} → ${c.id}`,
      });
    }
    if (added.has(c.id)) {
      out.push({
        kind: "added",
        id: c.id,
        ref: c.ref,
        verbatim: c.verbatim,
        criterionKind: c.kind,
        summary: "",
      });
    } else if (changed.has(c.id) && prev !== undefined) {
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
    if (!removed.has(c.id)) continue;
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

export type FlipGroup<F = Flip> = { criterionId: string; flips: F[] };

/**
 * One group per flip: a flip with several responsible criteria is filed under
 * the earliest one in rule-set order, so the group sizes sum to the flip count.
 */
export function groupFlips<F extends { responsible: string[] }>(
  flips: readonly F[],
  order: string[],
): FlipGroup<F>[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const groups = new Map<string, F[]>();
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

/* ------------------------------------------------------- band transitions */

/**
 * One patient whose band moved between the two versions.
 *
 * The shipped headline read "3 of 10 change outcome (potentially eligible 5 → 3,
 * screen fail 2 → 4)" — deltas of −2 and +2 with not-evaluable flat, i.e. two
 * patients, not three (uiux B5). It disagreed with itself because the count came
 * from the engine's flip list and the deltas came from a differently-banded
 * waterfall. Both now come from `displayBandOf`, so the headline is the length
 * of the list underneath it by construction.
 */
export type BandFlip = {
  patient: string;
  from: DisplayBand;
  to: DisplayBand;
  /** Criteria whose verdict or modeled/unmodeled status changed. */
  responsible: string[];
};

export type AmendmentImpact = {
  before: DisplayBandCounts;
  after: DisplayBandCounts;
  flips: BandFlip[];
  /** Every band that moved, for the delta line. */
  moved: DisplayBand[];
};

export function amendmentImpact(
  beforeEvals: readonly Evaluation[],
  afterEvals: readonly Evaluation[],
): AmendmentImpact {
  const afterBy = new Map(afterEvals.map((e) => [e.patient, e]));
  const flips: BandFlip[] = [];

  for (const b of beforeEvals) {
    const a = afterBy.get(b.patient);
    if (a === undefined) continue;
    const from = displayBandOf(b);
    const to = displayBandOf(a);
    if (from === to) continue;
    const beforeResults = new Map(b.results.map((r) => [r.id, r]));
    const responsible = a.results
      .filter((r) => {
        const previous = beforeResults.get(r.id);
        if (previous === undefined) return r.verdict !== "pass";
        return previous.verdict !== r.verdict || previous.unmodeled !== r.unmodeled;
      })
      .map((r) => r.id);
    flips.push({ patient: b.patient, from, to, responsible });
  }

  const before = displayBandCounts(beforeEvals);
  const after = displayBandCounts(afterEvals);
  return {
    before,
    after,
    flips,
    moved: DISPLAY_BANDS.filter((band) => before[band] !== after[band]),
  };
}

/** "potentially eligible 0 → 1, screen fail 7 → 6" — only the bands that moved. */
export const deltaLine = (impact: AmendmentImpact): string =>
  impact.moved.length === 0
    ? "no band changes size"
    : impact.moved
        .map((b) => `${BAND_LABEL[b]} ${impact.before[b]} → ${impact.after[b]}`)
        .join(", ");

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
