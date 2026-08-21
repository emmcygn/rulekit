# rulekit

**Clinical-trial eligibility criteria as versioned, tested, conflict-checked
code.** Agents propose evidence. Humans confirm it. A deterministic engine is
the only thing that ever decides.

TypeScript engine + CLI + a browser workbench. Apache-2.0. No backend, no
accounts, no telemetry — it runs on a laptop against files in a git repo.

> ### ⚠ Not medical software
>
> This is a demonstration of **rule-governance tooling**. It is not validated,
> not cleared by any regulator, and **not for clinical, feasibility, or
> research screening use**. Every patient, note, clinician and institution in
> this repo is synthetic and fabricated. The trial criteria are transcribed from
> real public registry text, but the numbers this tool produces are about
> invented people.

---

## The idea in one screen

Eligibility criteria are the most consequential logic in a trial protocol, and
almost everywhere they are prose in a Word document. They are not versioned as
behaviour, not tested, not checked for contradiction, and when they change
nobody can say which already-enrolled participants are affected without a manual
chart review.

rulekit treats them the way you would treat any other production logic:

```yaml
- id: renal-safety
  ref: E3
  kind: exclusion
  verbatim: "eGFR below 45 at screening"        # the protocol's own words, never edited
  when: { fact: egfr, op: lt, value: 45 }       # the executable meaning
```

…and then does the things a rule file makes possible: static conflict
detection, per-rule tests with firing coverage, a behavioural diff between two
protocol versions, and a live attrition funnel over a patient corpus.

The second half is the harder one. Real eligibility data is locked in narrative
text, and the tempting move is to let a language model read the chart and answer
"is this patient eligible?". rulekit refuses that shape:

```
 protocol text ──[human author]───────────────────────▶ ruleset.yaml ─┐
                                                                      ├─▶ engine ─▶ verdict + trace
 patient records ──[flatten]──▶ facts ──┐                             │
 clinical notes ──[LLM extract]──▶ proposed facts ──[human confirms]──┘
```

**The invariant (G11): the model never sorts patients and never emits a
verdict.** It emits typed facts, each carrying a verbatim quote from the source
document and a confidence score. A `proposed` fact is invisible to the engine
until a person confirms it. Eligibility stays a deterministic function of
confirmed facts and versioned rules, and every verdict traces to a rule version
plus a fact plus the sentence that fact came from.

That is not just an engineering preference. It is close to a checklist
implementation of the FDA's **Non-Device CDS** Criterion 4 — that the clinician
can independently review the basis for the recommendation — and of the
**assistive, not autonomous** posture in FDA's January 2025 draft guidance on
AI in regulatory decision-making. The vocabulary that guidance uses (context of
use, credibility assessment, human-in-the-loop) maps onto concrete parts of this
repo: the grounding gate, the review pane, and the eval suite wired into CI.

## Why anyone should care: the amendment

A substantial protocol amendment carries a **median direct cost of $141K in
Phase II and $535K in Phase III**, and roughly **45% of substantial amendments
are judged avoidable** (Tufts CSDD, *Impact of Protocol Amendments on Clinical
Trial Performance and Cost*). Eligibility criteria are a recurring cause: a
threshold that contradicts another threshold, a criterion nobody realised
excluded a third of the screening pool, a change whose effect on already-randomised
participants surfaces only after it ships.

Two of those are catchable before the protocol leaves the building, by a tool
that can read the criteria as logic:

```console
$ npm run rules -- check rules/trials/demo-hf-001/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml

✕ ERROR contradictory-band [egfr-min, renal-safety] every patient with egfr in [30, 45) passes inclusion and is then excluded by "renal-safety" — for all inputs, not just a test corpus
    egfr: inclusion admits [30, ∞) ∩ exclusion fires (−∞, 45) → contradictory band [30, 45)
```
<sub>Abridged — the full output is in the quickstart below.</sub>

The third one — who is already enrolled and now fails — is what the behavioural
diff and the workbench's Amendment view are for.

## Where this sits

**ICH M11 and CDISC USDM are making protocols machine-readable, but eligibility
criteria in both remain structured *text*.** M11 is real regulatory pressure now
(EMA adopted Dec 2025, FDA guidance May 2026), and computable criteria is the
obvious next layer. rulekit is a proposal for that layer.

Two adjacent shapes, named so the difference is legible:

