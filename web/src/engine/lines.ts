/**
 * Map criterion ids to source lines so a finding can point at the YAML —
 * squiggles in the editor, "ruleset.yaml:22" in the Checks panel.
 */
import { LineCounter, isMap, isSeq, parseDocument } from "yaml";

export type CriterionSpan = { id: string; line: number; endLine: number; whenLine: number };

export function criterionSpans(yamlText: string): Map<string, CriterionSpan> {
  const out = new Map<string, CriterionSpan>();
  const lineCounter = new LineCounter();
  let doc;
  try {
    doc = parseDocument(yamlText, { lineCounter, keepSourceTokens: true });
  } catch {
    return out;
  }
  const criteria = doc.get("criteria", true);
  if (!isSeq(criteria)) return out;

  const lineAt = (offset: number | undefined) =>
    offset === undefined ? 1 : lineCounter.linePos(offset).line;

  for (const item of criteria.items) {
    if (!isMap(item)) continue;
    const id = item.get("id");
    if (typeof id !== "string") continue;
    const range = item.range;
    const when = item.get("when", true) as { range?: [number, number, number] } | undefined;
    out.set(id, {
      id,
      line: lineAt(range?.[0]),
      endLine: lineAt(range?.[1]),
      whenLine: lineAt(when?.range?.[0] ?? range?.[0]),
    });
  }
  return out;
}

/** The line a finding should point at: its first criterion's condition. */
export function findingLine(
  spans: Map<string, CriterionSpan>,
  criteria: string[],
): number | undefined {
  for (const id of criteria) {
    const span = spans.get(id);
    if (span) return span.whenLine;
  }
  return undefined;
}
