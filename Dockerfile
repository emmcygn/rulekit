# Railway deploy: the plain-language landing page at /, the workbench app at /app.
#
# Two static things, one service, no backend:
#   /       -> deploy/landing.html   (self-contained explainer page)
#   /app    -> web/dist              (the Vite workbench SPA)
#
# The web app is NOT self-contained: at build time it pulls the engine
# (../src/core) and the demo data (../rules, ../packs, ../fixtures, ../corpus)
# from the repo above it. Its `tsc` typecheck also reads ../src/core, which
# imports `zod`/`yaml` from the ROOT package — so the root deps must be
# installed before the web build runs. That two-step install is why this is a
# Dockerfile and not Railway's autodetect. The workbench's `base: "./"` (relative
# asset paths) is what lets it run unchanged under the /app/ sub-path.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Root deps first (engine: zod, yaml — needed by web's typecheck of ../src/core).
COPY package.json package-lock.json ./
RUN npm ci

# Web deps.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

# Source, then build. .dockerignore keeps local node_modules/dist out so the
# installed layers above survive this copy.
COPY . .
RUN npm --prefix web run build

# ---- serve stage ----
FROM node:22-alpine AS serve
WORKDIR /app
RUN npm install -g serve@14

# Assemble the served tree: landing page at the root, workbench under /app.
COPY --from=build /app/web/dist ./site/app
COPY deploy/landing.html ./site/index.html
# Landing-page vendor assets (self-hosted three.js for the intro scene).
COPY deploy/assets ./site/assets

ENV PORT=8080
EXPOSE 8080
# No -s (single-page rewrite): that would send /app to the landing page. The
# workbench switches tabs via state, not URL routes, so it needs no deep-link
# fallback — plain directory serving gives /app -> site/app/index.html.
CMD ["sh", "-c", "serve site -l ${PORT:-8080}"]
