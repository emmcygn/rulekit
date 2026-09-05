# evals — the extraction eval harness

Ground truth exists by construction: we authored every note in `corpus/notes/`,
so every fact each one states is known exactly. This is a deterministic
regression fixture, not clinical validation: it contains only **10 synthetic
notes and 58 expected facts**, all author-created. Its point metrics do not
support confidence intervals, statistical confidence, representativeness, or
subgroup claims. This limitation is also machine-readable in
`expected-facts.yaml` and printed by `facts eval`.

Two harnesses, on purpose:

| | what it answers | CI gate |
|---|---|---|
| `npm run eval` (promptfoo) | per-case: did this note extract correctly, and what exactly went wrong? Model × prompt matrix. | yes — exits 100 on any regression |
| `npm run facts:eval` | corpus-level: precision, recall, grounding pass rate, confidence calibration. | yes — `--min-precision 0.95 --min-recall 0.95` |

## Running it offline (the default)

```bash
npm run eval          # == npm run build && promptfoo eval -c evals/promptfooconfig.yaml
```

**No API key. No network. No cost.** `evals/providers/recorded.js` serves the
committed responses in `evals/recorded/` — one per note, produced by the pinned
model against the pinned prompt. Before serving a response, the provider checks
its model, prompt version and rendered hash, output-schema version and hash,
inference settings, and full rendered-request hash. A changed note, fact model,
prompt, schema, model, or setting therefore fails before scoring. It is a
fixture, not a cache: it never falls
back to a live call, and a note without a recording fails the run loudly rather
than quietly reaching for the network.

Everything else in the harness is production code. `evals/prompt.js` renders the
same `prompts/extract-facts.v1.md` through the same renderer the pipeline uses,
and `evals/assertions/grounded.js` calls the real `groundProposedFacts()` from
`dist/`. An eval that re-implements the thing it is testing measures a different
program, so this one imports it.

`npm run build` must run first — promptfoo executes plain JS and imports the
built pipeline from `dist/`. The `eval` npm script does both.

## Running it live (maintainers, with a key)

```bash
export ANTHROPIC_API_KEY=...      # or: ant auth login
npm run build
npx promptfoo eval -c evals/promptfooconfig.live.yaml
```

`evals/providers/live.js` is the only module in the repo that constructs an
Anthropic client, and it does so lazily inside `callApi`, so importing the
harness never touches credentials. It calls the production `buildRequest()`, so
a live run and an offline run differ only in where the response comes from — the
model id, the prompt, and the structured-output schema are the same objects.

To sweep a model matrix, uncomment the second provider block in
`promptfooconfig.live.yaml`. Each provider gets the same prompt and the same
assertions.

## Re-recording

```bash
export ANTHROPIC_API_KEY=...
npm run recordings:record                            # every note in one provider batch
npx tsx scripts/record-responses.ts echo-2026-03-12  # one selected note
npx tsx scripts/record-responses.ts --resume msgbatch_x
```

This is the only script in the repo that makes API calls, and nothing runs it
automatically. It submits the selected notes through the Message Batches API,
polls to completion, reconciles out-of-order results by document id, and refuses
to write partial, duplicate, unknown, failed, or malformed results. `--resume`
continues polling a known batch after an interrupted local process.

Fresh recordings preserve batch wall latency and the provider's complete usage
object, including input, output, cache-create, cache-read, and thinking-token
counts. `facts eval` aggregates these values. It deliberately does not estimate
dollar cost without a versioned provider price schedule.

Re-recording is deliberate: the recorded responses are a control point, and
their diff is what a reviewer reads when the prompt or the model changes. Expect
the `knownGap` entries in `expected-facts.yaml` to need revisiting afterwards —
they describe specific mistakes in the *old* recording.

### Migrating the legacy recording envelope (offline)

```bash
npm run recordings:migrate
```

This makes no API call. It accepts only legacy files whose declared prompt and
model already match the current ids, then binds their existing output to the
current rendered request. That is an explicit maintainer attestation for known
historical fixtures, not a substitute for re-recording after any control-point
change. Migrated files say `capture.mode: legacy-migration` and keep metrics
`null`; the eval reports them as unavailable rather than fabricating values.

## The four control points

All in git, all versioned together (design spec §11). A change to any of them
that fails the eval fails CI — the same gate a rule change gets, which is FDA
credibility-assessment vocabulary implemented as a GitHub Action.

| control point | file |
|---|---|
| the prompt | `prompts/extract-facts.v1.md` — a file, never an inline string |
| the schema | `ProposedFactsSchema` in `src/extract/pipeline.ts` |
| the model id | `EXTRACTION_MODEL` in `src/extract/pipeline.ts` |
| the recorded responses | `evals/recorded/*.json` — versioned envelope with request/prompt/schema hashes, inference settings, and capture metrics |

## Files

```
expected-facts.yaml      ground truth — the single source, read by both harnesses
tests.js                 generates promptfoo cases from expected-facts.yaml
prompt.js                renders prompts/extract-facts.v1.md
lib.js                   shared loader for the built pipeline
providers/recorded.js    offline: serves evals/recorded/
providers/live.js        live: calls buildRequest() through the real SDK
assertions/grounded.js   the real grounding gate + exact-fact matcher
recorded/*.json          one committed response per note
promptfooconfig.yaml     offline config (the default)
promptfooconfig.live.yaml  live config
```

## What the assertion actually checks

Not that a string appears. For each case it runs the model's output through the
grounding gate and then compares what survives against the authored ground
truth:

- structured outputs held (`is-json`, plus schema validation in `parseResponse`);
- every surviving fact cites a quote that resolves verbatim in its note and a
  value that parses to the declared type and unit;
- the surviving set equals the expected set.

**A correct rejection is a pass, not a failure.** `echo-2026-01-22` states no
single ejection fraction, so the gate killing `40-45` is the right answer and
the case scores 1.0. Same for the fabricated quote on `echo-2026-07-21`.

## Known gaps in the baseline

A permanently-red eval teaches a team to ignore the eval; a baseline forced to
100% teaches it nothing. So the two misses in the committed recording are
declared in `expected-facts.yaml` under `knownGap`, with the reason written out,
and the assertion allows exactly that many and no more. A new error still fails.

| case | gap | why it is kept |
|---|---|---|
| `clinic-2026-02-04` | 1 false positive | The model infers `on_sglt2_inhibitor: false` from a reconciled med list that does not mention one. Grounded, plausible, and not stated. No gate can catch a judgement call — this is the class of error the *review pane* exists for, and it arrives at 0.62 confidence, near the top of the queue. |
| `echo-2026-06-01` | 1 false negative | The LVEF is read correctly as 55 but the unit is spelled `percent`, not the declared `%`. The gate rejects it, so a right answer never reaches the file. This is the price of exact unit matching, and it is the number to look at before anyone argues for loosening the gate. The fix belongs at ingest (UCUM normalization), not here. |

## Case coverage

Straight extractions, plus the adversarial classes from spec §11:

| case | class |
|---|---|
| `echo-2026-01-22` | range value — "EF visually estimated at 40-45%" |
| `clinic-2026-04-02` | negation — "no anticoagulant use since the GI bleed" |
| `clinic-2026-07-09` | discussed but not prescribed |
| `clinic-2026-08-05` | history vs. current |
| `echo-2026-07-21` | ambiguous class, plus a fabricated quote in the recording |
| `clinic-2026-05-16` | within-class medication switch |
