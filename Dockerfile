# Railway deploy: four static things, one service, no backend.
#
#   /            -> deploy/landing.html        (self-contained explainer page)
#   /app         -> web/dist                   (the Vite workbench SPA)
#   /walkthrough -> docs/clinic/dist           (the 3D research clinic)
#   /plain       -> docs/clinic/dist/plain.html (the plain-language edition)
#
# The web app is NOT self-contained: at build time it pulls the engine
# (../src/core) and the demo data (../rules, ../packs, ../fixtures, ../corpus)
# from the repo above it. Its `tsc` typecheck also reads ../src/core, which
# imports `zod`/`yaml` from the ROOT package — so the root deps must be
# installed before the web build runs. That two-step install is why this is a
# Dockerfile and not Railway's autodetect. The workbench's `base: "./"` (relative
# asset paths) is what lets it run unchanged under the /app/ sub-path.
#
# docs/clinic is a third package with the same shape: its own lockfile, its own
# `base: "./"`, so it too runs unchanged under a sub-path. Its build first runs
# scripts/sync-plain.mjs, which copies docs/plain.html into its public/ with one
# back-link block appended — which is why /plain is lifted out of the clinic's
# dist rather than copied from docs/ directly. The dist copy is the one carrying
# the link back to /walkthrough.

# ---- build stage ----
FROM node:22.22.2-alpine AS build
WORKDIR /app

# Root deps first (engine: zod, yaml — needed by web's typecheck of ../src/core).
COPY package.json package-lock.json ./
RUN npm ci

# Web deps.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

# Walkthrough deps (three.js, gsap, vite) — same manifest-first pattern, so a
# source-only change does not reinstall them.
COPY docs/clinic/package.json docs/clinic/package-lock.json ./docs/clinic/
RUN npm --prefix docs/clinic ci

# Source, then build. .dockerignore keeps local node_modules/dist out so the
# installed layers above survive this copy.
COPY . .
RUN npm --prefix web run build
RUN npm --prefix docs/clinic run build

# ---- serve stage ----
FROM node:22.22.2-alpine AS serve
WORKDIR /app
RUN npm install -g serve@14.2.6

# Assemble the served tree: landing page at the root, workbench under /app.
COPY --from=build /app/web/dist ./site/app
COPY deploy/landing.html ./site/index.html
# Landing-page vendor assets (self-hosted three.js for the intro scene).
COPY deploy/assets ./site/assets
# The 3D walkthrough, and the 2D edition it links back to. Both come from the
# clinic's dist: the plain.html in there is docs/plain.html plus the injected
# back-link, and taking it from anywhere else would ship the page without it.
COPY --from=build /app/docs/clinic/dist ./site/walkthrough
COPY --from=build /app/docs/clinic/dist/plain.html ./site/plain.html
# serve.json carries two policies, and JSON cannot hold comments, so they are
# explained here.
#
# 1. Cache. HTML revalidates every load (no-cache + etag), hashed assets are
#    immutable. Without this, browsers heuristically cache the HTML and a
#    redeploy strands them pointing at asset hashes that no longer exist. The
#    `**/assets/**` glob already covers site/walkthrough/assets/ — verified, the
#    walkthrough's hashed files come back with the immutable header.
#
# 2. trailingSlash + the /plain/ rewrite. Both sub-path apps are built with
#    Vite's `base: "./"`, so their index.html asks for `./assets/…`. A browser
#    resolves that against the DIRECTORY of the current URL — so at `/app` it
#    asks for `/assets/…` (the landing page's folder) and every file 404s, while
#    at `/app/` it correctly asks for `/app/assets/…`. serve answers both forms
#    with 200 and no redirect of its own, so the slash-less form renders a blank
#    page. `trailingSlash: true` makes serve 301 `/app` -> `/app/` and
#    `/walkthrough` -> `/walkthrough/`, which is what makes a typed or pasted URL
#    work at all.
#
#    The cost: that same rule also sends `/plain` -> `/plain/`, and `/plain` is a
#    FILE (site/plain.html), not a directory — so the redirect would 404 the one
#    page the no-WebGL and reduced-motion visitors are sent to. The rewrite maps
#    `/plain/` back onto `/plain.html` and closes that hole. It is a single
#    named path, NOT a catch-all: unmatched paths must keep 404-ing, because a
#    catch-all to index.html would put those visitors in a redirect loop.
COPY deploy/serve.json ./site/serve.json

ENV PORT=8080
EXPOSE 8080
# No -s (single-page rewrite): that would send /app to the landing page. The
# workbench switches tabs via state, not URL routes, so it needs no deep-link
# fallback — plain directory serving gives /app -> site/app/index.html.
#
# -s would also break the walkthrough outright. Visitors with no WebGL2, or with
# reduced-motion set, are redirected to /plain; serve's default cleanUrls answers
# that with site/plain.html, but single-page mode would answer it with the
# landing page and bounce them in a loop. Do not add -s, and do not add a
# catch-all rewrite to deploy/serve.json.
CMD ["sh", "-c", "serve site -l ${PORT:-8080}"]
