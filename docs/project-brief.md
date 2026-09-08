# RuleKit: project brief

RuleKit is a software prototype for inspecting clinical-trial eligibility logic. It keeps protocol wording beside a versioned interpretation, tests rule behavior, and explains how a change affects a supplied synthetic cohort.

The immediate objective is to find clinical operations and trial-management collaborators who can help choose one worthwhile workflow and test whether this approach improves review. This repository is an engineering artifact and a starting point for discovery, not evidence of an established clinical product or business.

## What has been built

- A TypeScript engine with three-valued logic, explicit missing-evidence behavior, scoped contradiction checks, criterion traces, firing coverage, and behavioral version comparison.
- An independently documented YAML format and JSON Schemas, with authored tests and adversarial cases.
- A CLI and React workbench that use the same core implementation.
- A proposal pipeline that keeps extracted facts linked to source quotes and requires review before narrative proposals reach evaluation.
- Two trial packs and reproducible synthetic data, including deliberately partial and unmodeled criteria.

For a technical assessment, start with [development and architecture](development.md), then the [format](../FORMAT.md), [adversarial tests](../tests/adversarial), and [review integrity tests](../web/tests/review-integrity.test.tsx).

## Product hypothesis

A plausible first use is helping a protocol reviewer inspect eligibility changes and their interpretations before operational use. Keeping wording, rules, tests, and version effects together may make disagreements easier to locate and resolve.

That is a hypothesis. Synthetic cohort counts do not establish recruitment potential, clinical accuracy, time savings, willingness to pay, or reduced amendment costs. The repository does not establish active customers, institutional partnerships, clinical validation, or market exclusivity.

## Proposed milestones

| Milestone | Concrete output | Evidence needed to move forward |
| --- | --- | --- |
| Understand one workflow | A short description of the trigger, reviewer, inputs, current process, and desired output | Clinical operations collaborators agree that the problem is real and sufficiently specific |
| Review a public protocol translation | Criterion-by-criterion assumptions, disagreements, and synthetic boundary cases | Reviewers can distinguish faithful translations, partial interpretations, and unmodeled criteria |
| Test usefulness on a bounded task | A comparison with the current process using public/synthetic material | Recorded review time, errors or missed qualifiers, disagreements, and source-tracing success; publish negative findings too |
| Specify the next product increment | Prioritized requirements for evidence handling, review, and integration | A demonstrated workflow benefit justifies the additional engineering |
| Consider a governed data study | A separately scoped study and validation plan | Appropriate partners, permissions, data controls, review accountability, and agreed evaluation criteria |

These are proposed decision points, not completed milestones or promised dates.

## Design decisions worth inspecting

**Missing evidence stays visible.** A missing or quarantined value can produce `unknown`; it is not silently treated as a negative history. A known-empty code list has different semantics from an absent fact. That distinction depends on correct input preparation.

**Protocol interpretation is explicit.** A criterion carries the original wording, reference, and executable expression. When the language cannot represent the criterion, it remains in the pack as unmodeled text. The real-trial example exposes those gaps rather than dropping the criteria.

**The model's role is limited.** Extraction produces proposed facts with evidence. The recorded evaluation measures a small authored fixture set. Confidence values order review; they do not authorize automatic confirmation or measure clinical reliability.

**One engine supports two interfaces.** The CLI and browser share the evaluation code. The format is specified separately so its semantics can be reviewed without depending on the UI.

## The next collaborators

Clinical operations and trial-management experience is the immediate need: choose the workflow, challenge assumptions, and define useful evidence. Engineers can help turn those findings into tested changes. Medtech teams and investors can help challenge the adoption path once a workflow benefit has been demonstrated.

See the [collaboration brief](clinical-collaboration.md) for a low-commitment first conversation and contact route.
