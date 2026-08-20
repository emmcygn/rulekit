/**
 * The grounding gate (design spec §11).
 *
 * A proposed fact that cannot cite its source does not exist. Everything the
 * extraction model emits passes through here before it is allowed to become a
 * line in a facts.yaml, and three things must hold:
 *
 *   1. the `quote` appears **verbatim** in the source document;
 *   2. the `value` parses to the fact model's declared type and unit;
 *   3. the fact name exists in the fact model.
 *
 * Nothing is dropped silently. Every input comes back either in `grounded` or
 * in `rejected` with the reasons attached, because "the model proposed X and we
 * threw it away" is the interesting half of an extraction run — it is what the
 * eval suite measures and what a reviewer needs to see.
 *
 * This module is pure: no filesystem, no network, no clock.
 */
import type { FactDecl, FactModel } from "../core/schema.js";
import type { FactEntry, FactSource, FactFileValue, CodeEntry } from "./schema.js";

export type RejectionReason =
  | "unknown-fact"
  | "missing-source"
  | "doc-not-found"
  | "quote-not-found"
  | "type-mismatch"
  | "unit-mismatch"
  | "missing-unit"
  | "value-not-allowed"
  | "unknown-code-system"
  | "duplicate-fact";

export type Rejection = {
  fact: string;
  value: unknown;
  unit?: string;
  confidence?: number;
  source?: FactSource;
  reasons: RejectionReason[];
  /** Human-readable, one clause per reason, ready for CLI output. */
  detail: string;
};

/** What the extraction model emits. Values arrive as strings; typing happens here. */
export type ProposedFact = {
  fact: string;
  value: string;
  unit?: string;
  confidence: number;
  quote: string;
};

export type GroundingContext = {
  factModel: FactModel;
  /** doc id -> groundable text (note bodies only — see notes.ts). */
  documents: Record<string, string>;
};

export type GroundingResult = { grounded: FactEntry[]; rejected: Rejection[] };

/**
 * Line-ending normalization, and nothing else.
 *
 * The verbatim check is a plain substring test after CRLF/CR are folded to LF.
 * That is the *only* transformation applied — deliberately. Every looser match
 * (case folding, whitespace collapsing, unicode normalization, punctuation
 * stripping, fuzzy distance) buys a little tolerance for note formatting and
 * pays for it by admitting paraphrase, which is exactly the failure mode the
 * gate exists to stop: a model that rewrites the record slightly while claiming
 * to quote it. A quote is a pointer into the document; a pointer either
 * resolves or it doesn't.
 *
 * Line endings are the one exception because they are an artifact of file
 * transport, not of the record's content, and normalizing them is lossless. The
 * cost is that the corpus notes must not reflow sentences across newlines —
 * enforced by a test in tests/extract/notes.test.ts.
 */
export const normalizeNewlines = (s: string): string => s.replace(/\r\n?/g, "\n");

export function quoteAppearsVerbatim(quote: string, document: string): boolean {
  const q = normalizeNewlines(quote);
  if (q.trim().length === 0) return false; // the empty quote matches everything
  return normalizeNewlines(document).includes(q);
}

// Plain decimal only. Rejects ranges ("40-45"), comparators (">60"), hedges
// ("approximately 32"), smuggled units ("58 mL/min"), exponents, hex, NaN and
// Infinity. A clinician writing a range meant a range; inventing a midpoint is
// fabrication with extra steps.
const DECIMAL = /^-?\d+(\.\d+)?$/;

type Coerced = { ok: true; value: FactFileValue } | { ok: false; reason: RejectionReason; detail: string };

