import type { ProposedFactCard } from "./types.js";

/**
 * Queue order (design spec §11): **decision impact first**, then ascending
 * confidence.
 *
 * Impact first because a fact that would flip a patient's overall verdict is
 * worth a reviewer's attention regardless of how sure the model is, and a fact
 * that changes no verdict can wait however sure it is.
 *
 * Then *ascending* confidence, which reads backwards until you say it out loud:
 * the queue surfaces what the model is least sure of, because that is where a
 * human adds the most value. Sorting confident-first would put the reviewer's
 * scarce attention exactly where it is least needed.
 *
 * Ties break on `id` so the order is total and the rendered list never
 * reshuffles between renders.
 */
export function sortReviewQueue(items: readonly ProposedFactCard[]): ProposedFactCard[] {
  return [...items].sort((a, b) => {
    if (a.flipsVerdict !== b.flipsVerdict) return a.flipsVerdict ? -1 : 1;
    if (a.confidence !== b.confidence) return a.confidence - b.confidence;
    return a.id.localeCompare(b.id);
  });
}

export type Span = { before: string; match: string; after: string };

/**
 * The same span, trimmed to `context` sentences either side of the quote.
 *
 * The shipped build rendered the whole note in every card — 16,068px of content
 * in an 800px viewport, with the Confirm button 276px below the fold on the
 * *first* card (uiux B2). A reviewer checking a quote needs the sentence it sits
 * in and its neighbours, not the e-signature block; the full note stays one
 * click away.
 *
 * Returns `null` when the quote does not resolve, exactly like `highlightSpan`,
 * and `truncated` says whether anything was cut so the card can offer the
 * expand control only when there is something to expand.
 */
export function excerptSpan(
  text: string,
  quote: string,
  context = 1,
): (Span & { truncated: boolean }) | null {
  const span = highlightSpan(text, quote);
  if (span === null) return null;
  const before = tailSentences(span.before, context);
  const after = headSentences(span.after, context);
  return {
    before: before.text,
    match: span.match,
    after: after.text,
    truncated: before.cut || after.cut,
  };
}

/** Sentence-ish boundaries: terminator + whitespace, or a blank line. */
const BOUNDARY = /(?<=[.!?])\s+|\n{2,}/g;

function tailSentences(text: string, n: number): { text: string; cut: boolean } {
  const parts = splitKeeping(text);
  // The last part is the sentence the quote starts inside, so keep it plus the
  // `n` complete sentences before it.
  if (parts.length <= n + 1) return { text, cut: false };
  const kept = parts.slice(parts.length - (n + 1)).join("");
  return { text: kept.replace(/^\s+/, ""), cut: true };
}

function headSentences(text: string, n: number): { text: string; cut: boolean } {
  const parts = splitKeeping(text);
  // The quote usually ends mid-sentence, so the first part finishes it and the
  // next `n` are the context sentences asked for.
  if (parts.length <= n + 1) return { text, cut: false };
  return { text: parts.slice(0, n + 1).join("").replace(/\s+$/, ""), cut: true };
}

function splitKeeping(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(BOUNDARY)) {
    out.push(text.slice(last, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Split `text` around the first occurrence of `quote`, for highlighting. */
export function highlightSpan(text: string, quote: string): Span | null {
  if (quote.length === 0) return null;
  // Newline normalization only — the same rule the grounding gate applies, so
  // the pane highlights exactly what the gate accepted and nothing else. If
  // this returns null the quote no longer resolves, and the card says so
  // rather than silently rendering plain text.
  const norm = (s: string): string => s.replace(/\r\n?/g, "\n");
  const haystack = norm(text);
  const needle = norm(quote);
  const at = haystack.indexOf(needle);
  if (at === -1) return null;
  return {
    before: haystack.slice(0, at),
    match: haystack.slice(at, at + needle.length),
    after: haystack.slice(at + needle.length),
  };
}
