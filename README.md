# rulekit

**Clinical-trial eligibility criteria as versioned, tested, conflict-checked
code.** Agents propose evidence. Humans confirm it. A deterministic engine is
the only thing that ever decides.

TypeScript engine + CLI + a browser workbench. Apache-2.0. No backend, no
accounts, no telemetry. Everything runs on a laptop against files in a git repo.

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

rulekit demonstrates treating them like reviewable logic:

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
compiled facts and versioned rules. Evaluation traces name the criterion and
observed fact; narrative quotes remain in the upstream facts file and are not
embedded in the evaluator's patient-facts input or trace.

That separation makes the demo inspectable; it does not establish an FDA device
classification, satisfy any FDA guidance, or demonstrate regulatory compliance.
Trial feasibility and recruitment operations have their own institutional,
privacy, validation and audit requirements. This repository has no regulatory
assessment, clinical validation, authenticated approval workflow or durable
audit trail.

## Why anyone should care: the amendment

A substantial protocol amendment carried a **median direct cost of $141K in
Phase II and $535K in Phase III**, and roughly **45% of substantial amendments
are judged avoidable** (Tufts CSDD, *Impact of Protocol Amendments on Clinical
Trial Performance and Cost*). Those study-wide figures do not show that logic
contradictions caused the amendments or that rulekit would have avoided them.
The demonstrated value is narrower: a closed rule language can prove some
unsatisfiable rule sets, measure criterion attrition on the supplied synthetic
corpus, and show which synthetic patient verdicts change between two versions.

A sound example of the proof class is two inclusions requiring `age >= 65` and
`age <= 40`, which produce:

```text
✕ ERROR contradictory-inclusions [older-adult, young-adult] no patient can pass:
  the inclusion constraints on age intersect to the empty set
```

The behavioural diff and the workbench's Amendment view compare versions over a
provided corpus. They do not predict amendment cost, prove avoidability, or
replace prospective protocol and clinical review.

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
i INFO analysis-incomplete [anticoag-washout] ... this criterion is not proven conflict-free
i INFO analysis-incomplete [nyha-class-iv] ... this criterion is not proven conflict-free
0 conflict(s), 0 warning(s) — static analysis is not a proof of consistency.
$ echo $?
0
```
<sub>Abridged: long INFO-level messages are trimmed.</sub>

Hard lint and proven contradiction findings exit non-zero, so this is a CI
gate. The real COMMANDER HF pack is clean too:

```console
$ npm run rules -- check rules/trials/commander-hf/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml
i INFO unmodeled-criterion [medically-stable] "Must be medically stable in terms of their heart failure clinical status at the time of randomization" is carried as verbatim text (unmodeled: true); affected patients evaluate unknown
0 conflict(s), 0 warning(s)
```
<sub>Abridged: the real output prints all four unmodeled criteria, in protocol
order, each with its full verbatim text. One is shown here.</sub>

Scope, stated so the green result is not over-read: the conflict passes prove
numeric interval contradictions and directly incompatible code-set constraints
reachable through `all`. Conditions containing `any`/`not` and other unsupported
logic emit `analysis-incomplete`; cross-fact implications are not solved. See
[FORMAT.md §4](FORMAT.md#4-static-analysis-and-its-scope).

### 2. Run the rule-set tests, with firing coverage

```console
$ npm run rules -- test rules/trials/demo-hf-001 \
    --fact-model packs/trials/fact-model.yaml --corpus fixtures/patients --coverage
13/13 cases pass
coverage (pass/fail/unknown):
  age-min: 12/1/0
  lvef-max: 12/1/0
  egfr-min: 11/1/1
  anticoag-washout: 11/1/1
  renal-safety: 10/2/1
  nyha-class-iv: 1/1/11
corpus dead-rule scan (10 patients):
⚠ dead rule: egfr-min — never fails on the corpus (0 of 10 patients; 0 unknown)
⚠ dead rule: nyha-class-iv — always unknown on the corpus (10 of 10 patients); the required fact may be absent or invalid
```

Coverage here means *firing* coverage: a criterion that never fails on realistic
data is a criterion nobody has actually tested, and it gets flagged.

### 3. Diff two protocol versions behaviourally

```console
$ npm run rules -- diff rules/trials/demo-hf-001/ruleset@1.0.1.yaml \
    rules/trials/demo-hf-001/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml --corpus fixtures/patients
rulesetVersion 1.0.1 → 1.2.0
+ added renal-safety
~ changed anticoag-washout
~ changed nyha-class-iv
~ metadata protocol
~ metadata effective
5 patient(s) flip:
  SYN-007: undetermined → ineligible  (renal-safety)
  SYN-019: undetermined → ineligible  (renal-safety)
  SYN-042: undetermined → ineligible  (renal-safety)
  SYN-058: undetermined → ineligible  (renal-safety)
  SYN-088: undetermined → ineligible  (anticoag-washout)
