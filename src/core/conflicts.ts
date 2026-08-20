import type { Condition, FactModel, Leaf, NumericLeaf, RuleSet } from "./schema.js";
import { FULL, fromLeaf, intersect, isEmpty, fmtInterval, type Interval } from "./interval.js";
import { lintRuleSet, type Finding } from "./lint.js";

const INTERVAL_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

function isNumericIntervalLeaf(l: Leaf): l is NumericLeaf {
  return INTERVAL_OPS.has(l.op);
}

/** Leaves reachable through `all` chains only; null if condition contains any/not. */
function allChainLeaves(cond: Condition): Leaf[] | null {
  if ("any" in cond || "not" in cond) return null;
  if ("all" in cond) {
    const parts = cond.all.map(allChainLeaves);
    if (parts.some((p) => p === null)) return null;
    return parts.flatMap((p) => p as Leaf[]);
  }
  return [cond];
}

/** Per-fact intervals for one criterion, or null when not analyzable. */
function criterionIntervals(cond: Condition): Map<string, Interval> | null {
  const leaves = allChainLeaves(cond);
  if (leaves === null) return null;
  const map = new Map<string, Interval>();
  for (const leaf of leaves) {
    if (!isNumericIntervalLeaf(leaf)) continue;
    const prev = map.get(leaf.fact) ?? FULL;
    map.set(leaf.fact, intersect(prev, fromLeaf(leaf.op as "eq" | "gt" | "gte" | "lt" | "lte", leaf.value)));
  }
  return map;
}

export function detectConflicts(rs: RuleSet): Finding[] {
  const out: Finding[] = [];
  const analyzed: { id: string; kind: "inclusion" | "exclusion"; intervals: Map<string, Interval> }[] = [];

  for (const c of rs.criteria) {
    if (c.when === undefined) continue;
    const intervals = criterionIntervals(c.when);
    if (intervals === null) continue;
    for (const [fact, iv] of intervals) {
      if (isEmpty(iv)) {
        out.push({ level: "error", code: "unsatisfiable-criterion", criteria: [c.id], message: `"${c.id}" can never fire: its own constraints on ${fact} intersect to the empty set`, evidence: `${fact}: ${fmtInterval(iv)}` });
      }
    }
    if (intervals.size > 0) analyzed.push({ id: c.id, kind: c.kind, intervals });
  }

  // inclusion-admitted interval per fact
  const admitted = new Map<string, { interval: Interval; sources: string[] }>();
  for (const a of analyzed.filter((x) => x.kind === "inclusion")) {
    for (const [fact, iv] of a.intervals) {
      const prev = admitted.get(fact) ?? { interval: FULL, sources: [] };
      admitted.set(fact, { interval: intersect(prev.interval, iv), sources: [...prev.sources, a.id] });
    }
  }

  for (const e of analyzed.filter((x) => x.kind === "exclusion")) {
    for (const [fact, exclIv] of e.intervals) {
      const adm = admitted.get(fact);
      if (adm === undefined) continue;
      const band = intersect(adm.interval, exclIv);
      if (!isEmpty(band)) {
        out.push({
          level: "error",
          code: "contradictory-band",
          criteria: [...adm.sources, e.id],
          message: `every patient with ${fact} in ${fmtInterval(band)} passes inclusion and is then excluded by "${e.id}" — for all inputs, not just a test corpus`,
          evidence: `${fact}: inclusion admits ${fmtInterval(adm.interval)} ∩ exclusion fires ${fmtInterval(exclIv)} → contradictory band ${fmtInterval(band)}`,
        });
      }
    }
  }
  return out;
}

export function checkRuleSet(rs: RuleSet, fm: FactModel): Finding[] {
  return [...lintRuleSet(rs, fm), ...detectConflicts(rs)];
}
