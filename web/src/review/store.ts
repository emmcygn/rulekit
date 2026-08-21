/**
 * The review queue's in-memory store (design spec §11, goals G10/G11).
 *
 * The rulekit invariant is that a proposed fact is invisible to the engine until
 * a human confirms it. `applyReview` is that invariant applied to the workbench
 * cohort: every entry in `corpus/facts/*.yaml` that is still `proposed` and
 * still undecided is *withheld* from the patient the evaluator sees, even when
 * the structured fixture happens to carry a value for the same fact. Confirming
 * a card puts the proposed (or human-corrected) value in front of the engine,
 * the cohort is re-evaluated, and the funnel's "not evaluable" band shrinks by
 * exactly the patients whose last pending fact was just decided.
 *
 * Session-scoped and in-memory by design: nothing here writes a facts.yaml.
 * Reload and every decision is gone, which is the honest shape for a demo that
 * must never look like a system of record.
 *
 * Pure: no React, no filesystem. `web/src/review/ReviewView.tsx` holds the state
 * and this module computes with it.
 */
import type { PatientFacts, FactValue } from "../../../src/core/schema.js";
import type { FactEntry, FactsFile } from "../../../src/extract/schema.js";
import type { ProposedFactCard } from "./types.js";
import type { Engine } from "../engine/api.js";

export type Decision = "pending" | "confirmed" | "rejected";

/** A decision plus, when the reviewer corrected the value, what they typed. */
export type ReviewDecision = { decision: Decision; value?: FactValue };

/** cardId -> decision. Absent means pending. */
export type ReviewState = Record<string, ReviewDecision>;

export const cardId = (patient: string, fact: string): string => `${patient}:${fact}`;

/**
 * The entries a human can still act on. `pipeline` facts were never in doubt and
 * entries already carrying a decision in the file are history, not queue.
 */
export const reviewableEntries = (file: FactsFile): FactEntry[] =>
  file.facts.filter((e) => e.status === "proposed");

export const initialReviewState = (_files: FactsFile[]): ReviewState => ({});

const decisionFor = (state: ReviewState, id: string): ReviewDecision =>
  state[id] ?? { decision: "pending" };

/** Immutable update — React state, so never mutate in place. */
export function decide(
  state: ReviewState,
  id: string,
  decision: Decision,
  editedValue?: string,
): ReviewState {
  const next: ReviewDecision = { decision };
  if (editedValue !== undefined) next.value = editedValue;
  return { ...state, [id]: next };
}

export function pendingCount(files: FactsFile[], state: ReviewState): number {
  let n = 0;
  for (const file of files) {
    for (const entry of reviewableEntries(file)) {
      if (decisionFor(state, cardId(file.patient, entry.fact)).decision === "pending") n++;
    }
  }
  return n;
}

/**
 * Coerce a reviewer's typed correction to the shape of the value it replaces.
 * A number stays a number so the evaluator compares rather than string-compares;
 * anything that will not parse falls back to the model's proposal, because a
 * NaN reaching the engine is worse than an unedited confirm.
 */
function coerceEdit(edited: FactValue, original: FactValue): FactValue {
  if (typeof edited !== "string") return edited;
  if (typeof original === "number") {
    const n = Number(edited.trim());
    return Number.isFinite(n) ? n : original;
  }
  if (typeof original === "boolean") {
    const t = edited.trim().toLowerCase();
    return t === "true" ? true : t === "false" ? false : original;
  }
  return edited;
}

/** What the engine is allowed to see, given the decisions made so far. */
export function applyReview(
  cohort: PatientFacts[],
  files: FactsFile[],
  state: ReviewState,
): PatientFacts[] {
  const byPatient = new Map(files.map((f) => [f.patient, f]));
  return cohort.map((patient) => {
    const file = byPatient.get(patient.patient);
    if (file === undefined) return patient;

    const facts: Record<string, FactValue> = { ...patient.facts };
    for (const entry of reviewableEntries(file)) {
      const { decision, value } = decisionFor(state, cardId(patient.patient, entry.fact));
      if (decision === "confirmed") {
        facts[entry.fact] =
          value === undefined
            ? structuredClone(entry.value)
            : coerceEdit(value, entry.value);
      } else {
        // Pending or rejected: the engine does not get to see it, and it does
        // not get to fall back on the structured fixture's value either.
        delete facts[entry.fact];
      }
    }
    return { patient: patient.patient, facts };
  });
}

/**
 * Where this patient lands in the screening funnel — the three bands the
 * headline counts, not the engine's `overall`. `overall` is the wrong signal
 * for the impact badge: an unmodeled criterion pins every patient in this rule
 * set at "undetermined", so it would never move and every card would read
 * "changes nothing".
 *
 * Same walk `computeFunnel` does, for one patient: criteria in order, first
 * non-pass decides, unmodeled criteria park rather than drain.
 */
export type FunnelOutcome = "screen fail" | "not evaluable" | "potentially eligible";

export function funnelOutcome(evaluation: { results: { verdict: string; unmodeled: boolean }[] }): FunnelOutcome {
  for (const r of evaluation.results) {
    if (r.unmodeled) continue;
    if (r.verdict === "fail") return "screen fail";
    if (r.verdict === "unknown") return "not evaluable";
  }
  return "potentially eligible";
}

const formatValue = (v: FactValue): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "—";

export type BuildCardsInput = {
  cohort: PatientFacts[];
  files: FactsFile[];
  notes: Record<string, string>;
  rulesetYaml: string;
  engine: Engine;
  state: ReviewState;
};

/**
 * One card per still-pending proposal, with the impact badge computed by asking
 * the real engine twice: once with the fact withheld and once with it confirmed.
 * "Would this decision change the answer" is not a heuristic here — it is the
 * engine's own verdict on both worlds.
 */
export function buildCards({
  cohort,
  files,
  notes,
  rulesetYaml,
  engine,
  state,
}: BuildCardsInput): ProposedFactCard[] {
  const byPatient = new Map(files.map((f) => [f.patient, f]));
  const cards: ProposedFactCard[] = [];

  for (const patient of cohort) {
    const file = byPatient.get(patient.patient);
    if (file === undefined) continue;

    const [withheld] = applyReview([patient], files, state);
    if (withheld === undefined) continue;
    const before = funnelOutcome(engine.evalPatient(rulesetYaml, withheld));

    for (const entry of reviewableEntries(file)) {
      const id = cardId(patient.patient, entry.fact);
      if (decisionFor(state, id).decision !== "pending") continue;

      const [confirmed] = applyReview([patient], files, decide(state, id, "confirmed"));
      const after =
        confirmed === undefined ? before : funnelOutcome(engine.evalPatient(rulesetYaml, confirmed));

      const card: ProposedFactCard = {
        id,
        patient: patient.patient,
        fact: entry.fact,
        value: formatValue(entry.value),
        confidence: entry.confidence ?? 0,
        doc: entry.source?.doc ?? "—",
        quote: entry.source?.quote ?? "",
        noteContext: notes[entry.source?.doc ?? ""] ?? "",
        flipsVerdict: after !== before,
      };
      if (entry.unit !== undefined) card.unit = entry.unit;
      if (after !== before) card.impact = `${before} → ${after}`;
      cards.push(card);
    }
  }
  return cards;
}
