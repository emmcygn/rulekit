# Share-readiness review

Reviewed locally on **9 September 2026**, starting from commit `2076a86`, on
branch `chore/share-ready`. This is a review of a synthetic-data prototype for
collaborator outreach, not a clinical validation or production security assessment.

## What changed

- A shorter README with routes for clinical collaborators, engineers, investors,
  and hiring managers; a concrete collaboration brief and LinkedIn draft.
- Clear separation between implemented behavior, synthetic fixture measurements,
  untested product hypotheses, and clinical-use limitations.
- Corrected public links and unsupported novelty/market claims in the tours.
- Pinned Node toolchain, Windows-compatible CLI checks and temporary paths,
  and LF checkout rules that preserve recorded hashes across operating systems.
- Reproducible component CI, a runnable browser smoke check, and corrected narrow-phone copy.
- Contribution/security guidance, issue forms, credential/output ignores, and
  the full license notice for the vendored Three.js assets.
- Compatible dependency patches and an explicit account of remaining development-tool advisories.

## Verification evidence

Local environment: Windows, Node 22.22.2, npm 10.9.0, installed Google Chrome.

| Check | Result |
| --- | --- |
| Root lint and both TypeScript projects | Passed |
| Root unit/integration suite | 548 tests passed in 40 files |
| Workbench suite and production build | 170 tests passed; build passed |
| Standalone review component | 38 tests passed; build passed |
| Walkthrough unit/copy suite and build | 232 tests passed; build passed |
| Walkthrough browser smoke | All 11 chapters, no page errors, narrow-phone cards fit; resize movement stayed within the existing tolerance |
| Shipped trial-pack checks/tests | Demo 13/13 and COMMANDER HF 19/19 cases passed, with expected scope/unmodeled findings |
| Facts checks and standalone evaluation | 10 files valid; 57 true positives, 1 false positive, 1 false negative against the authored fixture |
| Recorded promptfoo evaluation | 10/10 cases passed, no live model calls |
| Synthetic corpus screening | 100 evaluated: 0 eligible, 97 ineligible, 3 undetermined; JSON/report exports generated successfully |
| Documentation links and whitespace | Checked local Markdown targets resolve; diff check passed |

A bounded scan of common credential-token patterns across 150 reachable commits
found no candidate paths. This does not establish that the history contains no
sensitive material or that every kind of secret has been detected.

## Remaining boundaries

- **Five high-severity package findings remain in optional development dependencies.**
  Root production dependencies and the workbench audit report zero. Details and
  exposure boundaries are in the [dependency review](dependency-audit.md).
- **Promptfoo is not network-isolated.** Its supported opt-outs are enabled, but
  its upstream implementation can still send an opt-out notice. Use
  `npm run facts:eval` for the standalone local evaluation.
- **Docker build was not run:** Docker Desktop's engine was unavailable. The
  package builds and deployment-configuration tests passed. A container build
  and hosted-route check remain necessary before claiming deployment verification.
- **Remote CI was pending at the time of this local review.** The updated workflow
  adds Windows alongside Linux. See [PR #15](https://github.com/emmcygn/rulekit/pull/15)
  for the subsequent merge status and checks, and [GitHub Actions](https://github.com/emmcygn/rulekit/actions)
  for current CI results.
- **Publication was pending at the time of this local review.** The repository
  was private when inspected; this records the preparation, not its current
  visibility. Check the [repository](https://github.com/emmcygn/rulekit) while
  signed out before posting to LinkedIn. No LinkedIn post or visibility change
  was made during this local preparation.

## Suggested public positioning

An inspectable, runnable prototype for making trial eligibility interpretations
reviewable and testable, seeking clinical operations and trial-management
collaborators to choose and evaluate one useful workflow.

Start with [the collaboration brief](clinical-collaboration.md) and
[the LinkedIn draft](linkedin-post.md).
