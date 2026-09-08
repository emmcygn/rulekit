# Development and architecture

## Prerequisites

- Git, npm, and **Node 22.22.2**, pinned in [`.nvmrc`](../.nvmrc). CI uses this file. The package engine ranges also allow compatible newer releases; Node 20 and early Node 22 do not satisfy this checkout's locked toolchain.
- A modern browser for the workbench. Google Chrome is required for the optional automated walkthrough smoke check.
- No model API key is needed for the normal demo or recorded evaluations.

Commands below run from the repository root. They work in Bash and PowerShell; use `npm.cmd` if PowerShell blocks `npm.ps1`. Check `node --version` before installing. After changing Node versions, rerun `npm ci` so platform-specific optional dependencies are installed with the supported runtime.

The repository enforces LF line endings through `.gitattributes`: recorded prompt hashes and the historical rule artifact depend on exact bytes. Do not re-record fixtures to work around a line-ending mismatch.

## Install and run

```sh
npm ci
npm --prefix web ci
npm --prefix web run dev
```

Open [localhost:5173](http://localhost:5173). Install root dependencies first: the workbench typechecks and bundles the shared engine outside its own directory. Each package has its own lockfile; this is not an npm workspace.

For a production build preview:

```sh
npm --prefix web run build
npm --prefix web run preview
```

Vite prints the preview URL. The workbench includes one synthetic protocol and ten patients at build time. There is no backend, login, patient upload, or write-through to repository files. Review choices live in browser local storage.

## Verification

For engine, schema, CLI, normalization, or extraction changes:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run dogfood
npm run facts:check
npm run facts:eval
npm run eval
```

`dogfood` checks and tests the two currently shipped packs. If you add another pack, extend that script to include it. `facts:eval` enforces precision and recall floors against authored synthetic fixtures. `eval` runs the separate promptfoo regression harness using committed recordings; its provider makes no live model call. See [the evaluation guide](../evals/README.md) for interpretation and optional live extraction.

For workbench changes:

```sh
npm --prefix web test
npm --prefix web run build
```

The build includes TypeScript checks. The tests cover amendment behavior, funnel and threshold calculations, review persistence/integrity, and app interactions; they are not a real-record validation study.

For the standalone review component:

```sh
npm --prefix web-components/review-pane ci
npm --prefix web-components/review-pane test
npm --prefix web-components/review-pane run build
```

The workbench currently maintains copies of the component files, guarded by a parity test. Follow [the component README](../web-components/review-pane/README.md) when editing them.

## Optional narrative walkthrough

The three.js walkthrough is a separate package. The plain-language source is [`docs/plain.html`](plain.html); the build copies it into the walkthrough's output.

```sh
npm --prefix docs/clinic ci
npm --prefix docs/clinic run dev
```

The dev command syncs the reading page first. To check the built walkthrough:

```sh
npm --prefix docs/clinic run verify
```

`verify` builds, runs unit/copy/budget tests, and launches a real Chrome session for desktop, narrow-phone, and resize checks. `puppeteer-core` is a locked dev dependency; it does not download Chrome. A standard Chrome installation is discovered automatically. Set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome executable for a custom location. The smoke script starts and stops its own local server on port 4173; set `PORT` if that port is occupied.

Without Chrome, the build and unit/copy checks are still available, but they do not replace the browser smoke check:

```sh
npm --prefix docs/clinic run build
npm --prefix docs/clinic test
```

Build before testing: the gzip budget check reads the generated bundle. CI runs the build and unit/copy checks; browser smoke is a local gate. See [the walkthrough README](clinic/README.md) for the rendering and route contracts.

## Architecture and ownership

| Area | Responsibility |
| --- | --- |
| [`FORMAT.md`](../FORMAT.md), [`schema/`](../schema) | Public format semantics and JSON Schemas |
| [`src/core/`](../src/core) | Browser-safe parsing, evaluation, three-valued logic, lint, conflicts, tests, diff, and attrition |
| [`src/cli/`](../src/cli), [`src/cli-facts/`](../src/cli-facts) | Filesystem/command wrappers around rules and facts checks |
| [`src/extract/`](../src/extract) | Proposal schemas, source grounding, recorded extraction, confirmed-fact compilation, evaluation |
| [`rules/trials/`](../rules/trials), [`packs/trials/`](../packs/trials) | Trial interpretations and their typed fact vocabulary |
| [`web/src/`](../web/src) | React workbench, Monaco editor, workers, and browser review state |
| [`scripts/`](../scripts) | Synthetic-data acquisition, flattening, corruption, normalization, and coverage analysis |
| [`evals/`](../evals) | Versioned synthetic extraction fixtures and promptfoo harness |
| [`deploy/`](../deploy), [`Dockerfile`](../Dockerfile) | Static site assembly and serving |

The core does not depend on Node APIs. CLI wrappers load files; the workbench bundles the fixtures and calls the same engine. Changing YAML in the browser updates browser state. It does not modify the source files on disk.

The extraction path is separate: a proposal names a typed fact and a source quote; grounding validates the proposal against the fact model and cited note; human review decides whether a narrative proposal can become an engine input. Structured pipeline facts have a separate trusted-input path. An evaluation trace names facts and criteria; full narrative evidence stays in the upstream facts file.

Review UI persistence is generic demo state, not an authenticated or append-only record. Do not build integrations that treat a browser export as an authoritative clinical record.

## Data and reproduction

The committed synthetic datasets are enough to run the demo. Downloading source archives is optional. [The data-pipeline guide](data-pipeline.md) documents the Synthea pipeline; [the CHIA guide](chia-coverage.md) explains the exploratory classifier and its limits. Rebuilding downloaded data may depend on upstream archive availability; committed outputs are the default reproducible fixture inputs.

Optional live extraction requires external provider credentials and can incur costs. Keep credentials outside Git and use synthetic notes only. Installing dependencies and optional tooling may contact package registries; a recorded provider being offline does not imply all development tools have no network behavior.

## Deployment

The existing Dockerfile builds a static site with the landing page at `/`, workbench at `/app/`, walkthrough at `/walkthrough/`, and reading version at `/plain/`. It uses `deploy/serve.json` for redirects, caching, and the reading-page rewrite. A catch-all SPA rewrite would break these routes.

With Docker installed:

```sh
docker build -t rulekit-demo .
docker run --rm -p 8080:8080 rulekit-demo
```

Open [localhost:8080](http://localhost:8080). These are local preview commands, not a publication step. The Docker build requires registry access. A hosted demo's URL, access, and external links should be checked separately before sharing.

## Dependency maintenance

Read the [dependency review](dependency-audit.md) before updating the eval tools
or removing the scoped Monaco/DOMPurify override. It records audit results,
remaining optional development dependencies, and promptfoo's network behavior.
