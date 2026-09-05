import { useId, useState } from "react";
import type { EditCheck, ProposedFactCard, ReviewQueueProps } from "./types.js";
import { sortReviewQueue, excerptSpan, highlightSpan } from "./sort.js";
import "./tokens.css";

const DEFAULT_UNSURE_BELOW = 0.8;

const formatValue = (value: string | number | boolean, unit?: string): string =>
  `${typeof value === "boolean" ? String(value) : value}${unit ? ` ${unit}` : ""}`;

const ACCEPT_NON_EMPTY = (_item: ProposedFactCard, draft: string): EditCheck =>
  draft.trim().length > 0
    ? { ok: true, value: draft.trim() }
    : { ok: false, message: "Enter a value." };

function QuoteInContext({
  quote,
  noteContext,
  expanded,
  onExpand,
}: {
  quote: string;
  noteContext: string;
  expanded: boolean;
  onExpand: () => void;
}) {
  const full = highlightSpan(noteContext, quote);
  if (full === null) {
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
  const short = excerptSpan(noteContext, quote, 1) ?? { ...full, truncated: false };
  const span = expanded ? full : short;
  return (
    <>
      {!expanded && short.truncated && <span className="rk-card__elide">…</span>}
      {span.before}
      <mark>{span.match}</mark>
      {span.after}
      {!expanded && short.truncated && <span className="rk-card__elide">…</span>}
      {short.truncated && (
        <button type="button" className="rk-card__expand" onClick={onExpand}>
          {expanded ? "show excerpt" : "show full note"}
        </button>
      )}
    </>
  );
}

function Card({
  item,
  onConfirm,
  onEdit,
  onReject,
  validate,
  optionsFor,
  unsureBelow,
}: {
  item: ProposedFactCard;
  onConfirm: ReviewQueueProps["onConfirm"];
  onEdit: ReviewQueueProps["onEdit"];
  onReject: ReviewQueueProps["onReject"];
  validate: NonNullable<ReviewQueueProps["validate"]>;
  optionsFor: ReviewQueueProps["optionsFor"];
  unsureBelow: number;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(String(item.value));
  const [reason, setReason] = useState("");
  const [correctionSource, setCorrectionSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const pct = Math.round(item.confidence * 100);
  const unsure = item.confidence < unsureBelow;
  const options = optionsFor?.(item);
  const overrides = item.structured !== undefined && String(item.structured) !== String(item.value);
  const chartReviewOnly = item.usedByRules === false;

  const save = (): void => {
    const check = validate(item, draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (reason.trim().length === 0 || correctionSource.trim().length === 0) {
      setError("Enter both a correction reason and the source you checked.");
      return;
    }
    setError(null);
    onEdit(item, {
      value: check.value,
      reason: reason.trim(),
      source: correctionSource.trim(),
    });
    setEditing(false);
  };

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
        {chartReviewOnly && (
          <span className="rk-card__unused" data-testid="unused-badge">
            chart review only — not read by any criterion
          </span>
        )}
      </div>

      {item.structured !== undefined && (
        <p className={`rk-card__override${overrides ? " rk-card__override--conflict" : ""}`} data-testid="override-notice">
          <span className="rk-card__doc">on record</span>
          <span className="rk-card__structured">{formatValue(item.structured, item.unit)}</span>
          <span aria-hidden>→</span>
          <span className="rk-card__proposed">{formatValue(item.value, item.unit)}</span>
          <span className="rk-card__override-note">
            {overrides
              ? "confirming replaces the value already on record"
              : "matches the value already on record"}
          </span>
        </p>
      )}

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
        <QuoteInContext
          quote={item.quote}
          noteContext={item.noteContext}
          expanded={expanded}
          onExpand={() => setExpanded(!expanded)}
        />
      </blockquote>

      {editing ? (
        <div className="rk-edit">
          <label>
            <span className="rk-card__doc">
              corrected value{item.unit ? ` (${item.unit})` : ""}
            </span>
            {options ? (
              <select
                className="rk-edit__input"
                aria-label={`corrected value for ${item.fact}`}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`rk-edit__input${error ? " rk-edit__input--bad" : ""}`}
                aria-label={`corrected value for ${item.fact}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
              />
            )}
          </label>
          <label>
            <span className="rk-card__doc">correction reason</span>
            <input
              className="rk-edit__input"
              aria-label={`correction reason for ${item.fact}`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label>
            <span className="rk-card__doc">source checked for corrected value</span>
            <input
              className="rk-edit__input"
              aria-label={`correction source for ${item.fact}`}
              value={correctionSource}
              onChange={(e) => {
                setCorrectionSource(e.target.value);
                setError(null);
              }}
            />
          </label>
          <button type="button" className="rk-btn rk-btn--primary" onClick={save}>
            Save
          </button>
          <button
            type="button"
            className="rk-btn rk-btn--quiet"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
          {error && (
            <p className="rk-edit__error" id={errorId} role="alert" data-testid="edit-error">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="rk-card__actions">
          <button
            type="button"
            className="rk-btn rk-btn--primary"
            aria-label={`confirm ${item.fact} for ${item.patient}`}
            onClick={() => onConfirm(item)}
          >
            {overrides ? "Confirm override" : "Confirm"}
          </button>
          <button
            type="button"
            className="rk-btn rk-btn--quiet"
            aria-label={`edit ${item.fact} for ${item.patient}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="rk-btn rk-btn--quiet"
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
 * which is the rulekit invariant expressed as an interface. Nothing here
 * accepts a correction the host refuses, either: `validate` gates Save and the
 * reason is shown on the card.
 */
export function ReviewQueue({
  items,
  onConfirm,
  onEdit,
  onReject,
  validate = ACCEPT_NON_EMPTY,
  optionsFor,
  unsureBelow = DEFAULT_UNSURE_BELOW,
}: ReviewQueueProps) {
  const sorted = sortReviewQueue(items);
  const impactful = sorted.filter((i) => i.flipsVerdict).length;

  return (
    <section className="rk-review" aria-label="Proposed facts pending review">
      <header className="rk-review__head">
        <h3 className="rk-review__title">Pending review</h3>
        <span className="rk-review__count" data-testid="queue-count">
          {sorted.length} pending{impactful > 0 ? ` · ${impactful} change a verdict` : ""}
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
              validate={validate}
              optionsFor={optionsFor}
              unsureBelow={unsureBelow}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default ReviewQueue;
