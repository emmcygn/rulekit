import type { Condition, Leaf, PatientFacts, FactValue, CodeEntry, CodeRef } from "./schema.js";
import { andTri, orTri, notTri, type Tri } from "./tri.js";

export type TraceNode = {
  kind: "all" | "any" | "not" | "leaf";
  result: Tri;
  detail: string;
  children?: TraceNode[];
  observed?: FactValue | null;
};

const OP_TEXT: Record<string, string> = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function isCodeEntries(v: FactValue): v is CodeEntry[] {
  return Array.isArray(v);
}

function codeMatch(entry: CodeEntry, codes: CodeRef): boolean {
  return entry.system === codes.system && codes.values.includes(entry.code);
}

function evalLeaf(leaf: Leaf, facts: PatientFacts): TraceNode {
  const v = facts.facts[leaf.fact];
  const observed = v === undefined ? null : v;

  if (leaf.op === "exists") {
    const result: Tri = v === undefined ? "false" : "true";
    return { kind: "leaf", result, observed, detail: `${leaf.fact} ${v === undefined ? "absent" : "present"}` };
  }
  if (v === undefined) {
    return { kind: "leaf", result: "unknown", observed, detail: `${leaf.fact} missing → unknown` };
  }

  if (leaf.op === "anyWithin") {
    if (!isCodeEntries(v)) return { kind: "leaf", result: "unknown", observed, detail: `${leaf.fact} is not a code list → unknown` };
    const matching = v.filter((e) => codeMatch(e, leaf.codes));
    if (matching.some((e) => e.daysAgo !== undefined && e.daysAgo <= leaf.windowDays))
      return { kind: "leaf", result: "true", observed, detail: `${leaf.fact}: match inside ${leaf.windowDays}d window` };
    if (matching.some((e) => e.daysAgo === undefined))
      return { kind: "leaf", result: "unknown", observed, detail: `${leaf.fact}: matching entry with no date → unknown` };
    return { kind: "leaf", result: "false", observed, detail: `${leaf.fact}: no match inside ${leaf.windowDays}d window` };
  }

  // `in` / `notIn`. Checked with `"codes" in leaf` rather than on `op`: SetLeaf's
  // op is itself a union, and TS drops a union member from the else-branch only
  // when its discriminant is a single literal, so `op !== "in" && op !== "notIn"`
  // would leave SetLeaf in the type below and break the numeric narrowing.
  if ("codes" in leaf) {
    if (!isCodeEntries(v)) return { kind: "leaf", result: "unknown", observed, detail: `${leaf.fact} is not a code list → unknown` };
    const hit = v.some((e) => codeMatch(e, leaf.codes));
    const result: Tri = leaf.op === "in" ? (hit ? "true" : "false") : hit ? "false" : "true";
    return { kind: "leaf", result, observed, detail: `${leaf.fact} ${hit ? "contains" : "lacks"} ${leaf.codes.system}:{${leaf.codes.values.join(",")}}` };
  }

  // numeric ops
  if (typeof v !== "number")
    return { kind: "leaf", result: "unknown", observed, detail: `${leaf.fact} = ${JSON.stringify(v)} (non-numeric) → unknown` };
  const cmp: Record<string, boolean> = {
    eq: v === leaf.value, neq: v !== leaf.value, gt: v > leaf.value, gte: v >= leaf.value, lt: v < leaf.value, lte: v <= leaf.value,
  };
  const ok = cmp[leaf.op]!;
  return {
    kind: "leaf", result: ok ? "true" : "false", observed,
    detail: `${leaf.fact} = ${v}, required ${OP_TEXT[leaf.op]} ${leaf.value}`,
  };
}

export function evalCondition(cond: Condition, facts: PatientFacts): TraceNode {
  if ("all" in cond) {
    const children = cond.all.map((c) => evalCondition(c, facts));
    return { kind: "all", result: andTri(children.map((c) => c.result)), detail: "all of", children };
  }
  if ("any" in cond) {
    const children = cond.any.map((c) => evalCondition(c, facts));
    return { kind: "any", result: orTri(children.map((c) => c.result)), detail: "any of", children };
  }
  if ("not" in cond) {
    const child = evalCondition(cond.not, facts);
    return { kind: "not", result: notTri(child.result), detail: "not", children: [child] };
  }
  return evalLeaf(cond, facts);
}
