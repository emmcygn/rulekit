# The rulekit criteria format

**Format version 1 · status: draft · license Apache-2.0**

This document specifies the file formats, not the program that reads them. A
format outlives its first engine, so the schema and this text are the artifact;
`src/core/` is one implementation of them. Anyone can write a second.

Machine-checkable half, in `schema/`:

| File | Defines | Shipped instances |
|---|---|---|
| [`ruleset.schema.json`](schema/ruleset.schema.json) | one trial's criteria as code | `rules/trials/*/ruleset*.yaml` |
| [`fact-model.schema.json`](schema/fact-model.schema.json) | the vocabulary rules are written against | `packs/trials/fact-model.yaml` |
| [`patient-facts.schema.json`](schema/patient-facts.schema.json) | what the evaluator consumes about a patient | `fixtures/patients/*.yaml`, `corpus/patients/*.yaml` |
| [`facts-file.schema.json`](schema/facts-file.schema.json) | facts with provenance and review state | `corpus/facts/*.yaml` |

`tests/schema/format.test.ts` validates every shipped artifact against these,
and asserts that the schema and the reference parser agree on ~35 malformed
documents. Where they deliberately disagree, the divergence is a named test and
is listed under [What the schema cannot check](#what-the-schema-cannot-check).

> **Not medical software.** This format describes a demonstration of
> rule-governance tooling. Nothing here is validated for clinical, feasibility,
> or research screening use.

---

## 1. `ruleset.yaml` — a trial's criteria

One rule set per trial version, one file. Provenance on every criterion.

```yaml
ruleset: demo-hf-001-eligibility
protocol: "DEMO-HF-001 v3.0 (Amendment 2)"
status: irb-approved
effective: 2026-08-04
rulesetVersion: 1.1.0
factModel: patient-facts/v1
source:
  registry: clinicaltrials.gov
  id: NCT01877915
  url: https://clinicaltrials.gov/study/NCT01877915
criteria:
  - id: age-min
    ref: I1
    kind: inclusion
    verbatim: "Age 18 years or older"
    when: { fact: age, op: gte, value: 18 }
```

| Field | Required | Meaning |
|---|---|---|
| `ruleset` | yes | Stable id for the rule set. Constant across versions — it is what a diff pairs on. |
| `rulesetVersion` | yes | Semver (§7). |
| `factModel` | yes | Name of the fact model every `fact` reference resolves against. |
| `criteria` | yes | At least one criterion. |
| `protocol` | no | The sponsor's own protocol id and version, as printed on the document. |
| `status` | no | Free-text lifecycle label (`draft`, `irb-approved`, `completed`). Never interpreted. |
| `effective` | no | `YYYY-MM-DD` this version took effect at the site. |
| `source.registry` / `source.id` / `source.url` | no | Where the criteria text came from: any trial registry (`clinicaltrials.gov`, `isrctn.com`, `euclinicaltrials.eu`, ...) with the id that registry assigns, and/or a URL. |

### Criterion

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the rule set, `^[a-z0-9][a-z0-9-]*$`. Appears in traces, coverage reports and diffs, so a rename is a breaking change to every downstream artifact — treat ids as API. |
| `kind` | yes | `inclusion` or `exclusion`. Determines orientation (§3). |
| `verbatim` | yes | The criterion exactly as the protocol writes it. Never edited to fit the language. Required even when unmodeled — this is the field that makes a rule set auditable against the source document. |
| `ref` | no | Its position in the protocol (`I1`, `E4`, `AGE`). The protocol's numbering, not ours. |
| `when` | exactly one of | The condition (§2). |
| `unmodeled` | exactly one of | `true`. The criterion cannot be expressed; it is carried as text and always evaluates `unknown`. |

**`unmodeled: true` is a feature, not a TODO.** Real protocols contain criteria
no closed language can express ("in the investigator's opinion, unlikely to
comply"). Dropping them silently is how a screening tool starts lying: the
patients they would have caught come out `eligible` instead of "needs chart
review". Carrying them makes the honest answer — `undetermined` — the visible
one. Roughly a third of real criteria land here; see
[docs/chia-coverage.md](docs/chia-coverage.md).

---

## 2. The condition language

Deliberately closed: three combinators over five families of leaf, no
arbitrary expressions. That closure is what makes static interval analysis (§4)
and live threshold sensitivity tractable — the lesson from general-purpose rule
engines whose conditions can only be understood by running them.

### Combinators

```yaml
when: { all: [ <condition>, ... ] }   # every child true
when: { any: [ <condition>, ... ] }   # at least one child true
when: { not: <condition> }
```

Each takes at least one child and nests arbitrarily. Any object carrying a
`fact` key is a leaf.

### Leaves

| Form | Applies to | True when | `unknown` when |
|---|---|---|---|
| `{ fact, op: eq\|neq\|gt\|gte\|lt\|lte, value, unit? }` | `number` facts | the comparison holds | fact absent, or present but not a number (e.g. a quarantined `">60"`) |
| `{ fact, op: eq\|neq, value }` | `enum` or `boolean` facts | the scalar comparison holds | fact absent, or present with the wrong runtime type |
| `{ fact, op: in\|notIn, codes: {system, values} }` | `code` facts | `in`: any entry matches system+code. `notIn`: none does | fact absent, or not a code list |
| `{ fact, op: exists }` | number or code facts | the fact is present | fact absent |
| `{ fact, op: anyWithin, codes, windowDays }` | `code` facts | a matching entry has `daysAgo <= windowDays` | fact absent, not a code list, or a matching entry carries no `daysAgo` |

Notes that carry weight:

- **`unit` performs no conversion.** It declares what the literal is written in.
  If a numeric fact has a declared unit, an omitted or different literal unit is
  a blocking validation error. Patient numbers are normalized to that same
  canonical unit before evaluation.
- **`anyWithin` is the entire temporal algebra.** One operator, one direction,
  days only. Anything more (intervals between events, ordering, "on treatment
  at randomisation") is `unmodeled: true`. A washout window is the case that
  earns an operator; a general temporal logic is a different project.
- **An undated matching entry is `unknown`, not `false`.** A medication row with
  no date is not evidence that a washout was observed.
- **Value sets are inline.** No terminology server, no code expansion at
  runtime: the codes a criterion needs are written into the criterion, so the
  file is self-contained, diffable and reviewable by someone who does not have
  the vocabulary server.

---

## 3. Evaluation semantics

The evaluator is a pure function of (rule set, one patient's facts). Same
inputs, same verdict, forever — that property is the point of the whole design,
and it is what lets an LLM propose facts (§6) without ever touching a decision.

### Three values, not two

Every condition evaluates to `true | false | unknown`. Missing data produces
`unknown` and it propagates; there is no default, no imputation, and no silent
pass. Strong Kleene logic:

**`all` (∧)**

| ∧ | T | F | U |
|---|---|---|---|
| **T** | T | F | U |
| **F** | F | F | F |
| **U** | U | F | U |

**`any` (∨)**

| ∨ | T | F | U |
|---|---|---|---|
| **T** | T | T | T |
| **F** | T | F | U |
| **U** | T | U | U |

**`not`** — `not T = F`, `not F = T`, `not U = U`.

Read the two absorbing cases out loud, because they are the useful ones:
`all(false, unknown) = false` (one confirmed failure settles it — no chart
review needed), and `any(true, unknown) = true`.

### Criterion orientation

A criterion's *verdict* is not its condition's value: exclusions invert.

| `kind` | condition `true` | condition `false` | condition `unknown` |
|---|---|---|---|
| `inclusion` | **pass** | **fail** | unknown |
| `exclusion` | **fail** (the exclusion fired) | **pass** | unknown |
| any, with `unmodeled: true` | — | — | always unknown |

### Overall outcome

Evaluated in this order, first match wins:

1. any criterion `fail` → **`ineligible`**
2. else any criterion `unknown` → **`undetermined`**
3. else → **`eligible`**

`ineligible` beats `undetermined` deliberately: a patient with one confirmed
disqualifier does not need the rest of their chart pulled. `undetermined` is
never rounded off — it is the count that says how much human work is left, and
every surface that reports numbers must show it.

### Traces

Every evaluation emits a tree mirroring the condition tree. Each node carries
its kind, its result, the observed value, and a rendered detail string
(`age = 71, required <= 65`). A verdict without a trace is not a verdict — it is
an opinion. The trace shape is implementation detail, not part of this format;
what the format requires is that one exists for every non-`unmodeled` criterion.

---

## 4. Static analysis, and its scope

`rules check` runs without any patient data. Findings:

| Code | Level | What it means |
|---|---|---|
| `fact-model-mismatch` | error | The loaded model's name differs from the rule set's declared `factModel`. |
| `unknown-fact` | error | The criterion names a fact the fact model does not declare. |
| `type-mismatch` | error | An operator or literal is incompatible with the declared fact type. |
| `unknown-enum-value` | error | An enum equality literal is outside the fact's closed value list. |
| `exists-value-type` | error | `exists` is used on an enum or boolean, where `eq`/`neq` must express the intended value. |
| `unknown-code-system` | error | The value set cites a system not declared for that fact. |
| `unit-undeclared` | error | A numeric literal omits the unit declared by its fact. |
| `unit-mismatch` | error | The literal's `unit` differs from the declared unit; evaluation is blocked. |
| `unmodeled-criterion` | info | Recorded so the count of unmodeled criteria is never invisible. |
| `analysis-incomplete` | info | The criterion contains logic outside complete static analysis; no clean-proof claim is made for it. |
| `unsatisfiable-criterion` | error | One criterion's own `all` constraints on a fact intersect to the empty set — it can never fire. |
| `contradictory-inclusions` | error | Two or more inclusions whose constraints on one fact intersect to nothing: the rule set admits nobody. |
| `unsatisfiable-ruleset` | error | An exclusion covers the entire numeric domain admitted by the inclusions: no patient can pass. |

**Scope, stated because an over-claimed checker is worse than none.** The
analysis uses interval arithmetic and direct code-set reasoning over necessary
constraints reachable through `all` chains. It is explicitly not an SMT solver.
Concretely:

- Necessary sibling constraints remain analyzable when a criterion also contains
  `any` or `not`, but the criterion receives `analysis-incomplete`.
- Contradictions that only exist across two different facts are not found.
- Direct `in S` plus `notIn T` contradictions are proved when `S` is a subset
  of `T`; richer terminology relationships are not expanded.
- A clean run means "no conflicts found *within that scope*", never "no
  conflicts exist". The CLI prints the scope alongside the clean result.

Within the scope, the claim is the strong one: a reported contradiction holds
for **all inputs**, not just the corpus you happened to test.

---

## 5. The fact-model contract

A fact model is the vocabulary a rule set is written against, and the contract
an ingestion pipeline must satisfy.

```yaml
name: patient-facts/v1
facts:
  age: { type: number, unit: years }
  sex: { type: enum, values: [male, female, other] }
  nyha_class: { type: enum, values: [I, II, III, IV] }
  medications: { type: code, systems: [rxnorm, rxnorm-class] }
  on_arni: { type: boolean }
```

| Declaration | Fields | Notes |
|---|---|---|
| `number` | `unit?` | Declare the canonical unit unless the value is genuinely unitless. Rules must repeat it exactly; ingestion must normalize patient values to it. |
| `code` | `systems` | The permitted code systems for this fact. |
| `enum` | `values` | Closed value list. |
| `boolean` | — | |

Rules:

- Fact names are `snake_case`. A `lab_<slug>` prefix marks a fact flattened out
  of a structured record rather than stated by a human; the two vocabularies can
  coexist in one model, and a rule set picks the route its data actually has.
- **One model per name.** Two files declaring `patient-facts/v1` differently
  means `rules check` gives different answers depending on which path you pass.
  This repo learned that the hard way; see the header of
  `packs/trials/fact-model.yaml`.
- Bump the model version when a fact is removed, retyped, or has its unit
  changed. Adding a fact is backwards-compatible.

### Patient facts

What the evaluator actually reads: a patient id and a flat map of values. No
provenance, no review state — those live one layer up (§6) and are compiled out.

```yaml
patient: SYN-042
facts:
  age: 63
  sex: female
  lvef: 38
  medications:
    - { code: warfarin, system: rxnorm, daysAgo: 5 }
```

**An absent key is `unknown`, never `false`.** This is the single most important
sentence in the format: a fact model with 40 facts and a patient record with 12
of them is the normal case, not an error, and the evaluator's job is to say so.

Checked execution validates each declared patient value's runtime type, enum
membership, and code system against the loaded model. Bare numeric values carry
no per-row unit: their documented contract is that ingestion has already
converted them to the model's canonical unit.

**Identity is canonical in `fixtures/patients/`** for this repo's synthetic
patients: `age` and `sex` there win over any other file mentioning the same id.

---

## 6. Facts with provenance — the two-sided contract

`corpus/facts/*.yaml` is the patient-side mirror of a rule set: the same
criteria-as-code discipline applied to the evidence. It exists so that an
agent can propose facts without ever being able to decide anything.

```yaml
patient: SYN-042
asOf: 2026-03-12
facts:
  - fact: nyha_class
    value: III
    status: confirmed          # proposed | confirmed | rejected
    confidence: 0.94
    extractedBy: llm/claude-opus-5
    source:
      doc: echo-2026-03-12
      quote: symptoms consistent with NYHA class III heart failure
    reviewedBy: e.cuyugan
    reviewedAt: 2026-08-20T14:31:00Z
```

**Three provenance tiers.** `pipeline` — a deterministic flatten of structured
data, no model involved. `llm/<model-id>` — extracted from narrative text.
`human` — typed or corrected by a reviewer.

**The invariant.** Only `pipeline` and `confirmed` entries are compiled into
patient-facts and reach the evaluator. A `proposed` entry is invisible to the
engine and renders as *not evaluable — pending review*. Nothing auto-confirms,
at any confidence. In format terms:

| tier | may enter as | reaches the engine when |
|---|---|---|
| `pipeline` | `confirmed` | always (it is deterministic; `proposed` is forbidden for this tier) |
| `llm/*` | `proposed` | a human sets `confirmed` + `reviewedBy` + `reviewedAt` |
| `human` | `confirmed` | immediately — a person is on the record for it |

Structural rules the format enforces:

- an `llm/*` entry must carry `source: {doc, quote}` and a `confidence`;
- a `pipeline` entry must carry neither a `confidence` nor `status: proposed`;
- `confirmed` and `rejected` non-pipeline entries must carry `reviewedBy` and
  `reviewedAt`; a `proposed` entry must not claim a reviewer;
- one live (non-`rejected`) entry per fact name. Rejected entries are history
  and may repeat.

**`quote` must appear verbatim in the named document's body**, modulo newline
normalisation. This is checked by `facts check`, not by the JSON Schema. A fact
that cannot cite its source does not exist — ungrounded output is discarded,
not flagged, because a flagged hallucination is still a hallucination someone
has to triage.

**`confidence` is a model self-estimate, not a calibrated probability.** It has
exactly two jobs: ordering the review queue, and flagging `< 0.8` as unsure. It
never gates evaluation. Any format consumer that thresholds on it to skip review
has broken the invariant.

`measuredAt` + `validWithinDays` express recency of the *observation*, measured
back from the file's `asOf`. They let `facts check` flag a lab that was real but
is now too old for the protocol's window.

---

## 7. Versioning conventions

**The rule set.** `rulesetVersion` is semver, and behaviour is what versions:

| Bump | When |
|---|---|
| MAJOR | a criterion is removed, or its meaning inverts (`kind` flips, `not` added) |
| MINOR | a criterion is added, a threshold moves, a value set changes — anything that can flip a patient |
| PATCH | `verbatim`, `ref`, `source`, comments. No patient can flip. |

The test for MINOR-vs-PATCH is empirical, not editorial: run `rules diff` over a
corpus. If any patient flips, it was not a patch.

**Amendments live side by side.** Keep the prior version as
`ruleset@<version>.yaml` next to the current `ruleset.yaml`, in the same
directory. The diff is then a file pair, reviewable in a pull request, and the
amendment view has two real versions to compare. Git history is the audit log;
the file pair is the artifact.

**The format itself** is versioned by this document and `schema/`. Additive
changes (a new optional field) keep format version 1. Anything that invalidates
an existing valid file is format version 2, with the schema `$id` bumped.

**The fact model** carries its version in its name (`patient-facts/v1`), and a
rule set names the exact model it was authored against.

---

## 8. Known limitations

Stated here rather than discovered later.

- **`exists` cannot tell "never measured" from "measured and discarded".** Both
  are missing usable evidence and therefore evaluate `unknown`. Do not use
  `exists` to mean "was this test done" on ingested data — it means "is there a
  usable value here now".
- **Static analysis is incomplete** (§4). Cross-fact implications, terminology
  expansion, and complete proofs through `any`/`not` are out of scope and are
  labeled `analysis-incomplete` rather than silently presented as clean.
- **No unit conversion.** `unit` declares, it does not convert.
- **No temporal algebra beyond `anyWithin`.** No event ordering, no intervals,
  no "at randomisation".
- **No effective-dating inside a rule set.** A criterion that changed mid-study
  is two rule-set versions, not one file with dates.
- **Unmodeled criteria need chart review.** A rule set is not a screening
  decision. For any real protocol, expect a meaningful fraction of criteria to
  be `unmodeled: true`, which is why `undetermined` is a first-class outcome
  rather than a rounding error.

## What the schema cannot check

JSON Schema is a shape checker; some of the format's rules are relational. These
are enforced by the reference parser and asserted in
`tests/schema/format.test.ts`:

- criterion ids unique within a rule set;
- one live entry per fact name in a facts file;
- every `fact` reference resolving in the named fact model (that is
  `rules check`, since it needs both files);
- the quote-grounding gate (`facts check`, since it needs the notes).

The published schema and reference parser agree on semantic-version syntax,
calendar dates, non-empty code strings, fact names, and the rest of the shape.
The conformance suite rejects any drift between them.

## Future work

Import and export are how a format survives its first engine:

- **USDM / ICH M11 import.** CDISC USDM's `EligibilityCriterion` carries
  criteria as structured *text*. Compiling that text into `when` conditions is
  the obvious next converter, and it is where the regulatory pressure is
  pointing.
- **OHDSI ATLAS (circe JSON) export.** ATLAS is the one widely deployed
  executable-criteria system; a rule set that can also run as an OMOP cohort
  query reaches every OHDSI site.
- **CQL export.** For teams already standardised on HL7 CQL.

None of these are competitors. They are targets.
