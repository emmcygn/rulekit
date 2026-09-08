# Third-party notices and data sources

rulekit's [Apache-2.0 license](LICENSE) is unchanged. This file records the
vendored assets and demo data sources; packages installed by npm retain their
own licenses in their distributions and lockfile metadata.

## Vendored Three.js

`deploy/assets/three.core.min.js` and `deploy/assets/three.module.min.js` are
Three.js r180 (0.180.0), copyright 2010-2025 Three.js authors, under the MIT
license. Their existing headers are retained. The full
[license text](deploy/assets/LICENSE.three.txt) is stored beside the assets
and is included by the Docker image's `COPY deploy/assets` instruction.

Source: [Three.js r180](https://github.com/mrdoob/three.js/tree/r180),
[upstream license](https://github.com/mrdoob/three.js/blob/r180/LICENSE).
The walkthrough's npm dependency is separately recorded in
`docs/clinic/package-lock.json`.

## Synthetic patient fixtures

`corpus/patients/`, `corpus/messy/` and `corpus/normalized/` are derived from
the September 2019 Synthea FHIR R4 sample archive. The
[data pipeline guide](docs/data-pipeline.md) records selection, timeline
shifting, added heart-failure facts and deliberate corruption. The raw
download is kept outside git in `data/synthea/`.

Synthea is copyright The MITRE Corporation and is distributed under
[Apache-2.0](https://github.com/synthetichealth/synthea/blob/master/LICENSE).
See the [sample source](https://synthetichealth.github.io/synthea-sample-data/)
and [upstream notices](https://github.com/synthetichealth/synthea/blob/master/NOTICE),
including attribution for RxNorm, LOINC and SNOMED CT terminology. This
project's license does not replace those terminology sources' terms.

The ten narrative notes in `corpus/notes/` are hand-written fictional
examples. Their provenance and matching fixture contract are documented in
[corpus/notes/README.md](corpus/notes/README.md).

## Chia eligibility criteria

The Chia dataset, by Kury et al., *Scientific Data* (2020), is available under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The download script
uses the [bigbio/chia mirror](https://huggingface.co/datasets/bigbio/chia);
the [upstream project](https://github.com/WengLab-InformaticsResearch/CHIA)
identifies the dataset. Raw downloads stay in the ignored `data/chia/` folder.

[docs/chia-coverage.md](docs/chia-coverage.md) contains a generated heuristic
analysis and selected excerpts, some truncated as indicated with ellipses.
The classification and report are rulekit's additions, not validation by the
dataset authors.

## ClinicalTrials.gov criteria

The COMMANDER HF rule set quotes sponsor-submitted eligibility text from
[NCT01877915](https://clinicaltrials.gov/study/NCT01877915), retrieved on
2026-08-21. Its [ruleset](rules/trials/commander-hf/ruleset.yaml) retains the
registry link, criterion positions and original wording; its modeling file
records partial translations. The rule translation is a demonstration, and
does not imply endorsement by the sponsor or registry.
