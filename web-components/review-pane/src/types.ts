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
  /** The model's self-estimate, 0-1. Orders the queue and flags "unsure". Never auto-confirms. */
  confidence: number;
  /** Source document id. */
  doc: string;
  /** The verbatim span the extraction cited. Highlighted inside `noteContext`. */
  quote: string;
  /** Surrounding note text the quote is highlighted within. */
  noteContext: string;
  /**
   * Would deciding this fact flip the patient's overall verdict? Impact sorts
   * ahead of confidence — a 0.99 fact that changes nothing can wait behind a
   * 0.6 fact that decides enrollment.
   */
  flipsVerdict: boolean;
  /** Short human phrase for the impact badge, e.g. "undetermined → ineligible". */
  impact?: string;
};

export type ReviewQueueProps = {
  items: ProposedFactCard[];
  onConfirm: (item: ProposedFactCard) => void;
  /** The human supplies a value; provenance keeps the original quote. */
  onEdit: (item: ProposedFactCard, value: string) => void;
  onReject: (item: ProposedFactCard) => void;
  /** Below this, a card is flagged "unsure". Spec §11 sets it at 0.8. */
  unsureBelow?: number;
};
