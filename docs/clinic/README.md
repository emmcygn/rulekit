# rulekit — the research clinic

A scroll-driven three.js staging of `../plain.html`. Same story, same words; the
2D page stays the canonical reading version and is served here at `/plain`.

## Run it

Use Node 22.22.2 from the repository's `.nvmrc`. Run these commands from
`docs/clinic`:

    npm ci
    npm run dev        # syncs the reading page, then serves http://localhost:5173
    npm test           # unit tests, scene budgets, and the copy-parity check
    npm run build      # syncs plain.html into public/, then builds to dist/
    npm start          # serves the standalone dist/ at http://localhost:3000

Add `?hud=1` for the performance HUD or `?ch=N` to jump to a chapter.

## Before you merge: `npm run verify`

    npm run verify     # build, then the full test run, then the runtime smoke test

**This is the gate, and the order is the point.** `npm test` on its own is not
enough: the 250KB gzip check in `tests/budget.test.js` reads `dist/assets/` and
*skips itself in silence* when there is no `dist/`, so a green test run on a
clean checkout has quietly proved nothing about bundle size. `verify` builds
first so the bundle exists, then runs the tests against it, then drives it in
a real browser (`npm run smoke`, which serves `dist/` itself on port 4173 — set
`PORT` to move it). The smoke pass also re-measures every panel at 380x780 and
fails if a card's copy no longer fits inside it.

`npm ci` installs the locked `puppeteer-core` dependency without downloading a
browser. Smoke discovers a standard Google Chrome installation on Windows,
macOS, or Linux. Set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome or
Chromium executable for a custom location. The smoke script starts its server
through Node and stops it when the run ends; it does not need a shell-specific
executable wrapper.

CI runs the build and unit/copy/budget tests. The browser smoke check remains a
local pre-merge gate, so run `npm run verify` before sharing walkthrough changes.

## Rules that matter

- `../plain.html` is never edited from here. `scripts/sync-plain.mjs` copies it into
  `public/` and appends one back-link block to the copy.
- Panel prose is transplanted verbatim. `npm run parity` fails the build if a
  sentence drifts or a claims-discipline label goes missing.
- Budgets: 300 draw calls, 500k triangles, and 250 KiB (256,000 bytes) of gzipped
  JavaScript. `tests/budget.test.js` enforces all three when a build exists.
- New scene? Follow the module contract in `src/core/sceneManager.js`, declare a
  `budget`, instance anything plural, and author a portrait camera variant in
  `src/core/cameraKeys.js`.

## Query flags

| flag | effect |
|---|---|
| `?hud=1` | draw-call / triangle / fps HUD (always on in dev) |
| `?ch=N` | jump straight to chapter N (0-10) |
| `?tier=low` | force a quality tier, for throttled testing |
| `?debug=1` | draw the camera spline and station markers |

## Deploy — one page of the one rulekit service

Static only, and no service of its own any more. The repo root's `Dockerfile`
builds this project alongside the workbench and assembles a single served tree:

| path | source |
|---|---|
| `/` | `deploy/landing.html` |
| `/app` | `web/dist` |
| `/walkthrough` | `docs/clinic/dist` — this project |
| `/plain` | `docs/clinic/dist/plain.html` |

Two consequences worth holding on to:

- **`base: './'` in `vite.config.js` is what makes `/walkthrough` work.** The
  built `index.html` asks for `./assets/…`, which resolves under any mount point;
  an absolute base would hard-code `/assets/…` and 404 every file.
- **`/plain` is lifted out of `dist/`, never copied from `../plain.html`.** Only
  the dist copy carries the injected back-link. Taking the source directly would
  ship the essay with no way back to the 3D version.

That back-link points at `/walkthrough`, not `/`, because `/` is the landing page
here. `scripts/sync-plain.mjs` owns the string and `tests/syncPlain.test.js` pins
it, so the two cannot drift apart silently.

### The `/plain` contract — do not break this

`src/main.js` redirects visitors without WebGL2 to `/plain`. Other visitors can
choose the reading version from its link on the page. **The host must answer
`/plain` with `plain.html`.** If it answers with
`index.html` instead, those visitors bounce between the two forever.

`serve` gets this right with no config: `cleanUrls` defaults to on, so `/plain`
resolves to `plain.html` and `/plain.html` 301s to `/plain`. Two consequences:

- **Never add `-s` / `--single` to the serve command.** Single-page mode rewrites
  every unmatched path to `index.html`, `/plain` included, and the loop is back.
- **Never add a catch-all rewrite** to a `serve.json`. Missing paths should 404.

Route contract for the assembled site built by the Dockerfile:

| request | expected |
|---|---|
| `/walkthrough` | Redirects to `/walkthrough/`, then 200, the 3D clinic |
| `/plain` | Redirects to `/plain/`, then 200, `plain.html`, back-link to `/walkthrough/` |
| `/plain.html` | Redirects to the clean reading-page URL, then 200 |
| `/walkthrough/?ch=4` | 200, the 3D clinic |
| `/anything-else` | 404 — *not* `index.html` |

Standalone (`npm start`, this folder's `dist/` on its own) the clinic still
answers at `/` and its `/plain` still works — but the back-link inside that
`/plain` points at `/walkthrough`, which does not exist in the standalone tree.
Use `npm run dev` for local work; `npm start` is for checking the bundle, not the
links.

`scripts/serve.mjs` reads `PORT` with a default of `3000`, using the same Node
entry point on Windows, macOS, and Linux. The smoke command supplies `4173` by
default. The assembled Docker service uses port `8080`; it serves all four
site routes together rather than this standalone build.
