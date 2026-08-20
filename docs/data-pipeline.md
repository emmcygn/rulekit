# The data pipeline

How a corpus of realistic-looking patients gets made, and why each stage
exists. Four scripts, run in order:

```
data/synthea/                 corpus/patients/     corpus/messy/      corpus/normalized/
FHIR R4 bundles  ──fetch──▶   ──flatten──▶         ──mess──▶          ──normalize──▶
(1,180 patients)              100 PatientFacts     corrupted          engine-ready
```

```bash
npm run corpus:build     # all four, in order
# or individually:
npm run corpus:fetch     # scripts/fetch-synthea.ts
npm run corpus:flatten   # scripts/flatten-synthea.ts
npm run corpus:mess      # scripts/mess-injector.ts   --seed 42
npm run corpus:normalize # scripts/normalize.ts
```

Every stage is a thin CLI over a pure, unit-tested function in `scripts/lib/`.
Nothing in the pipeline calls `Date.now()` or `Math.random()`: the reference
date is pinned at **2026-06-30** and every random draw is seeded, so the whole
corpus is reproducible byte-for-byte from a seed. A fixture you cannot
regenerate is not a fixture.

**Not medical software.** The corpus is synthetic and deliberately corrupted.
Nothing here is for clinical, feasibility, or research screening use.

---

## Stage 0 — fetch

`scripts/fetch-synthea.ts` downloads the pre-generated
[Synthea](https://synthetichealth.github.io/synthea-sample-data/) FHIR R4
sample bundles (Apache-2.0, ~85 MB zipped, 1,180 patients) and unzips them into
a git-ignored `data/synthea/`. No Java, no Synthea run. Idempotent — re-running
it does nothing unless you pass `--force`.

Synthea is *format*-accurate: FHIR R4 / US Core, the shape an EHR API extract
arrives in under the ONC Cures Act rule. It is not *content*-realistic, which
is what stage 2 is for.

## Stage 1 — flatten

`scripts/flatten-synthea.ts` turns a Bundle into `PatientFacts`. Per patient:

| Fact | From |
|---|---|
| `age` | `Patient.birthDate` vs. the reference date |
| `sex` | `Patient.gender` |
| `conditions` | `Condition.code` (SNOMED) + `daysAgo` from onset |
| `medications` | `MedicationRequest` (RxNorm), most recent request per drug, active or within 365 days |
| `lab_<slug>` | latest `Observation` per LOINC in `scripts/lib/loinc.ts` |
| `lab_<slug>_unit` | the unit as recorded |
| `lab_<slug>_code` | the lab code as recorded |
| `lab_<slug>_days_ago` | recency of that result |

**Why units and codes are separate facts.** The engine's fact model wants a
number. But the mess stage has to be able to drop a unit, and the normalize
stage has to be able to repair one, and neither can happen if the unit is
implicit. Splitting them makes ingestion legible: you can read a patient file
and see exactly what the source system said.

**Two shaping decisions, both deliberate:**

1. **Fixed reference date.** Ages and recencies are computed against
   2026-06-30, never the wall clock.
2. **Timeline shift.** The Synthea sample set stops in September 2019. Aged
   against 2026, every medication would be ~2,500 days old and every
   `anyWithin` criterion would be dead across the whole corpus. So each
   patient's *own* latest recorded event is treated as "roughly now": recency
   is measured back from that anchor plus a deterministic 0–45 day jitter, and
   age is computed at that same shifted instant so the two stay consistent.
   This is fixture shaping, not a claim about the source data.

**Selection and mutation.** Synthea skews primary-care, so of the 100 patients
emitted, 40 are every patient carrying a heart-failure SNOMED code (in filename
order) and 60 are the oldest remaining patients. The HF subset is then
gap-filled with the protocol facts COMMANDER HF screens on and Synthea cannot
produce — `hf_symptom_duration_months`, `hf_index_event_days_ago`,
`index_hospital_days`, plus occasional stroke / atrial-fibrillation codes and
anticoagulant prescriptions. Rates and the exact list are in the `mutateForHf`
doc comment.

Worth knowing: Synthea's own heart-failure module *does* emit LVEF (LOINC
10230-1) and NT-proBNP (33762-6), and all 40 HF patients already carry both, so
the mutation's LVEF and peptide fallbacks never fire on this corpus. They stay
in the code for a different Synthea release. No existing fact is ever
overwritten.

## Stage 2 — mess

`scripts/mess-injector.ts` corrupts the clean corpus the way a real extract
arrives. Seeded per `(seed, patient)` with mulberry32, so a patient's
corruption never depends on how many patients ran before it.

| Corruption | What it does | On the 100-patient corpus |
|---|---|---|
| `drop-unit` | deletes the unit fact | 489 |
| `sloppy-unit` | rewrites the unit into a non-UCUM spelling (`mg/dl`, `MMHG`, `centimeters`) | 413 |
| `convert-unit` | reports the value in another unit (creatinine in µmol/L, LVEF as a fraction) | 34 |
| `local-code` | replaces LOINC with a site-local lab code and renames the fact to match | 326 |
| `stringify-value` | `1.24` becomes `">1.24"`, `"cancelled"`, `"hemolyzed"` | 151 |
| `duplicate-med` | duplicate prescription rows, as when two source systems are joined | 38 |
| `backdate` | pushes result timestamps and condition onsets further into the past | 340 |

Each messy file lists its own corruptions in a comment header, so the
clean/messy diff is readable in review.

Two corruptions are **deliberately irreversible**: a stringified value, and the
local code `XLAB-77`, which the mapping table refuses to resolve. They exist so
the quarantine path is exercised on real corpus data rather than only in unit
tests.

## Stage 3 — normalize

