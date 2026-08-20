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

/** Split `text` around the first occurrence of `quote`, for highlighting. */
export function highlightSpan(text: string, quote: string): { before: string; match: string; after: string } | null {
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
