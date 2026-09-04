/**
 * The review queue's store (design spec §11, goals G10/G11).
 *
 * The rulekit invariant is that a proposed fact is invisible to the engine until
 * a human confirms it. `applyReview` is that invariant applied to the workbench
 * cohort — and *only* that. It used to also delete the structured fixture's own
 * value whenever a proposal existed for the same fact, which manufactured the
 * "not evaluable" band the Review tab existed to shrink (uiux B6): SYN-007's
 * `egfr: 38`, SYN-019's `egfr: 42` and SYN-042's `lvef: 38` are all real
 * structured records, and none of them stop being real because a model also
 * read a number off a note. Withholding the *proposal* is correct. Deleting the
 * *record* was not, and it is gone: `applyReview` now merges.
 *
 * Confirming a proposal that contradicts a structured value is therefore an
 * explicit override, and the card says so with both numbers on screen before
 * the click (`structured` / `value` on ProposedFactCard).
 *
 * Decisions persist to localStorage and can be exported as stamped facts files
 * (`decisionsYaml`), so two coordinators can tell why their numbers differ.
 *
 * Pure: no React, no filesystem. `web/src/review/ReviewView.tsx` holds the state
 * and this module computes with it.
 */
import { stringify } from "yaml";
import { parseRuleSet, type Condition, type PatientFacts, type FactValue } from "../../../src/core/schema.js";
import type { FactEntry, FactsFile } from "../../../src/extract/schema.js";
import { CHART_REVIEW_RULES } from "../engine/chart-review.js";
import { displayBandOf, BAND_LABEL, type DisplayBand } from "../funnel/bands.js";
import type { ProposedFactCard } from "./types.js";
import type { Engine } from "../engine/api.js";

export type Decision = "pending" | "confirmed" | "rejected";

/** A decision plus, when the reviewer corrected the value, what they typed. */
export type ReviewDecision = { decision: Decision; value?: FactValue; at?: string };

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
  editedValue?: FactValue,
  at: string = new Date().toISOString(),
): ReviewState {
  const next: ReviewDecision = { decision, at };
  if (editedValue !== undefined) next.value = editedValue;
  return { ...state, [id]: next };
}

/* --------------------------------------------------------- edit validation */

export type EditResult =
  | { ok: true; value: FactValue }
  | { ok: false; message: string };

/**
 * Validate a reviewer's typed correction against the shape of the value it
 * replaces.
 *
 * This used to silently fall back to the model's proposal when the input would
 * not parse, so typing "banana" into an eGFR box reported success and ratified
 * the model's 62 (uiux B1 — the single worst bug in the build). A reviewer's
 * correction is either usable or it is refused out loud; there is no third
 * option in which the screen says "saved" and the engine gets something else.
 */
export function parseEdit(edited: string, original: FactValue, unit?: string): EditResult {
  const text = edited.trim();
  if (text.length === 0) return { ok: false, message: "Enter a value — an empty correction cannot be saved." };

  if (typeof original === "number") {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        message: `"${edited}" is not a number. Enter a number${unit ? ` in ${unit}` : ""} — the rules compare this value numerically.`,
      };
    }
    return { ok: true, value: n };
  }

  if (typeof original === "boolean") {
    const t = text.toLowerCase();
    if (t === "true" || t === "yes") return { ok: true, value: true };
    if (t === "false" || t === "no") return { ok: true, value: false };
    return { ok: false, message: `"${edited}" is not true or false. Enter true or false.` };
  }

  if (Array.isArray(original)) {
    return { ok: false, message: "Code lists cannot be edited here — reject the proposal instead." };
  }

  return { ok: true, value: text };
}

/**
 * The card carries its value already formatted for display, so recover the type
 * the engine will compare before validating a correction against it. "58" is a
 * number, "true" is a boolean, "III" is an enum member.
 */
export function originalValueOf(display: string | number | boolean): FactValue {
  if (typeof display !== "string") return display;
  if (/^-?\d+(\.\d+)?$/.test(display.trim())) return Number(display);
  const t = display.trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  return display;
}

/** Validate a draft against the card it belongs to. */
export const checkCardEdit = (
  card: { value: string | number | boolean; unit?: string },
  draft: string,
): EditResult => parseEdit(draft, originalValueOf(card.value), card.unit);

/**
 * Values an enum-valued fact accepts, when the workbench knows them. Used to
 * offer a fixed set instead of a free-text box for the facts that settle a
 * chart-review criterion.
 */
