import { useState } from "react";
import type { ProposedFactCard, ReviewQueueProps } from "./types.js";
import { sortReviewQueue, highlightSpan } from "./sort.js";
import "./tokens.css";

const DEFAULT_UNSURE_BELOW = 0.8;

const formatValue = (value: string | number | boolean, unit?: string): string =>
  `${typeof value === "boolean" ? String(value) : value}${unit ? ` ${unit}` : ""}`;

function QuoteInContext({ quote, noteContext }: { quote: string; noteContext: string }) {
  const span = highlightSpan(noteContext, quote);
  if (span === null) {
    // The gate accepted this quote when the fact was proposed. If it no longer
    // resolves, the note changed underneath it — say so rather than render a
    // plausible-looking block of unhighlighted text.
    return (
      <>
        <span>{noteContext}</span>
        <p className="rk-card__ungrounded" role="alert">
          quote no longer appears in this note — do not confirm
        </p>
      </>
    );
  }
  return (
    <>
      {span.before}
      <mark>{span.match}</mark>
      {span.after}
    </>
  );
}

function Card({
  item,
  onConfirm,
  onEdit,
  onReject,
  unsureBelow,
}: {
  item: ProposedFactCard;
  onConfirm: ReviewQueueProps["onConfirm"];
  onEdit: ReviewQueueProps["onEdit"];
  onReject: ReviewQueueProps["onReject"];
  unsureBelow: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(item.value));

  const pct = Math.round(item.confidence * 100);
  const unsure = item.confidence < unsureBelow;

  return (
    <li className="rk-card" data-testid="review-card" data-fact={item.fact} data-patient={item.patient}>
      <div className="rk-card__top">
        <span className="rk-card__patient">{item.patient}</span>
        <span className="rk-card__fact">{item.fact}</span>
        <span className="rk-card__value">{formatValue(item.value, item.unit)}</span>
        {item.flipsVerdict && (
          <span className="rk-card__impact" data-testid="impact-badge">
            {item.impact ?? "changes verdict"}
          </span>
        )}
      </div>

      <div className="rk-card__conf">
        <span
          className="rk-card__bar"
          role="meter"
          aria-label={`confidence for ${item.fact}`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="rk-card__bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="rk-card__conf-num">{pct}%</span>
        {unsure && <span className="rk-card__unsure">unsure</span>}
      </div>

      <blockquote className="rk-card__quote">
        <cite className="rk-card__doc">{item.doc}</cite>
        <QuoteInContext quote={item.quote} noteContext={item.noteContext} />
      </blockquote>

      {editing ? (
        <div className="rk-edit">
          <label>
            <span className="rk-card__doc">corrected value</span>
            <input
              className="rk-edit__input"
              aria-label={`corrected value for ${item.fact}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rk-btn rk-btn--primary"
            onClick={() => {
              onEdit(item, draft);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button type="button" className="rk-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="rk-card__actions">
          <button
            type="button"
            className="rk-btn rk-btn--primary"
            aria-label={`confirm ${item.fact} for ${item.patient}`}
            onClick={() => onConfirm(item)}
          >
            Confirm
          </button>
          <button
            type="button"
            className="rk-btn"
            aria-label={`edit ${item.fact} for ${item.patient}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="rk-btn"
            aria-label={`reject ${item.fact} for ${item.patient}`}
            onClick={() => onReject(item)}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The review queue (design spec §11, workbench tab 5).
 *
 * One queue, three actions, no bulk operations — the spec names "review pane
 * becomes a second product" as a risk, and the mitigation is this shape.
 * Nothing here auto-confirms at any confidence: every card requires a click,
 * which is the rulekit invariant expressed as an interface.
 */
export function ReviewQueue({ items, onConfirm, onEdit, onReject, unsureBelow = DEFAULT_UNSURE_BELOW }: ReviewQueueProps) {
  const sorted = sortReviewQueue(items);
  const impactful = sorted.filter((i) => i.flipsVerdict).length;

  return (
    <section className="rk-review" aria-label="Proposed facts pending review">
      <header className="rk-review__head">
        <h2 className="rk-review__title">Pending review</h2>
        <span className="rk-review__count" data-testid="queue-count">
          {sorted.length} proposed{impactful > 0 ? ` · ${impactful} change a verdict` : ""}
        </span>
      </header>

      {sorted.length === 0 ? (
        <p className="rk-review__empty">Nothing pending. Every proposed fact has been decided.</p>
      ) : (
        <ul className="rk-review__list">
          {sorted.map((item) => (
            <Card
              key={item.id}
              item={item}
              onConfirm={onConfirm}
              onEdit={onEdit}
              onReject={onReject}
              unsureBelow={unsureBelow}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default ReviewQueue;
