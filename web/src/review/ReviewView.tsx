export function ReviewView({ proposedCount }: { proposedCount: number }) {
  return (
    <div className="view">
      <div className="vhead">
        <h2>Review</h2>
        <span className="sub">proposed facts awaiting human confirmation</span>
      </div>
      <div className="placeholder">
        <h3>Coming in phase 4 — the facts compiler</h3>
        <p>
          This tab will hold the review queue: facts an extraction pipeline proposes from clinical
          notes, sorted by decision impact first and ascending confidence second. Each card shows the
          source note with the quote highlighted, and three actions — confirm, edit, reject.
        </p>
        <p>
          Until a human confirms one, a proposed fact is invisible to the engine: patients depending
          on it stay <i>not evaluable — pending review</i>, which is why the funnel's hatched band
          exists. Agents author; the engine decides; a person holds the pen.
        </p>
        <div className="note">
          {proposedCount} criteria in this rule set are marked <span className="mono">unmodeled</span>{" "}
          — they are what the review queue will feed.
        </div>
      </div>
    </div>
  );
}
