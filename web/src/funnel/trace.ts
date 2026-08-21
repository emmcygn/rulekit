/** Trace tree → one line of prose (design spec §5, G3). */
import type { CriterionResult, TraceNode } from "../engine/api.js";
import { isParked } from "../engine/attrition.js";

export function traceProse(node: TraceNode): string {
  if (node.kind === "leaf") return node.detail;
  const children = (node.children ?? []).map(traceProse);
  if (node.kind === "not") return `not (${children[0] ?? ""})`;
  return children.join(node.kind === "all" ? " and " : " or ");
}

export function resultProse(r: CriterionResult): string {
  // A chart-review resolution is a reviewer's decision, not an engine verdict,
  // and the line says so rather than reading like a computed result.
  if (r.chartReview) return `chart review — ${r.chartReview.detail}`;
  if (r.unmodeled) return "not computable from structured data — chart review required";
  const body = r.trace ? traceProse(r.trace) : "";
  if (r.verdict === "unknown") return body;
  if (r.kind === "exclusion" && r.verdict === "fail") return `${body}, exclusion fired`;
  return body;
}

/**
 * Mark for one criterion result. `cr` (pending chart review) is its own mark:
 * folding it into "not evaluable" was the fourth unlegended status the review
 * caught (uiux B4).
 */
export const markFor = (r: CriterionResult | CriterionResult["verdict"]): "elig" | "fail" | "ne" | "cr" => {
  if (typeof r === "string") return r === "pass" ? "elig" : r === "fail" ? "fail" : "ne";
  if (isParked(r)) return "cr";
  return r.verdict === "pass" ? "elig" : r.verdict === "fail" ? "fail" : "ne";
};