```
<sub>Abridged: INFO-level scope findings are omitted.</sub>

Structural diff on top, behavioural diff underneath — *which patients change
answer, and which criterion did it*. That is the amendment question.

### 4. Screen a corpus

```console
$ npm run rules -- screen rules/trials/commander-hf/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml --corpus corpus/normalized --out screen.json
screened 100: 0 eligible · 97 ineligible · 3 undetermined
```

This is the observed output for one synthetic corpus, not a validated accuracy
result or evidence about the real COMMANDER HF population. `screen.json` carries
the full per-criterion trace plus engine version/commit (when available), exact
ruleset/fact-model/input hashes, per-patient input hashes, evaluation time and
`asOf`, and machine-visible partial/unmodeled warnings.

Add `--report screen.md --as-of YYYY-MM-DD` for the demonstration report: band counts, a
per-criterion attrition table (sequential / fails-alone / sole-reason), and the
strict sole-disqualifier section. An unknown or unmodeled criterion prevents a
sole-reason claim, so the section may be empty. The report is not a feasibility
questionnaire and does not say how many real patients a site would gain. Its
front matter records provenance and partial status; it does not verify approval
or regulatory compliance.

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

Review clicks persist only in this browser's local storage under a generic demo
identity. They are not authenticated, append-only, shared, signed, or a durable
audit trail; exported review data must not be treated as an authoritative
clinical or regulatory record.

---

## What's in the box

**Two trial packs**, both in `rules/trials/`:

| Pack | What it is | Why it exists |
|---|---|---|
| `commander-hf` | COMMANDER HF ([NCT01877915](https://clinicaltrials.gov/study/NCT01877915)), 12 criteria transcribed verbatim from the registry's `eligibilityCriteria` text. **8 executable (2 explicitly partial), 4 `unmodeled: true`.** | The honest one. `ruleset.modeling.json` makes the partial translations machine-visible; a third of the criteria do not fit the closed language at all. |
| `demo-hf-001` | A synthetic protocol with an immutable original `1.0.0`, a valid `1.0.1` corrigendum, and current `1.2.0`. The eGFR `[30,45)` band passes the minimum inclusion and fires the safety exclusion; it is deliberately **not** called a contradiction. | The teaching one. It makes evaluation boundaries and behavioural diff visible. `check` returns clean within its documented proof scope. |

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
- **Recorded fixture score: 98.3% precision / 98.3% recall** over 10 notes and 58 expected
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

- **Static analysis is deliberately incomplete.** It proves interval and simple
  code-set contradictions through `all` chains. Cross-fact implications and
  complete reasoning through `any`/`not` remain outside scope; those constructs
  produce an explicit `analysis-incomplete` finding.
- **`exists` means a usable value is present, not “a test was performed.”** A
  missing or quarantined value evaluates `unknown`, preserving the distinction
  between known presence and missing evidence. ([FORMAT.md §8](FORMAT.md#8-known-limitations).)
- **Unmodeled criteria need chart review.** 4 of COMMANDER HF's 12 criteria are
  carried as text and always evaluate `unknown`. A rule set is not a screening
  decision, and `undetermined` is a first-class outcome for exactly this reason.
- **No unit conversion**, and **no temporal algebra** beyond `anyWithin` (one
  code-set match inside a day window).
- **Absent and empty are different.** An absent fact key is `unknown`; a present
  empty code list asserts a complete, known-empty search. There is no
  completeness marker, open-world reasoning, terminology expansion, hierarchy
  traversal, or multi-observation numeric time series. See
  [FORMAT.md](FORMAT.md#5-the-fact-model-contract).
- **No EHR integration.** Inputs are pre-normalized YAML. The included FHIR
  scripts cover a small synthetic Synthea pipeline, not Epic/Cerner connectivity
  or an operational clinical data feed.
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
   cd rules/trials/my-trial && rm ruleset@*.yaml CORRIGENDUM.md
   ```

2. **Author the criteria.** One criterion per criterion in the protocol. Paste
   the protocol's exact sentence into `verbatim` and never edit it to fit; put
   the protocol's own numbering in `ref`. If a criterion does not fit the
   condition language, mark it `unmodeled: true` and keep the verbatim text —
   deleting it is the one unforgivable move. Set `ruleset`, `rulesetVersion:
   1.0.0`, `factModel: patient-facts/v1`, and `source.registry` / `source.id` / `source.url` if
   it is a registered study (any registry: clinicaltrials.gov, isrctn.com, ...). [FORMAT.md](FORMAT.md) is the reference; the
   condition language is five leaf forms and three combinators, and that is all.

3. **Declare any new facts.** If your protocol screens on something
   `packs/trials/fact-model.yaml` does not declare, add it there with a type and
   a unit. `rules check` will tell you: `unknown-fact`.

4. **Check it.**

   ```bash
   npm run rules -- check rules/trials/my-trial/ruleset.yaml \
     --fact-model packs/trials/fact-model.yaml
   ```

   Fix errors. Missing and mismatched units are blocking errors because the
   engine never guesses a conversion.

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
     --fact-model packs/trials/fact-model.yaml --corpus corpus/normalized --coverage
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

No cloud dependency, no accounts and no telemetry are built into the local CLI.
The present audience is format authors and researchers studying rule-governance
concepts on synthetic data. Academic trial units and site coordinators are
potential design partners, not validated users: the project lacks EHR ingestion,
real-chart validation, access controls and a durable audit trail, so its output
is not an operational feasibility or negotiating artifact.

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
