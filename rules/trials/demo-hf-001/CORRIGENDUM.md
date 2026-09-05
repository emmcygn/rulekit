# DEMO-HF-001 artifact history

`ruleset@1.0.0.yaml` is retained byte-for-byte as originally published. Its
`egfr-min` executable unit says `mL/min`, while the verbatim criterion and fact
model use `mL/min/1.73m2`. Current validation therefore rejects that historical
artifact with `unit-mismatch`; do not edit it or use it for evaluation.

`ruleset@1.0.1.yaml` is the corrigendum. It corrects the executable eGFR unit
to `mL/min/1.73m2` and identifies the lifecycle as a synthetic demonstration.
Diffs and demonstrations that need a valid pre-amendment baseline must use
`1.0.1`. The current `ruleset.yaml` is version `1.2.0`.

Artifact versions are immutable byte sequences. Correct an error by publishing
a new version plus a migration note; never replace bytes under an existing
version identifier.