- **Counting platforms.** TriNetX Criteria Analysis sells criterion-level
  disqualification ranking over 100M+ live records, and markets it as amendment
  avoidance. It works, and the data access is unbeatable. The difference is
  ownership: their criteria are queries inside a walled garden; a rulekit rule
  set is a diffable file the site owns and can re-run against any dataset,
  including one that never leaves the building. The claim here is
  *criterion-level attrition you own and can re-run* — not that nobody shows
  criterion-level attrition. They do.
- **LLM-decides matching.** TrialGPT and similar let a model judge eligibility
  directly. rulekit's whole argument is that this is the wrong place to put the
  model: it decides, so it must be right, and you cannot diff it. Here the model
  proposes evidence and a rule file decides.

**Prior art worth reading before you decide this is novel:**
[Criteria2Query 3.0](https://github.com/OHDSI/Criteria2Query) (GPT →
cohort JSON, human in the loop), **TrialPathfinder** (criteria-relaxation
simulation over real-world data), **OHDSI ATLAS/circe** (the one widely deployed
executable-criteria system — circe JSON compiled to OMOP SQL), and **HL7 CQL**
(mature, with a solid TypeScript engine in `cql-execution`). Triomics already
ships criterion-level rationales with source citations, so quote-grounding alone
is not new either.

**The honest claim,** which is narrower than it first sounds: there is **no open
implementation** of the full two-sided architecture — typed fact + verbatim
quote + confidence + confirm/edit/reject + a deterministic engine as the only
decider — as one artifact, with the format specified separately from the engine.
Amendment-impact-on-already-enrolled appears to be unshipped by anyone, though
that is absence of evidence, not proof.

