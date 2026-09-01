# rulekit — the research clinic

A scroll-driven three.js staging of `../plain.html`. Same story, same words; the
2D page stays the canonical reading version and is served here at `/plain`.

## Run it

    npm install
    npm run dev        # http://localhost:5173 — add ?hud=1 for the perf HUD, ?ch=N to jump
    npm test           # unit tests, scene budgets, and the copy-parity check
    npm run build      # syncs plain.html into public/, then builds to dist/
    npm start          # serves dist/ the way Railway does

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

Smoke needs a local Chrome and `puppeteer-core`; neither is installed here (a
300MB browser download per install is not worth it). Point
`PUPPETEER_EXECUTABLE_PATH` at Chrome if it is not in the default macOS place.

## Rules that matter

- `../plain.html` is never edited from here. `scripts/sync-plain.mjs` copies it into
  `public/` and appends one back-link block to the copy.
- Panel prose is transplanted verbatim. `npm run parity` fails the build if a
  sentence drifts or a claims-discipline label goes missing.
- Budgets: 300 draw calls, 500k triangles, 250KB gzip JS. `tests/budget.test.js`
  enforces the first two; check the third with
  `for f in dist/assets/*.js; do gzip -c "$f" | wc -c; done`.
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

## Deploy (Railway)

Static only — there is no server code. `railway.json` at the repo root holds the
config; the deploy is `npm ci && npm run build`, then `serve dist`.

Dashboard settings for the service:

| setting | value | why |
|---|---|---|
| Root Directory | `design/rulekit-thesis/clinic` | the repo has no root `package.json` |
| Config-as-code path | `railway.json` | it lives at the repo root, not in this folder |
| Builder | Nixpacks | set by `railway.json` |
| `NIXPACKS_NODE_VERSION` | `22` | Vite 8 needs Node 20+; this pins it |

Then:

    railway link                    # pick or create the project
    railway up --service clinic

### The `/plain` contract — do not break this

`src/main.js` redirects visitors with no WebGL, or with reduced-motion set, to
`/plain`. **The host must answer `/plain` with `plain.html`.** If it answers with
`index.html` instead, those visitors bounce between the two forever.

`serve` gets this right with no config: `cleanUrls` defaults to on, so `/plain`
resolves to `plain.html` and `/plain.html` 301s to `/plain`. Two consequences:

- **Never add `-s` / `--single` to the serve command.** Single-page mode rewrites
  every unmatched path to `index.html`, `/plain` included, and the loop is back.
- **Never add a catch-all rewrite** to a `serve.json`. Missing paths should 404.

Verified against `dist/` on the real start command:

| request | expected |
|---|---|
| `/` | 200, the 3D clinic |
| `/plain` | 200, `plain.html` |
| `/plain.html` | 301 → `/plain`, then 200 |
| `/?ch=4` | 200, the 3D clinic |
| `/anything-else` | 404 — *not* `index.html` |

`PORT` is written as `${PORT:-3000}` on purpose. `serve -l` with an empty argument
exits with `ARG_MISSING_REQUIRED_LONGARG`, which on Railway is a restart loop, so
the default is the difference between a bad port and a dead service.