function coerceValue(raw: unknown, fact: string, decl: FactDecl): Coerced {
  switch (decl.type) {
    case "number": {
      if (typeof raw === "number") {
        return Number.isFinite(raw)
          ? { ok: true, value: raw }
          : { ok: false, reason: "type-mismatch", detail: `${fact}: value is not a finite number` };
      }
      if (typeof raw === "string" && DECIMAL.test(raw.trim())) {
        return { ok: true, value: Number(raw.trim()) };
      }
      return {
        ok: false,
        reason: "type-mismatch",
        detail: `${fact}: ${JSON.stringify(raw)} does not parse as a number (fact model declares type number)`,
      };
    }
    case "enum": {
      if (typeof raw !== "string") {
        return { ok: false, reason: "type-mismatch", detail: `${fact}: enum values must be strings, got ${typeof raw}` };
      }
      if (!decl.values.includes(raw)) {
        return {
          ok: false,
          reason: "value-not-allowed",
          detail: `${fact}: ${JSON.stringify(raw)} is not one of the declared values [${decl.values.join(", ")}]`,
        };
      }
      return { ok: true, value: raw };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return {
        ok: false,
        reason: "type-mismatch",
        detail: `${fact}: ${JSON.stringify(raw)} is not a boolean (expected true or false)`,
      };
    }
    case "code": {
      if (!Array.isArray(raw)) {
        return {
          ok: false,
          reason: "type-mismatch",
          detail: `${fact}: code-valued facts come from the deterministic pipeline as a coded list, not from narrative extraction`,
        };
      }
      const entries = raw as CodeEntry[];
      const bad = entries.filter((e) => !decl.systems.includes(e.system)).map((e) => e.system);
      if (bad.length > 0) {
        return {
          ok: false,
          reason: "unknown-code-system",
          detail: `${fact}: code system(s) [${[...new Set(bad)].join(", ")}] not declared (allowed: ${decl.systems.join(", ")})`,
        };
      }
      return { ok: true, value: entries };
    }
  }
}

function checkUnit(fact: string, unit: string | undefined, decl: FactDecl): { reason: RejectionReason; detail: string } | null {
  const declared = decl.type === "number" ? decl.unit : undefined;
  const given = unit?.trim();
  if (declared === undefined) {
    if (given !== undefined && given.length > 0) {
      return { reason: "unit-mismatch", detail: `${fact}: fact model declares no unit, got ${JSON.stringify(unit)}` };
    }
    return null;
  }
  if (given === undefined || given.length === 0) {
    return { reason: "missing-unit", detail: `${fact}: fact model declares unit ${JSON.stringify(declared)}, none given` };
  }
  // Exact match. UCUM equivalence ("%" vs "percent", "mL/min" vs "ml/min") is a
  // normalization concern that belongs to the ingest pipeline, not to the gate;
  // silently accepting near-units here would let a real unit error through.
  if (given !== declared) {
    return {
      reason: "unit-mismatch",
      detail: `${fact}: unit ${JSON.stringify(given)} does not match declared unit ${JSON.stringify(declared)}`,
    };
  }
  return null;
}

function reject(
  base: { fact: string; value: unknown; unit?: string; confidence?: number; source?: FactSource },
  failures: { reason: RejectionReason; detail: string }[],
): Rejection {
  return {
    ...base,
    reasons: failures.map((f) => f.reason),
    detail: failures.map((f) => f.detail).join("; "),
  };
}

/**
 * Run the gate over one extraction call's output.
 *
 * `doc` is the document the call was made against — the model does not get to
 * choose which document its quote is checked against.
 */