export function allowedValues(fact: string, factModelYaml: string): string[] | undefined {
  const match = new RegExp(`^\\s*${fact}:\\s*\\{\\s*type:\\s*enum,\\s*values:\\s*\\[([^\\]]*)\\]`, "m").exec(
    factModelYaml,
  );
  if (!match) return undefined;
  return match[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/* ------------------------------------------------------------ engine input */

/**
 * What the engine is allowed to see, given the decisions made so far.
 *
 * Merge, never delete: the structured record stands until a human replaces it.
 */
export function applyReview(
  cohort: readonly PatientFacts[],
  files: readonly FactsFile[],
  state: ReviewState,
): PatientFacts[] {
  const byPatient = new Map(files.map((f) => [f.patient, f]));
  return cohort.map((patient) => {
    const file = byPatient.get(patient.patient);
    if (file === undefined) return patient;

    const facts: Record<string, FactValue> = { ...patient.facts };
    for (const entry of reviewableEntries(file)) {
      const { decision, value } = decisionFor(state, cardId(patient.patient, entry.fact));
      // Pending or rejected: the proposal is withheld. The structured value the
      // fixture already carried is untouched — it was never the model's to take.
      if (decision !== "confirmed") continue;
      facts[entry.fact] = value === undefined ? structuredClone(entry.value) : value;
    }
    return { patient: patient.patient, facts };
  });
}

/** The structured value a confirm would override, if there is one. */
export const structuredValueOf = (
  cohort: readonly PatientFacts[],
  patient: string,
  fact: string,
): FactValue | undefined => cohort.find((p) => p.patient === patient)?.facts[fact];

/* --------------------------------------------------------------- coverage */

function factsIn(c: Condition, out: Set<string>): void {
  if ("all" in c) c.all.forEach((k) => factsIn(k, out));
  else if ("any" in c) c.any.forEach((k) => factsIn(k, out));
  else if ("not" in c) factsIn(c.not, out);
  else out.add(c.fact);
}

/**
 * Facts this rule set can actually act on: every fact a criterion's condition
 * reads, plus any legacy facts that settle an unmodeled criterion by chart
 * review. Anything else in the queue is a chart-review note, not a decision the
 * funnel will ever reflect — and the card says so instead of implying impact.
 */
export function factsRead(rulesetYaml: string): Set<string> {
  const out = new Set<string>();
  let rs;
  try {
    rs = parseRuleSet(rulesetYaml);
  } catch {
    return out;
  }
  for (const c of rs.criteria) {
    if (c.when) factsIn(c.when, out);
    const rule = CHART_REVIEW_RULES.find((r) => r.criterionId === c.id);
    if (rule && c.unmodeled === true) out.add(rule.fact);
  }
  return out;
}

/* --------------------------------------------------------------- progress */

export type ReviewProgress = {
  /** Every reviewable fact in the queue. */
  total: number;
  pending: number;
  decided: number;
  /** Facts a criterion reads — the ones the numbers on screen are "as of". */
  relevantTotal: number;
  relevantDecided: number;
  /** Facts no criterion reads: chart-review context, never a decided count. */
  chartReviewOnly: number;
  patients: number;
};

export function reviewProgress(
  files: readonly FactsFile[],
  state: ReviewState,
  read: ReadonlySet<string>,
): ReviewProgress {
  const p: ReviewProgress = {
    total: 0,
    pending: 0,
    decided: 0,
    relevantTotal: 0,
    relevantDecided: 0,
    chartReviewOnly: 0,
    patients: 0,
  };
  for (const file of files) {
    const entries = reviewableEntries(file);
    if (entries.length > 0) p.patients += 1;
    for (const entry of entries) {
      const settled = decisionFor(state, cardId(file.patient, entry.fact)).decision !== "pending";
      p.total += 1;
      if (settled) p.decided += 1;
      else p.pending += 1;
      if (read.has(entry.fact)) {
        p.relevantTotal += 1;
        if (settled) p.relevantDecided += 1;
      } else {
        p.chartReviewOnly += 1;
      }
    }
  }
  return p;
}

/** The stamp that goes next to every count the review state can move. */
export const asOfLabel = (p: ReviewProgress): string =>
  `as of ${p.relevantDecided} of ${p.relevantTotal} facts reviewed`;

export function pendingCount(files: readonly FactsFile[], state: ReviewState): number {
  let n = 0;
  for (const file of files) {
    for (const entry of reviewableEntries(file)) {
      if (decisionFor(state, cardId(file.patient, entry.fact)).decision === "pending") n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------ persistence */

export const STORAGE_KEY = "rulekit.review.v1";

export function loadReviewState(storage: Pick<Storage, "getItem"> | undefined): ReviewState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as ReviewState;
  } catch {
    return {};
  }
}

export function saveReviewState(
  storage: Pick<Storage, "setItem"> | undefined,
  state: ReviewState,
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A private-mode browser refusing localStorage costs durability, not the app.
  }
}

export const REVIEWER = "workbench-user";

/**
 * The decisions as facts files — one YAML document per patient, in the shape
 * `src/extract/schema.ts` parses, with `reviewedBy`/`reviewedAt` on every entry
 * the reviewer touched. This is what makes the audit-trail claim producible:
 * the file that comes out is the file that would go back into `corpus/facts/`.
 */
export function decisionsYaml(
  files: readonly FactsFile[],
  state: ReviewState,
  now: string = new Date().toISOString(),
): string {
  const docs: string[] = [];
  for (const file of files) {
    const touched = reviewableEntries(file).filter(
      (e) => decisionFor(state, cardId(file.patient, e.fact)).decision !== "pending",
    );
    if (touched.length === 0) continue;

    const facts = touched.map((entry) => {
      const d = decisionFor(state, cardId(file.patient, entry.fact));
      const out: Record<string, unknown> = {
        fact: entry.fact,
        value: d.value ?? entry.value,
        ...(entry.unit === undefined ? {} : { unit: entry.unit }),
        status: d.decision === "confirmed" ? "confirmed" : "rejected",
        ...(entry.confidence === undefined ? {} : { confidence: entry.confidence }),
        extractedBy: d.value === undefined ? entry.extractedBy : "human",
        ...(entry.source === undefined ? {} : { source: { doc: entry.source.doc, quote: entry.source.quote } }),
        reviewedBy: REVIEWER,
        reviewedAt: d.at ?? now,
      };
      return out;
    });

    docs.push(
      `# ${file.patient} — decisions exported from the rulekit workbench at ${now}.\n` +
        `# Reviewer: ${REVIEWER}. Drop this over corpus/facts/${file.patient}.yaml to keep them.\n` +
        stringify({ patient: file.patient, ...(file.asOf === undefined ? {} : { asOf: file.asOf }), facts }),
    );
  }
  if (docs.length === 0) {
    return `# No decisions to export — nothing has been confirmed or rejected yet.\n`;
  }
  return docs.join("---\n");
}

/* ------------------------------------------------------------------ cards */

const formatValue = (v: FactValue): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "—";

export type BuildCardsInput = {
  cohort: readonly PatientFacts[];
  files: readonly FactsFile[];
  notes: Record<string, string>;
  rulesetYaml: string;
  engine: Engine;
  state: ReviewState;
};

/** The band a patient is in, in the review pane's words. */
export const outcomeLabel = (band: DisplayBand): string => BAND_LABEL[band];

/**
 * One card per still-pending proposal, with the impact badge computed by asking
 * the real engine twice: once with the fact withheld and once with it confirmed.
 * "Would this decision change the answer" is not a heuristic here — it is the
 * engine's own verdict on both worlds, banded by `displayBandOf` so the badge
 * uses the same words as the funnel.
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
  const read = factsRead(rulesetYaml);
  const cards: ProposedFactCard[] = [];

  for (const patient of cohort) {
    const file = byPatient.get(patient.patient);
    if (file === undefined) continue;

    const [withheld] = applyReview([patient], files, state);
    if (withheld === undefined) continue;
    const before = displayBandOf(engine.evalPatient(rulesetYaml, withheld));

    for (const entry of reviewableEntries(file)) {
      const id = cardId(patient.patient, entry.fact);
      if (decisionFor(state, id).decision !== "pending") continue;

      const [confirmed] = applyReview([patient], files, decide(state, id, "confirmed"));
      const after =
        confirmed === undefined
          ? before
          : displayBandOf(engine.evalPatient(rulesetYaml, confirmed));

      const structured = withheld.facts[entry.fact];
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
        usedByRules: read.has(entry.fact),
      };
      if (entry.unit !== undefined) card.unit = entry.unit;
      if (structured !== undefined) card.structured = formatValue(structured);
      if (after !== before) card.impact = `${outcomeLabel(before)} → ${outcomeLabel(after)}`;
      cards.push(card);
    }
  }
  return cards;
}
