/** Trace tree → one line of prose (design spec §5, G3). */
import type { CriterionResult, TraceNode } from "../engine/api.js";

export function traceProse(node: TraceNode): string {
  if (node.kind === "leaf") return node.detail;
  const children = (node.children ?? []).map(traceProse);
  if (node.kind === "not") return `not (${children[0] ?? ""})`;
  return children.join(node.kind === "all" ? " and " : " or ");
}

export function resultProse(r: CriterionResult): string {
  if (r.unmodeled) return "not computable from structured data — chart review required";
  const body = r.trace ? traceProse(r.trace) : "";
  if (r.verdict === "unknown") return body;
  if (r.kind === "exclusion" && r.verdict === "fail") return `${body}, exclusion fired`;
  return body;
}

export const markFor = (verdict: CriterionResult["verdict"]): "elig" | "fail" | "ne" =>
  verdict === "pass" ? "elig" : verdict === "fail" ? "fail" : "ne";
