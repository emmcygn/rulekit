# corpus/notes — synthetic clinical notes

**Every note in this directory is fabricated.** The patients, clinicians,
institutions, dates, and findings are invented for the rulekit demo. Nothing
here is derived from, or resembles, a real patient record. Not for clinical,
feasibility, or research screening use.

Synthea generates structured FHIR but no rich narrative, so these ten notes are
hand-written to give the facts compiler (design spec §11) something to extract.
Ground truth exists by construction: we wrote the notes, so every expected fact
is known, and `evals/` asserts against it.

## Who a patient is: `fixtures/patients/` is canonical

The same `SYN-xxx` id appears in up to three places — `fixtures/patients/`
(structured record), `corpus/facts/` (extracted + reviewed facts), and a note
here. **`fixtures/patients/<id>.yaml` is the single source of truth for
identity: `age` and `sex`.** Notes and `corpus/facts/` entries must agree with
it, including the pronouns and the stated age in the note prose — a review of
this repo found SYN-007, SYN-019 and SYN-042 each described as a different
person in two files at once, which is exactly the kind of drift that makes a
coordinator stop trusting the tool.

Changing a pronoun in a note is never a cosmetic edit: the grounding gate
requires every `quote` in `corpus/facts/` to be an exact substring of the note
body, so a note edit that touches a quoted sentence must be mirrored into
`corpus/facts/*.yaml` and `evals/recorded/*.json` in the same commit.
`npm run facts:check` is the gate that catches a half-done edit.

## File format

Each `.txt` file is YAML front matter between `---` fences, then the note body:

```
---
doc: echo-2026-03-12
patient: SYN-042
kind: echo-report
date: 2026-03-12
synthetic: true
---
<note body>
```

`src/extract/notes.ts` parses this. **Only the body is grounded against** — a
quote that only matches the front matter or this README does not count as
evidence.

## Why lines are not hard-wrapped mid-sentence

The grounding gate requires a proposed `quote` to be an exact substring of the
note body, with only newline normalization applied (see `ground.ts`). A newline
inserted in the middle of a sentence would therefore break every quote that
spans it. Sentences stay on one line.

## The traps

Four notes are written to tempt a wrong extraction. They are the point of the
eval suite, not decoration:

| Note | Trap | Correct behaviour |
|---|---|---|
| `echo-2026-01-22` (SYN-011) | **Range value** — "EF visually estimated at 40-45%" | No `lvef` fact. A range is not a number; the grounding gate rejects `"40-45"` as a type mismatch. |
| `clinic-2026-04-02` (SYN-019) | **Negation** — "no anticoagulant use since the GI bleed" | `on_anticoagulant: false`, never `true`. |
| `clinic-2026-07-09` (SYN-052) | **Discussed, not prescribed** — dapagliflozin | `on_sglt2_inhibitor: false`. |
| `clinic-2026-08-05` (SYN-070) | **History vs. current** — NYHA IV in 2024, II now | `nyha_class: II`. |

`clinic-2026-05-16` (SYN-023) adds a fifth wrinkle: a med *change* within the
visit (stop metoprolol, start carvedilol) where the beta-blocker fact stays
`true` across the swap.
