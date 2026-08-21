import type { ProposedFactCard } from "./types.js";

/**
 * Dev-harness data, lifted from the real corpus so `npm run dev` shows the
 * actual demo beat: SYN-042's NYHA class III proposal, quoted from
 * corpus/notes/echo-2026-03-12.txt, sitting above three quieter cards.
 *
 * Synthetic patients. See corpus/notes/README.md.
 */
const ECHO_CONTEXT =
  "The patient was seen in the reading room by the ordering team. She reports marked limitation of physical activity, comfortable at rest, with dyspnea on climbing a single flight of stairs; symptoms consistent with NYHA class III heart failure. She was hospitalized for decompensated heart failure in November 2025.";

const CLINIC_CONTEXT =
  "HFrEF on three of the four pillars of guideline-directed therapy. The missing pillar is an SGLT2 inhibitor.\n\nWe discussed adding dapagliflozin 10 mg daily but did not start it today. He is not currently taking an SGLT2 inhibitor.";

export const DEMO_QUEUE: ProposedFactCard[] = [
  {
    id: "SYN-042:nyha_class",
    patient: "SYN-042",
    fact: "nyha_class",
    value: "III",
    confidence: 0.94,
    doc: "echo-2026-03-12",
    quote: "symptoms consistent with NYHA class III heart failure",
    noteContext: ECHO_CONTEXT,
    flipsVerdict: true,
    impact: "undetermined → eligible",
  },
  {
    id: "SYN-052:on_sglt2_inhibitor",
    patient: "SYN-052",
    fact: "on_sglt2_inhibitor",
    value: false,
    confidence: 0.86,
    doc: "clinic-2026-07-09",
    quote: "He is not currently taking an SGLT2 inhibitor.",
    noteContext: CLINIC_CONTEXT,
    flipsVerdict: true,
    impact: "eligible → ineligible",
  },
  {
    id: "SYN-042:hospitalized_for_hf_last_12mo",
    patient: "SYN-042",
    fact: "hospitalized_for_hf_last_12mo",
    value: true,
    confidence: 0.89,
    doc: "echo-2026-03-12",
    quote: "She was hospitalized for decompensated heart failure in November 2025.",
    noteContext: ECHO_CONTEXT,
    flipsVerdict: false,
  },
  {
    id: "SYN-042:lvef",
    patient: "SYN-042",
    fact: "lvef",
    value: 32,
    unit: "%",
    confidence: 0.98,
    doc: "echo-2026-03-12",
    quote: "LVEF 32% by biplane Simpson's method",
    noteContext:
      "Left ventricle: moderately to severely dilated. LVEF 32% by biplane Simpson's method. Global hypokinesis with regional akinesis of the inferolateral wall.",
    flipsVerdict: false,
  },
  {
    id: "SYN-007:on_sglt2_inhibitor",
    patient: "SYN-007",
    fact: "on_sglt2_inhibitor",
    value: false,
    confidence: 0.62,
    doc: "clinic-2026-02-04",
    quote: "MEDICATIONS (reviewed and reconciled today)",
    noteContext:
      "MEDICATIONS (reviewed and reconciled today)\n  sacubitril/valsartan 49/51 mg twice daily — continue\n  carvedilol 12.5 mg twice daily — continue\n  spironolactone 25 mg daily — continue",
    flipsVerdict: false,
  },
];
