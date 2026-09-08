# CLI examples and workbench setup

Use Node 22.22.2, pinned in [`.nvmrc`](../.nvmrc). Commands run from the repository
root after cloning. The examples use Bash line continuations (`\`); in
PowerShell, enter each command on one line and use `$LASTEXITCODE` to inspect
its exit status. If PowerShell blocks `npm.ps1`, use `npm.cmd`.

The outputs below describe the shipped synthetic fixtures and are marked
*abridged* where trimmed. [Development and verification](development.md) lists
the complete checks.

```bash
git clone https://github.com/emmcygn/rulekit.git
cd rulekit
npm ci
```

### 1. Check a rule set for contradictions

```console
$ npm run rules -- check rules/trials/demo-hf-001/ruleset.yaml \
    --fact-model packs/trials/fact-model.yaml
i INFO analysis-incomplete [anticoag-washout] ... this criterion is not proven conflict-free
i INFO analysis-incomplete [nyha-class-iv] ... this criterion is not proven conflict-free
0 conflict(s), 0 warning(s) — static analysis covers interval and direct code-set proofs; incomplete criteria are labeled above.
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
0 conflict(s), 0 warning(s) — static analysis covers interval and direct code-set proofs; incomplete criteria are labeled above.
```
<sub>Abridged: the real output prints all four unmodeled criteria, in protocol
order, each with its full verbatim text. One is shown here.</sub>

Scope, stated so the green result is not over-read: the conflict passes prove
numeric interval contradictions and directly incompatible code-set constraints
reachable through `all`. Conditions containing `any`/`not` and other unsupported
logic emit `analysis-incomplete`; cross-fact implications are not solved. See
[FORMAT.md §4](../FORMAT.md#4-static-analysis-and-its-scope).

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

Firing coverage records pass/fail/unknown outcomes in the authored test suite.
The separate corpus scan flags criteria that never fail or remain unknown on
the supplied patients. A rule can have complete test coverage and still never
fail in that particular corpus.

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

Both commands read committed fixtures and need no API key or live model call.
The extraction responses are recorded in `evals/recorded/`.

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

The Monaco editor starts from rule YAML bundled from the repository. Edit the
rule set on the left and the funnel on the right moves. Edits stay in browser
state; they do not write to the repository files that the CLI reads.

**What is demo-scale, plainly:** the workbench cohort is the **10 hand-written
fixtures** in `fixtures/patients/`, not the 100-patient corpus, and every one of
them is synthetic. Counts in the UI are counts of ten. There is no file upload:
the corpus is a build-time glob, so you cannot point it at your own patients
without rebuilding. The 100-patient corpus and the real trial pack are reachable
from the CLI only.

Review clicks persist only in this browser's local storage. Export requires a
self-asserted reviewer identity. These decisions are not authenticated,
append-only, shared, signed, or a durable audit trail; exported review data must
not be treated as an authoritative clinical or regulatory record.
