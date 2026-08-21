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
import type { EditCheck, ProposedFactCard } from "./types.js";
import { allowedValues, asOfLabel, checkCardEdit, REVIEWER, type Decision, type ReviewProgress } from "./store.js";
import { BAND_LABEL, type DisplayBandCounts } from "../funnel/bands.js";

export type ReviewViewProps = {
  cards: ProposedFactCard[];
  bands: DisplayBandCounts;
  progress: ReviewProgress;
  factModelYaml: string;
  onDecide: (id: string, decision: Decision, editedValue?: string) => void;
  onDownload: () => void;
  onReset: () => void;
};

export function ReviewView({
  cards,
  bands,
  progress,
  factModelYaml,
  onDecide,
  onDownload,
  onReset,
}: ReviewViewProps) {
  // The store owns the rule; the queue only asks. A correction that would not
  // reach the engine intact never gets past Save.
  const validate = (item: ProposedFactCard, draft: string): EditCheck => {
    const result = checkCardEdit(item, draft);
    return result.ok ? { ok: true } : { ok: false, message: result.message };
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
          <button className="tbtn" onClick={onDownload} disabled={progress.decided === 0}>
            Download decisions (YAML)
          </button>
          <button className="tbtn" onClick={onReset} disabled={progress.decided === 0}>
            Clear decisions
          </button>
        </span>
      </div>

      <div className="ink3" style={{ fontSize: 11.5 }}>
        Decisions are kept in this browser (localStorage) and stamped{" "}
        <span className="mono">reviewedBy: {REVIEWER}</span> on export. Nothing is written back to{" "}
        <span className="mono">corpus/facts</span> — download the YAML to keep them.
      </div>

      <ReviewQueue
        items={cards}
        validate={validate}
        optionsFor={optionsFor}
        onConfirm={(item) => onDecide(item.id, "confirmed")}
        onEdit={(item, value) => onDecide(item.id, "confirmed", value)}
        onReject={(item) => onDecide(item.id, "rejected")}
      />
    </div>
  );
}