ATLAS circe export, CQL export and USDM import are named [future
work](FORMAT.md#future-work). They are targets, not competitors.

---

## Quickstart

Node 20+. Every command below was run against this commit; outputs are real and
marked *abridged* where trimmed.

```bash
git clone <this repo> && cd rulekit
npm ci
```

### 1. Check a rule set for contradictions

```console
$ npm run rules -- check rules/trials/demo-hf-001/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml
✕ ERROR contradictory-band [egfr-min, renal-safety] every patient with egfr in [30, 45) passes inclusion and is then excluded by "renal-safety" — for all inputs, not just a test corpus
    egfr: inclusion admits [30, ∞) ∩ exclusion fires (−∞, 45) → contradictory band [30, 45)
! WARNING unit-mismatch [egfr-min] "egfr-min" compares in mL/min; the fact model declares "egfr" in mL/min/1.73m2. Values are compared as-is — declare the same unit or add a conversion.
1 conflict(s), 1 warning(s)
$ echo $?
1
```
<sub>Abridged: INFO-level lines omitted.</sub>

Non-zero exit — this is a CI gate. `DEMO-HF-001` is the teaching pack and its
v1.1.0 has the contradiction seeded on purpose. The real pack is clean:

```console
$ npm run rules -- check rules/trials/commander-hf/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml
i INFO unmodeled-criterion [medically-stable] "Must be medically stable in terms of their heart failure clinical status at the time of randomization" is carried as verbatim text (unmodeled: true); affected patients evaluate unknown
0 conflict(s), 0 warning(s)
```
<sub>Abridged: the real output prints all four unmodeled criteria, in protocol
order, each with its full verbatim text. One is shown here.</sub>

Scope, stated so the green result is not over-read: the conflict passes are
interval arithmetic over single-fact constraints. Within that scope the finding
holds *for all inputs*; outside it (cross-fact contradictions, code-set
overlaps, conditions containing `any`/`not`) nothing is claimed. See
[FORMAT.md §4](FORMAT.md#4-static-analysis-and-its-scope).

### 2. Run the rule-set tests, with firing coverage

```console
$ npm run rules -- test rules/trials/demo-hf-001 \
    --fact-model packs/trials/fact-model.yaml --corpus fixtures/patients
10/10 cases pass
coverage (pass/fail/unknown):
  age-min: 9/1/0
  lvef-max: 9/1/0
  egfr-min: 9/0/1  ⚠ never fails
  anticoag-washout: 8/1/1
  renal-safety: 8/1/1
  ...
⚠ dead rule: egfr-min — never fails on the corpus (0 of 10 patients)
```

Coverage here means *firing* coverage: a criterion that never fails on realistic
data is a criterion nobody has actually tested, and it gets flagged.

### 3. Diff two protocol versions behaviourally

```console
$ npm run rules -- diff rules/trials/demo-hf-001/ruleset@1.0.0.yaml \
    rules/trials/demo-hf-001/ruleset.yaml --corpus fixtures/patients
+ added renal-safety
~ changed anticoag-washout
5 patient(s) flip:
  SYN-007: undetermined → ineligible  (renal-safety)
  SYN-019: undetermined → ineligible  (renal-safety)
  SYN-042: undetermined → ineligible  (renal-safety)
  SYN-058: undetermined → ineligible  (renal-safety)
  SYN-088: undetermined → ineligible  (anticoag-washout)
```

Structural diff on top, behavioural diff underneath — *which patients change
answer, and which criterion did it*. That is the amendment question.

### 4. Screen a corpus

```console
$ npm run rules -- screen rules/trials/commander-hf/ruleset.yaml \
    --corpus corpus/normalized --out screen.json
screened 100: 0 eligible · 97 ineligible · 3 undetermined
```

Zero eligible is the correct answer, not a bug: COMMANDER HF's real criteria
against 100 synthetic primary-care patients should find approximately nobody.
`screen.json` carries the full per-criterion trace for every patient.

Add `--report screen.md` for the feasibility write-up: band counts, a
per-criterion attrition table (sequential / fails-alone / sole-reason), and the
sole-disqualifier section — the list of patients a site would gain by relaxing
one criterion, which is the argument you attach to a sponsor's feasibility
questionnaire. Every number derives from the engine's per-patient verdict, so
the report and the workbench can never tell different stories.

### 5. Check the patient-side facts

```console
$ npm run facts:check
facts check: 10 file(s) OK

$ npm run facts:eval
extraction eval — 10 notes, 58 expected facts

  precision 98.3%   recall 98.3%   f1 98.3%
  tp 57   fp 1   fn 1

grounding — 58/61 proposals survived the gate (95.1%)
  caught 2 wrong fact(s), over-blocked 1 right one(s)
  ...
  expected calibration error: 0.071
  (self-estimates are not calibrated probabilities — this table orders the review queue, nothing else)
```

Both are offline. The extraction responses are recorded and committed in
`evals/recorded/`; no API key exists in CI and no network call is made.

### 6. The workbench

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
```

Five tabs over the demo pack: **Funnel** (attrition waterfall, click through to
per-patient traces), **Thresholds** (drag a numeric criterion, counts recompute
live), **Amendment** (version diff, including already-randomised participants),
**Checks** (the conflict findings, click to jump into the editor), **Review**
(the proposed-fact queue — confirm, edit, reject).

The editor is Monaco over the same YAML files the CLI reads — not a copy. Edit
the rule set on the left and the funnel on the right moves.

**What is demo-scale, plainly:** the workbench cohort is the **10 hand-written
fixtures** in `fixtures/patients/`, not the 100-patient corpus, and every one of
them is synthetic. Counts in the UI are counts of ten. There is no file upload:
the corpus is a build-time glob, so you cannot point it at your own patients
without rebuilding. The 100-patient corpus and the real trial pack are reachable
from the CLI only.

---

## What's in the box

**Two trial packs**, both in `rules/trials/`:

| Pack | What it is | Why it exists |
|---|---|---|
| `commander-hf` | COMMANDER HF ([NCT01877915](https://clinicaltrials.gov/study/NCT01877915)), 12 criteria transcribed verbatim from the registry's `eligibilityCriteria` text. **8 modelled, 4 `unmodeled: true`.** | The honest one. Real criteria, and a third of them do not fit a closed condition language — which is the point, not the failure. |
| `demo-hf-001` | A synthetic protocol in two versions (`ruleset@1.0.0.yaml`, `ruleset.yaml`), with a contradiction seeded between `egfr-min` and `renal-safety`. | The teaching one. It is what the workbench loads and what makes `check` and `diff` show something in ten seconds. |

Plus `packs/trials/fact-model.yaml` (the vocabulary both are written against),
`fixtures/patients/` (10 hand-written edge cases), `corpus/` (100 flattened
Synthea patients, in three stages), `corpus/notes/` (10 hand-written synthetic
clinical notes), `corpus/facts/` (extracted facts with provenance), and
`evals/` (the extraction eval harness).

## The format is the artifact

**[FORMAT.md](FORMAT.md)** specifies the rule format independently of this
engine: every field, the closed condition language and its exact semantics
(including the Kleene truth tables, criterion orientation, and how `overall` is
aggregated), the fact-model contract, the provenance/review contract, versioning
conventions, and the known limitations. JSON Schema in
[`schema/`](schema/), with `tests/schema/format.test.ts` validating every
shipped file against it and asserting that the schema and the reference parser
agree on ~35 malformed documents.

Format first, engine second — the Sigma detection-rules model. A format outlives
its first implementation.

## The data pipeline

Synthea FHIR R4 sample bundles → flatten → **mess** → normalize.
[docs/data-pipeline.md](docs/data-pipeline.md) has the whole thing.

The unusual stage is the mess injector: a seeded, deterministic corruption pass
that makes a clean synthetic corpus resemble a real extract — dropped units,
site-local lab codes replacing LOINC, `">7.16"` where a number should be,
duplicate medication rows, backdated timestamps. The normalize stage then repairs
what it honestly can and **quarantines the rest rather than guessing a number**.
94 of 100 patients end up carrying at least one quarantined fact, and the
evaluator sees those as `unknown`, which is the truthful answer.

Whole pipeline is reproducible byte-for-byte from a seed. Nothing calls
`Date.now()` or `Math.random()`.

## Honest numbers

- **56.7% of real criteria are expressible** in the condition language as
  written, 12.2% partially, 31.1% not at all — measured over all 12,060
  criterion lines in the [Chia](https://github.com/WengLab-InformaticsResearch/CHIA)
  corpus (996 Phase IV trials, CC-BY).
  **This is a heuristic classification.** It matches surface patterns in the
  criterion text with regex anchor and blocker lists — it does not parse the
  criteria, does not attempt to write the rules, and has not been validated
  against human labels. Read it as an order-of-magnitude sanity check on whether
  the language is sized right, and nothing stronger. Method, both directions of
  bias, and a worked example of the classifier disagreeing with a human author:
  [docs/chia-coverage.md](docs/chia-coverage.md).
- **Extraction: 98.3% precision / 98.3% recall** over 10 notes and 58 expected
  facts — against ground truth that exists *by construction*, because we wrote
  the notes. That is a measurement of a fixed recorded run on authored text, not
  a claim about clinical NLP performance on real records.
- **Confidence scores are model self-estimates**, not calibrated probabilities
  (measured ECE 0.071 on this tiny set). They order the review queue and flag
  "unsure". They never auto-confirm anything.
- **The corpus is synthetic** end to end: Synthea for structure, hand-written
  notes for narrative. No real patient data was used, and none is needed to run
  any of this.
- **The CONSORT sanity check in the design spec was not run**, and
  [docs/data-pipeline.md](docs/data-pipeline.md#consort-sanity-check--not-run-and-why)
  says why: COMMANDER HF publishes no per-reason screen-failure breakdown to
  compare against.

## Known limitations

- **Static analysis is single-fact and `all`-only.** Cross-fact contradictions,
  code-set overlaps, and criteria containing `any`/`not` are outside the
  conflict passes. Interval arithmetic, explicitly not an SMT solver.
- **`exists` cannot distinguish "never measured" from "measured and
  quarantined".** It returns `false` for an absent fact, and the normalize stage
  deliberately omits values it cannot trust. Do not read `exists` as "was this
  test performed". ([FORMAT.md §8](FORMAT.md#8-known-limitations).)
- **Unmodeled criteria need chart review.** 4 of COMMANDER HF's 12 criteria are
  carried as text and always evaluate `unknown`. A rule set is not a screening
  decision, and `undetermined` is a first-class outcome for exactly this reason.
- **No unit conversion**, and **no temporal algebra** beyond `anyWithin` (one
  code-set match inside a day window).
- **The workbench is demo-scale**: 10 synthetic fixtures, no upload, one bundled
  trial.
- The published page loads Google Fonts over the network. Nothing else leaves
  the browser — no patient data, no rule set, no API call — but "zero network
  requests" would be a false claim, so it is not made.

---

## Adding a trial pack

The intended path for someone who authors criteria for a living. No TypeScript
required.

1. **Copy the demo pack as a starting shape.**

   ```bash
   cp -r rules/trials/demo-hf-001 rules/trials/my-trial
   cd rules/trials/my-trial && rm ruleset@1.0.0.yaml
   ```

2. **Author the criteria.** One criterion per criterion in the protocol. Paste
   the protocol's exact sentence into `verbatim` and never edit it to fit; put
   the protocol's own numbering in `ref`. If a criterion does not fit the
   condition language, mark it `unmodeled: true` and keep the verbatim text —
   deleting it is the one unforgivable move. Set `ruleset`, `rulesetVersion:
   1.0.0`, `factModel: patient-facts/v1`, and `source.nctId` / `source.url` if
   it is a registered study. [FORMAT.md](FORMAT.md) is the reference; the
   condition language is four leaf forms and three combinators, and that is all.

3. **Declare any new facts.** If your protocol screens on something
   `packs/trials/fact-model.yaml` does not declare, add it there with a type and
   a unit. `rules check` will tell you: `unknown-fact`.

4. **Check it.**

   ```bash
   npm run rules -- check rules/trials/my-trial/ruleset.yaml \
     --fact-model packs/trials/fact-model.yaml
   ```

   Fix errors. Warnings are advisory but `unit-mismatch` almost always means a
   real bug.

5. **Write the tests.** `tests.yaml` next to the rule set: one case per
   interesting patient shape, each a compact facts object plus the expected
   per-criterion verdicts and `overall`. Boundary values are the ones worth
   writing — a criterion is usually wrong at exactly its threshold.

   ```yaml
   cases:
     - name: 64yo on warfarin is excluded
       facts: { age: 64, medications: [{ code: warfarin, system: rxnorm, daysAgo: 5 }] }
       expect:
         age-range: pass
         no-recent-anticoagulants: fail
         overall: ineligible
   ```

   ```bash
   npm run rules -- test rules/trials/my-trial \
     --fact-model packs/trials/fact-model.yaml --corpus corpus/normalized
   ```

   Aim for no `⚠ never fails` lines. A criterion that never fires on realistic
   data is either dead or untested, and you want to know which.

6. **Open a pull request** with the rule set, the tests, and one line per
   criterion you marked `unmodeled` explaining why. CI runs `check` and
   `test --coverage` over every shipped pack, so a contradiction or a broken
   case fails the build rather than the trial.

Adding a whole new *domain* (not a trial — a different kind of eligibility
entirely) means a new fact model and a new pack directory. `src/core/` is
domain-agnostic and browser-safe by construction, and never needs to change for
one.

## Repo layout

```
FORMAT.md              the format spec — read this before the code
schema/                JSON Schema for all four file formats
src/core/              engine: schema, evaluator, conflicts, testing, diff  (browser-safe, zero Node imports)
src/cli/               rules check | test | diff | screen
src/cli-facts/         facts check | eval
src/extract/           LLM extraction pipeline + the grounding gate
rules/trials/          the two trial packs
packs/trials/          the fact model
fixtures/patients/     10 hand-written edge-case patients (the workbench cohort)
corpus/                100 synthetic patients · notes · extracted facts
evals/                 offline extraction eval (promptfoo + recorded responses)
web/                   the workbench (Vite + React + Monaco)
docs/                  data pipeline, Chia coverage
```

## Local-first, and who that is for

No cloud dependency, no accounts, no telemetry, no data leaving the machine. The
teams that stand to gain are the ones who cannot buy a commercial feasibility
platform: academic trial units, investigator-initiated studies, site
coordinators negotiating a criterion with a sponsor. A criterion-level attrition
table you generated yourself is a negotiating position. Larger organisations
reading or absorbing this is a fine and expected outcome.

## License & attribution

- **rulekit: Apache-2.0** ([LICENSE](LICENSE)) — engine and format. The patent
  grant matters in health tech, and it is the license academic medical centres'
  counsel are used to seeing.
- **Synthea** sample FHIR data — Apache-2.0, © MITRE.
  [synthetichealth.github.io/synthea-sample-data](https://synthetichealth.github.io/synthea-sample-data/)
- **Chia** criteria corpus — CC-BY-4.0, Kury et al., *Scientific Data* 2020.
- **ClinicalTrials.gov** — criteria text is sponsor-submitted, quoted as short
  verbatim excerpts with the NCT id and a link on every rule set.
- Every clinical note, patient, clinician name and institution in this repo is
  **fabricated for the demo**.

If this outgrows portfolio scale, its governance home is an existing community —
OHDSI or HL7 Vulcan — not a new foundation.