export function groundProposedFacts(
  proposed: readonly ProposedFact[],
  opts: { doc: string; extractedBy: string; ctx: GroundingContext },
): GroundingResult {
  const { doc, extractedBy, ctx } = opts;
  const grounded: FactEntry[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  for (const pf of proposed) {
    const source: FactSource = { doc, quote: pf.quote };
    const base = { fact: pf.fact, value: pf.value as unknown, unit: pf.unit, confidence: pf.confidence, source };
    const failures: { reason: RejectionReason; detail: string }[] = [];

    // (3) fact name exists in the fact model
    const decl = ctx.factModel.facts[pf.fact];
    if (decl === undefined) {
      failures.push({
        reason: "unknown-fact",
        detail: `${pf.fact}: not declared in fact model ${ctx.factModel.name}`,
      });
    }

    // (1) quote appears verbatim in the source document
    const document = ctx.documents[doc];
    if (pf.quote.trim().length === 0) {
      failures.push({ reason: "missing-source", detail: `${pf.fact}: no quote — a fact that cannot cite its source does not exist` });
    } else if (document === undefined) {
      failures.push({ reason: "doc-not-found", detail: `${pf.fact}: source document '${doc}' is not in the corpus` });
    } else if (!quoteAppearsVerbatim(pf.quote, document)) {
      failures.push({
        reason: "quote-not-found",
        detail: `${pf.fact}: quote ${JSON.stringify(pf.quote)} does not appear verbatim in '${doc}'`,
      });
    }

    // (2) value parses to the declared type and unit
    let value: FactFileValue | undefined;
    if (decl !== undefined) {
      const unitFailure = checkUnit(pf.fact, pf.unit, decl);
      if (unitFailure) failures.push(unitFailure);
      const coerced = coerceValue(pf.value, pf.fact, decl);
      if (coerced.ok) value = coerced.value;
      else failures.push({ reason: coerced.reason, detail: coerced.detail });
    }

    if (seen.has(pf.fact)) {
      failures.push({
        reason: "duplicate-fact",
        detail: `${pf.fact}: already proposed in this extraction; a fact may hold only one live value`,
      });
    }

    if (failures.length > 0 || value === undefined) {
      rejected.push(reject(base, failures));
      continue;
    }

    seen.add(pf.fact);
    // The unit is taken from the fact model, not from the model's output: it
    // was already checked equal, and sourcing it from the declaration keeps
    // every facts.yaml spelling it the same way.
    const declaredUnit = decl !== undefined && decl.type === "number" ? decl.unit : undefined;
    grounded.push({
      fact: pf.fact,
      value,
      ...(declaredUnit !== undefined ? { unit: declaredUnit } : {}),
      status: "proposed", // never anything else — no confidence auto-confirms (spec §2, non-goal 2)
      confidence: pf.confidence,
      extractedBy,
      source,
      reviewedBy: null,
    });
  }

  return { grounded, rejected };
}

/**
 * Re-verify an entry already written to a facts.yaml. This is what `facts check`
 * runs: the file is under human control and under git, so the quote could have
 * drifted from the note, or a value could have been hand-edited into the wrong
 * type since it was grounded.
 *
 * Rejected entries are tombstones — often rejected *because* the quote was
 * fabricated — so only their fact name is checked.
 */
export function verifyFactEntry(entry: FactEntry, ctx: GroundingContext): Rejection[] {
  const failures: { reason: RejectionReason; detail: string }[] = [];
  const decl = ctx.factModel.facts[entry.fact];

  if (decl === undefined) {
    failures.push({ reason: "unknown-fact", detail: `${entry.fact}: not declared in fact model ${ctx.factModel.name}` });
  }

  if (entry.status === "rejected") {
    return failures.length > 0
      ? [reject({ fact: entry.fact, value: entry.value, unit: entry.unit, confidence: entry.confidence, source: entry.source }, failures)]
      : [];
  }

  if (entry.extractedBy.startsWith("llm/") && entry.source === undefined) {
    failures.push({ reason: "missing-source", detail: `${entry.fact}: llm-extracted fact with no source` });
  }
  if (entry.source !== undefined) {
    const document = ctx.documents[entry.source.doc];
    if (document === undefined) {
      failures.push({ reason: "doc-not-found", detail: `${entry.fact}: source document '${entry.source.doc}' is not in the corpus` });
    } else if (!quoteAppearsVerbatim(entry.source.quote, document)) {
      failures.push({
        reason: "quote-not-found",
        detail: `${entry.fact}: quote ${JSON.stringify(entry.source.quote)} no longer appears verbatim in '${entry.source.doc}'`,
      });
    }
  }

  if (decl !== undefined) {
    const unitFailure = checkUnit(entry.fact, entry.unit, decl);
    if (unitFailure) failures.push(unitFailure);
    const coerced = coerceValue(entry.value, entry.fact, decl);
    if (!coerced.ok) failures.push({ reason: coerced.reason, detail: coerced.detail });
  }

  if (failures.length === 0) return [];
  return [reject({ fact: entry.fact, value: entry.value, unit: entry.unit, confidence: entry.confidence, source: entry.source }, failures)];
}
