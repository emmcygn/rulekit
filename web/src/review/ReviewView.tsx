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
import type { ProposedFactCard } from "./types.js";
import type { Decision } from "./store.js";

export type ReviewViewProps = {
  cards: ProposedFactCard[];
  /** Patients still leaving the funnel because a fact of theirs is pending. */
  notEvaluable: number;
  decided: number;
  onDecide: (id: string, decision: Decision, editedValue?: string) => void;
};

export function ReviewView({ cards, notEvaluable, decided, onDecide }: ReviewViewProps) {
  return (
    <div className="view">
      <div className="vhead">
        <h2>Review</h2>
        <span className="sub">proposed facts awaiting human confirmation</span>
      </div>

      <div className="note">
        A proposed fact is invisible to the engine until someone confirms it, which is why{" "}
        <b>{notEvaluable}</b> {notEvaluable === 1 ? "patient is" : "patients are"} currently{" "}
        <i>not evaluable — pending review</i>. Confirm a fact and the funnel re-evaluates on the
        spot. Decisions live in this browser tab only: nothing is written back to{" "}
        <span className="mono">corpus/facts</span>.
        {decided > 0 && ` ${decided} decided this session.`}
      </div>

      <ReviewQueue
        items={cards}
        onConfirm={(item) => onDecide(item.id, "confirmed")}
        onEdit={(item, value) => onDecide(item.id, "confirmed", value)}
        onReject={(item) => onDecide(item.id, "rejected")}
      />
    </div>
  );
}
