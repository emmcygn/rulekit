# @rulekit/review-pane

The review queue from design spec §11 — the human half of the two-sided
authoring story. An LLM proposes facts with provenance; a person confirms,
edits, or rejects each one; only confirmed facts reach the engine.

**Standalone on purpose.** Its own `package.json`, its own vite, its own test
run. It is not wired into `web/` — when the workbench's Review tab is built it
imports `ReviewQueue` from here. Keeping it separate means the component can be
developed, tested, and looked at without booting the workbench, and it has no
dependency on the rulekit core package (the host maps a `FactEntry` from a
facts.yaml onto the plain `ProposedFactCard` shape).

```bash
npm install
npm run dev      # dev harness at localhost:5173, seeded from the real corpus
npm test         # 33 component + sort tests
npm run typecheck
```

## Usage

```tsx
import { ReviewQueue } from "@rulekit/review-pane";

<ReviewQueue
  items={cards}
  onConfirm={(item) => stampConfirmed(item)}   // writes reviewedBy + reviewedAt
  onEdit={(item, value) => stampEdited(item, value)}
  onReject={(item) => stampRejected(item)}
/>;
```

The component is presentational. It never writes a facts.yaml and never decides
anything — it reports which card a human acted on, and the host stamps
`reviewedBy` and `reviewedAt`. **Nothing auto-confirms at any confidence**: every
card needs a click. That is the rulekit invariant expressed as an interface, and
a test asserts that rendering a 1.0-confidence card fires no callback.

## Queue order

**Decision impact first, then ascending confidence** (`sortReviewQueue`).

Impact first because a fact that would flip a patient's overall verdict deserves
attention regardless of how sure the model is, and a fact that changes no verdict
can wait however sure it is.

Then *ascending* confidence, which reads backwards until you say it out loud: the
queue surfaces what the model is **least** sure of, because that is where a human
adds the most value. Confident-first would spend the reviewer's scarce attention
exactly where it is least needed.

Ties break on `id`, so the order is total and the list never reshuffles between
renders.

## Confidence

Displayed as a bar and a percentage, flagged `unsure` below `unsureBelow`
(default 0.8, per the spec). It orders the queue and flags uncertainty. It does
not gate anything — LLM self-estimates are not calibrated probabilities, and
`facts eval` prints the calibration table that shows it.

## Quote grounding, in the UI

The cited quote is highlighted inside its note context using the same matching
rule the grounding gate applies: exact substring after newline normalization,
no case folding, no whitespace collapsing.

If the quote no longer resolves, the card renders a `role="alert"` saying
**"quote no longer appears in this note — do not confirm"** instead of quietly
showing an unhighlighted block of text. A reviewer confirming a fact whose
evidence has drifted is the exact failure the whole provenance chain exists to
prevent, so the UI refuses to look normal when it happens.

## Design tokens

`src/tokens.css`.

| token | value | role |
|---|---|---|
| `--paper` | `#FAF8F4` | page ground |
| `--ink` | `#17150F` | primary text |
| `--ink-2` | `#6B655C` | secondary text, confidence bar |
| `--accent` | `#A6431E` | **actions only** |
| `--hairline` | `#E3DED4` | rules and borders |

Type: Public Sans (UI), Spline Sans Mono (patient ids, fact names, values,
confidence figures — anything a reader might need to compare across rows).

The accent rule is load-bearing: it is reserved for buttons and the ungrounded
warning, never for decoration and never for a status colour. On any screen the
only warm thing is the control a human is meant to touch. The impact badge is
therefore outlined in ink, not accent — impact is information, not an action.

## Scope

One queue, three actions, no bulk operations. The spec names "review pane
becomes a second product" as a project risk; this shape is the mitigation.
Filtering, sorting controls, keyboard shortcuts, and batch confirm are all
post-ship.

## Files

```
src/types.ts        ProposedFactCard + props
src/sort.ts         sortReviewQueue, highlightSpan (pure, separately tested)
src/ReviewQueue.tsx the component
src/tokens.css      design tokens
src/demo.ts         dev-harness data, lifted from the real corpus
src/main.tsx        dev harness (not exported)
```
