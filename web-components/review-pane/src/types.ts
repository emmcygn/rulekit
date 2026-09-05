/**
 * The card the review queue renders — one proposed fact awaiting a human
 * decision.
 *
 * Deliberately a plain data shape with no dependency on the rulekit core
 * package: this component is standalone so it can be dropped into `web/` (or a
 * Storybook, or a screenshot harness) without dragging the engine along. The
 * host maps a `FactEntry` from a facts.yaml onto this.
 */
export type ProposedFactCard = {
  /** Stable identity for React keys and for the callbacks. */
  id: string;
  patient: string;
  /** Fact name as declared in the fact model, e.g. `nyha_class`. */
  fact: string;
  value: string | number | boolean;
  unit?: string;
  /**
   * The value already on record for this fact, when there is one. Confirming
   * over it is an override, not a fill-in, and the card shows both before the
   * click — a 20-point eGFR difference from a different draw is exactly the
   * thing a reviewer must see rather than discover afterwards.
   */
  structured?: string | number | boolean;
  /** The model's self-estimate, 0-1. Orders the queue and flags "unsure". Never auto-confirms. */
  confidence: number;
  /** Source document id. */
  doc: string;
  /** The verbatim span the extraction cited. Highlighted inside `noteContext`. */
  quote: string;
  /** Surrounding note text the quote is highlighted within. */
  noteContext: string;
  /**
   * Would deciding this fact flip the patient's band? Impact sorts ahead of
   * confidence — a 0.99 fact that changes nothing can wait behind a 0.6 fact
   * that decides enrollment.
   */
  flipsVerdict: boolean;
  /** Short human phrase for the impact badge, e.g. "not evaluable → screen fail". */
  impact?: string;
  /**
   * Does any criterion in the loaded rule set read this fact? When false the
   * card is chart-review context: worth recording, but it will never move a
   * number, and saying so is the difference between an honest queue and one
   * that congratulates a reviewer for an entry the engine ignores.
   */
  usedByRules?: boolean;
};

export type ReviewValue = string | number | boolean;

/** A correction carries the typed value and the reviewer's replacement provenance. */
export type ReviewCorrection = {
  value: ReviewValue;
  reason: string;
  source: string;
};

export type EditCheck = { ok: true; value: ReviewValue } | { ok: false; message: string };

export type ReviewQueueProps = {
  items: ProposedFactCard[];
  onConfirm: (item: ProposedFactCard) => void;
  /** The human supplies a typed value and provenance for the correction. */
  onEdit: (item: ProposedFactCard, correction: ReviewCorrection) => void;
  onReject: (item: ProposedFactCard) => void;
  /**
   * Refuse a correction the engine could not use. Save stays blocked and the
   * message is shown; there is no path where the card reports success and the
   * engine silently keeps the model's value.
   */
  validate?: (item: ProposedFactCard, draft: string) => EditCheck;
  /** Values to offer instead of a free-text box, for facts with a closed set. */
  optionsFor?: (item: ProposedFactCard) => string[] | undefined;
  /** Below this, a card is flagged "unsure". Spec §11 sets it at 0.8. */
  unsureBelow?: number;
};
