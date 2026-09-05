/**
 * The Review tab (design spec §11, workbench tab 5).
 *
 * The queue itself is the shipped `web-components/review-pane` component.
 * Importing it across the package boundary does not work: that package declares
 * its own react dependency and has no node_modules of its own in web/'s CI job,
 * so Vite cannot resolve `react/jsx-runtime` from inside it. ReviewQueue.tsx,
 * sort.ts, types.ts and tokens.css are therefore byte-identical copies here,
 * and `web/tests/review-pane-copy.test.ts` fails the build if they drift.
 *
 * This file owns only the plumbing: repo facts in, decisions out. The store
 * (./store.ts) does the computing, and App holds the state so the funnel
 * re-evaluates from the same decisions.
 */
import { ReviewQueue } from "./ReviewQueue.js";
import type { FactValue } from "../../../src/core/schema.js";
import type { EditCheck, ProposedFactCard, ReviewCorrection } from "./types.js";
import { allowedValues, asOfLabel, checkCardEdit, type Decision, type ReviewProgress } from "./store.js";
import { BAND_LABEL, type DisplayBandCounts } from "../funnel/bands.js";

export type ReviewViewProps = {
  cards: ProposedFactCard[];
  bands: DisplayBandCounts;
  progress: ReviewProgress;
  factModelYaml: string;
  reviewer: string;
  onReviewerChange: (reviewer: string) => void;
  onDecide: (id: string, decision: Decision, editedValue?: FactValue, correction?: Omit<ReviewCorrection, "value">) => void;
  onDownload: () => void;
  onReset: () => void;
};

export function ReviewView({
  cards,
  bands,
  progress,
  factModelYaml,
  reviewer,
  onReviewerChange,
  onDecide,
  onDownload,
  onReset,
}: ReviewViewProps) {
  // The store owns the rule; the queue only asks. A correction that would not
  // reach the engine intact never gets past Save.
  const validate = (item: ProposedFactCard, draft: string): EditCheck => {
    const result = checkCardEdit(item, draft);
    if (!result.ok) return result;
    // Review cards never expose code arrays for editing; retain that invariant
    // at the component boundary as well as in parseEdit.
    return Array.isArray(result.value)
      ? { ok: false, message: "Code lists cannot be edited here — reject the proposal instead." }
      : { ok: true, value: result.value };
  };

  const optionsFor = (item: ProposedFactCard): string[] | undefined =>
    allowedValues(item.fact, factModelYaml);

  const pendingSentence =
    progress.pending === 0
      ? `0 pending — every proposed fact has been decided.`
      : `${progress.pending} of ${progress.total} facts are still pending.`;

  return (
    <div className="view">
      <div className="vhead">
        <h2>Review</h2>
        <span className="sub">
          proposed facts awaiting human confirmation · {progress.total} facts ·{" "}
          {progress.patients} patient{progress.patients === 1 ? "" : "s"}
        </span>
      </div>

      <div className="note">
        A proposed fact is invisible to the engine until someone confirms it, and a fact already on
        the structured record stays on it until someone overrides it. {pendingSentence}{" "}
        {bands["pending-chart-review"] > 0 && (
          <>
            <b>{bands["pending-chart-review"]}</b>{" "}
            {bands["pending-chart-review"] === 1 ? "patient is" : "patients are"}{" "}
            <i>{BAND_LABEL["pending-chart-review"]}</i>
            {bands["not-evaluable"] > 0 && (
              <>
                {" "}
                and <b>{bands["not-evaluable"]}</b> <i>{BAND_LABEL["not-evaluable"]}</i>
              </>
            )}
            .{" "}
          </>
        )}
        Confirm a fact and every count re-evaluates on the spot.
      </div>

      <div className="asof" data-testid="as-of">
        <span className="tok">{asOfLabel(progress)}</span>
        {progress.chartReviewOnly > 0 && (
          <span className="ink2">
            {progress.chartReviewOnly} further fact{progress.chartReviewOnly === 1 ? "" : "s"} in the
            queue are chart-review only — no criterion reads them, so they are not counted here
          </span>
        )}
        <span className="asof-actions">
          <label>
            <span className="ink2">Reviewer identity</span>{" "}
            <input
              aria-label="Reviewer identity"
              value={reviewer}
              onChange={(event) => onReviewerChange(event.target.value)}
              placeholder="Enter your name or staff ID"
            />
          </label>
          <button
            className="tbtn"
            onClick={onDownload}
            disabled={progress.decided === 0 || reviewer.trim().length === 0}
          >
            Download review manifest (YAML)
          </button>
          <button className="tbtn" onClick={onReset} disabled={progress.decided === 0}>
            Clear decisions
          </button>
        </span>
      </div>

      <div className="ink3" style={{ fontSize: 11.5 }}>
        Decisions are kept in this browser (localStorage). The export is explicitly non-authoritative:
        local state and the entered reviewer identity are not authenticated or tamper-evident. It is a
        review manifest for this synthetic demonstration, never a replacement facts file.
      </div>

      <ReviewQueue
        items={cards}
        validate={validate}
        optionsFor={optionsFor}
        onConfirm={(item) => onDecide(item.id, "confirmed")}
        onEdit={(item, correction) =>
          onDecide(item.id, "confirmed", correction.value, {
            reason: correction.reason,
            source: correction.source,
          })
        }
        onReject={(item) => onDecide(item.id, "rejected")}
      />
    </div>
  );
}
