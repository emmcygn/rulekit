/**
 * One patient, one status — the whole of triage cluster A in one module.
 *
 * Every band, badge, legend entry, summary count and amendment delta on screen
 * comes from `displayBandOf`, which is `bandOf` (i.e. `evalPatient().overall`)
 * with one refinement: the shared `not-evaluable` band is split into the two
 * things it actually contains, because the workbench can act on one of them and
 * not the other.
 *
 *   not evaluable        a criterion the rules *do* model could not be decided
 *                        — the data is missing. Review can fix this.
 *   pending chart review every modeled criterion passed and only an unmodeled
 *                        criterion is outstanding. Nothing in the data will fix
 *                        this; a human has to read the chart.
 *
 * The split is derived from the same `results` array, so it can never disagree
 * with the shared bands: `notEvaluable + pendingChartReview` is exactly the
 * core band's `not-evaluable`, and `tests/bands.test.ts` asserts it.
 */
import { bandOf, isParked, type Attrition, type Band } from "../engine/attrition.js";
import type { Evaluation } from "../engine/api.js";

export type DisplayBand = Band | "pending-chart-review";

export const DISPLAY_BANDS: DisplayBand[] = [
  "screen-fail",
  "not-evaluable",
  "pending-chart-review",
  "potentially-eligible",
];

export const BAND_LABEL: Record<DisplayBand, string> = {
  "screen-fail": "screen fail",
  "not-evaluable": "not evaluable",
  "pending-chart-review": "pending chart review",
  "potentially-eligible": "potentially eligible",
};

/** Mark class suffix — the one status vocabulary, shared with the bar legend. */
export const BAND_MARK: Record<DisplayBand, string> = {
  "screen-fail": "fail",
  "not-evaluable": "ne",
  "pending-chart-review": "cr",
  "potentially-eligible": "elig",
};

export function displayBandOf(evaluation: Evaluation): DisplayBand {
  const band = bandOf(evaluation);
  if (band !== "not-evaluable") return band;
  // Undetermined for a reason nobody can chart-review away → missing data.
  return evaluation.results.some((r) => r.verdict === "unknown" && !isParked(r))
    ? "not-evaluable"
    : "pending-chart-review";
}

export type DisplayBandCounts = Record<DisplayBand, number>;

const zero = (): DisplayBandCounts => ({
  "screen-fail": 0,
  "not-evaluable": 0,
  "pending-chart-review": 0,
  "potentially-eligible": 0,
});

export function displayBandCounts(evaluations: readonly Evaluation[]): DisplayBandCounts {
  const counts = zero();
  for (const e of evaluations) counts[displayBandOf(e)] += 1;
  return counts;
}

/** Same counts, taken off an already-computed attrition report. */
export const countsOf = (attrition: Attrition): DisplayBandCounts =>
  displayBandCounts(attrition.patients.map((p) => p.evaluation));

/** "6 screen fail · 3 pending chart review · 1 potentially eligible" — plain text. */
export function summaryLine(counts: DisplayBandCounts): string {
  return DISPLAY_BANDS.filter((b) => counts[b] > 0)
    .map((b) => `${counts[b]} ${BAND_LABEL[b]}`)
    .join(" · ");
}
