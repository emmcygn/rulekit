# Railway deploy for the rulekit workbench (web/), a static Vite SPA.
#
# The web app is NOT self-contained: at build time it pulls the engine
# (../src/core) and the demo data (../rules, ../packs, ../fixtures, ../corpus)
# from the repo above it. Its `tsc` typecheck also reads ../src/core, which
# imports `zod`/`yaml` from the ROOT package — so the root deps must be
# installed before the web build runs. That two-step install is why this is a
# Dockerfile and not Railway's autodetect.
#
# Result is pure static files in web/dist, served by `serve`. No backend.

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
COPY --from=build /app/web/dist ./dist

ENV PORT=8080
EXPOSE 8080
# -s = single-page fallback: unknown routes serve index.html.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-8080}"]