`scripts/normalize.ts` is the cleaning half of ingestion. Per lab, in order:

1. **Resolve the code** — LOINC as-is, or a site-local code via
   `scripts/mappings/local-to-loinc.yaml` — and rename the fact to the
   canonical slug.
2. **Normalize the unit** to the UCUM spelling declared in
   `scripts/lib/loinc.ts`, converting the value only where the conversion is
   scoped to *that analyte* in `scripts/mappings/units.yaml`.
3. **Quarantine** anything left untrustworthy.
4. **Collapse duplicate rows** in `medications` and `conditions`.

| Repair | On the 100-patient corpus |
|---|---|
| `unit-alias` | 403 |
| `assumed-unit` | 477 |
| `converted` | 82 |
| `mapped-code` | 286 |
| `deduplicated` | 38 |
| `quarantined-value` | 149 |
| `unresolvable-code` | 40 |

**The governing rule: never guess a number.** An unresolvable code, an
unrecognised unit and a non-numeric value all end the same way — the fact is
omitted and preserved as `<fact>_raw`. The evaluator then sees a missing fact
and returns `unknown`, which is the honest answer, instead of a fabricated pass
or fail. 94 of 100 patients carry at least one quarantined fact.

Unit conversions are **scoped to the analyte**, never applied blanket. µmol/L →
mg/dL uses creatinine's molar mass; applying it to a glucose result would
silently produce a wrong number that looks perfectly plausible. Glucose in
µmol/L is quarantined instead.

**The one assumption the stage makes, stated out loud:** a lab whose unit was
dropped but whose code resolved is given that LOINC's conventional unit, and
the substitution is logged per patient in the file header. It is the only place
the pipeline supplies information the extract did not.

### Deviation from the design spec: offline mappings

The design spec (§10) resolves codes and units through the free NLM
terminology APIs. This build resolves them from two committed YAML tables in
`scripts/mappings/` instead. Reasons, in order of weight:

1. CI must not fail because a remote vocabulary service is down.
2. A fixture whose contents drift when an external service updates is not a
   fixture.
3. The corpus is 21 lab concepts; a terminology server is not yet earning its
   keep.

The table shape matches what an API lookup would return, so swapping in a live
resolver is a change to `scripts/lib/normalize.ts` alone.

---

## One patient, three stages

`SYN-239470E9`, four of its labs. Full files in `corpus/patients/`,
`corpus/messy/`, `corpus/normalized/`.

**Clean** — flattened straight from FHIR:

```yaml
lab_creatinine: 0.69
lab_creatinine_unit: mg/dL
lab_creatinine_code: 38483-4
lab_creatinine_days_ago: 246
lab_bun: 7.16
lab_bun_unit: mg/dL
lab_bun_code: 6299-2
lab_hba1c: 6.08
lab_hba1c_unit: "%"
lab_hdl: 64.43
lab_hdl_unit: mg/dL
lab_hdl_code: 2085-9
```

**Messy** — after `--seed 42`:

```yaml
lab_creatinine: 61            # convert-unit: mg/dL -> umol/L
lab_creatinine_unit: umol/L
lab_bun: ">7.16"              # stringify-value
lab_bun_unit: mg/dL
lab_hba1c: 6.08               # drop-unit: the "%" is gone
lab_hdl_c: 64.43              # local-code: hdl -> HDL-C, fact renamed
lab_hdl_c_unit: mg/dL
lab_hdl_c_code: HDL-C
```

**Normalized** — after the cleaning stage:

```yaml
lab_creatinine: 0.69          # converted back, x0.0113123
lab_creatinine_unit: mg/dL
lab_bun_code: 6299-2          # value quarantined:
lab_bun_days_ago: 246
lab_bun_raw: ">7.16 mg/dL"    #   the engine will see BUN as unknown
lab_hba1c: 6.08
lab_hba1c_unit: "%"           # assumed from LOINC 4548-4, logged
lab_hdl: 64.43                # mapped back: HDL-C -> LOINC 2085-9
lab_hdl_unit: mg/dL
lab_hdl_code: 2085-9
```

Creatinine round-trips exactly. BUN does not come back — and that is the
correct outcome, not a failure: `">7.16"` is a censored result, and inventing
`7.16` from it would be the pipeline lying to the evaluator.

A unit test asserts this round trip over 40 synthetic patients: with the two
deliberately-lossy corruptions disabled, normalizing a messed patient must
reproduce the clean one exactly.

---

## Quantitative anchors

### Chia coverage — done

`npm run chia:coverage` classifies all 12,060 criterion lines in the Chia
corpus against the closed condition language. Result and full method in
[docs/chia-coverage.md](chia-coverage.md). The classification is heuristic and
the report says so above the fold.

### CONSORT sanity check — not run, and why

The design spec asks for a comparison of the predicted screen-fail reason
distribution against a published CONSORT flow diagram. It is **not** in this
branch, for two reasons, neither of which is "we ran out of time":

1. **The evaluator lives in another branch.** Predicting a screen-fail
   distribution means running the rule set over the corpus, which this branch
   cannot yet do.
2. **COMMANDER HF does not publish the numbers.** The ClinicalTrials.gov
   results section carries no recruitment details and no pre-randomisation
   screen-failure breakdown — only that 5,081 were enrolled and 5,022 entered
   the ITT set. The NEJM report's flow diagram does not give per-criterion
   screen-fail counts either. Without a published reason distribution there is
   nothing to compare a prediction against.

The honest options are to pick a different anchor trial that *does* publish a
per-reason CONSORT breakdown, or to drop the check. That choice belongs with
whoever integrates the engine and the corpus, so it is flagged here rather than
decided here. Whatever lands must keep the spec's framing: shape agreement
against a synthetic corpus, explicitly not validation.
