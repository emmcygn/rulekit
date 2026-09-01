/**
 * The served tree has two couplings that are invisible in the files themselves.
 *
 * 1. `trailingSlash: true` is what makes the sub-path apps work. Both /app and
 *    /walkthrough are Vite builds with `base: "./"`, so their index.html asks
 *    for `./assets/…`, which a browser resolves against the DIRECTORY of the
 *    current URL. At `/app` that means `/assets/…` — the landing page's folder —
 *    and every file 404s into a blank page. At `/app/` it resolves correctly.
 *    serve answers both forms 200 with no redirect of its own, so without this
 *    flag a typed or pasted URL silently renders nothing.
 *
 * 2. That same flag would send `/plain` -> `/plain/`, and /plain is a FILE
 *    (site/plain.html), not a directory. /plain is where the walkthrough sends
 *    every visitor with no WebGL2 or with reduced-motion set, so a 404 there
 *    strands exactly the readers who most need the 2D page. The `/plain/`
 *    rewrite is what closes that hole, and it only exists because of the flag.
 *
 * Remove either one alone and the deploy breaks in a way no unit test would
 * otherwise notice, so the pair is pinned here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

type ServeConfig = {
  trailingSlash?: boolean;
  rewrites?: { source: string; destination: string }[];
  headers?: { source: string; headers: { key: string; value: string }[] }[];
};

describe("deploy/serve.json", () => {
  const config = JSON.parse(read("deploy", "serve.json")) as ServeConfig;

  it("redirects sub-path apps to their trailing-slash form", () => {
    expect(config.trailingSlash).toBe(true);
  });

  it("keeps /plain reachable despite that redirect", () => {
    expect(config.rewrites ?? []).toContainEqual({
      source: "/plain/",
      destination: "/plain.html",
    });
  });

  it("has no catch-all rewrite, so missing paths still 404", () => {
    // A rewrite of "/**" or similar onto index.html would answer /plain with the
    // landing page and put the fallback visitors in a redirect loop.
    for (const { source } of config.rewrites ?? []) {
      expect(source).not.toMatch(/\*/);
    }
  });

  it("marks hashed assets immutable, walkthrough's included", () => {
    // The walkthrough's hashed files land at site/walkthrough/assets/, which
    // this glob has to reach as well as site/app/assets/.
    const immutable = (config.headers ?? []).find((h) =>
      h.headers.some((x) => x.value.includes("immutable")),
    );
    expect(immutable?.source).toBe("**/assets/**");
  });
});

describe("Dockerfile", () => {
  const dockerfile = read("Dockerfile");

  it("installs the walkthrough's deps from its own lockfile before the source copy", () => {
    const install = dockerfile.indexOf("npm --prefix docs/clinic ci");
    const copyAll = dockerfile.indexOf("COPY . .");
    expect(install).toBeGreaterThan(-1);
    // Manifest-first, like web/: a source-only edit must not reinstall three.js.
    expect(install).toBeLessThan(copyAll);
  });

  it("serves the walkthrough and lifts /plain out of its dist", () => {
    expect(dockerfile).toContain("/app/docs/clinic/dist ./site/walkthrough");
    // Only the dist copy carries the back-link that sync-plain injects; taking
    // docs/plain.html directly would ship the essay with no way back to the 3D
    // version.
    expect(dockerfile).toContain("/app/docs/clinic/dist/plain.html ./site/plain.html");
  });

  it("never serves single-page mode", () => {
    // -s rewrites every unmatched path to index.html, /plain included, which is
    // the redirect loop the fallback gate was built to avoid.
    expect(dockerfile).not.toMatch(/serve site .*\s-s\b/);
    expect(dockerfile).not.toMatch(/serve site .*--single\b/);
  });
});

describe("deploy/landing.html", () => {
  it("links to the walkthrough", () => {
    expect(read("deploy", "landing.html")).toContain('href="/walkthrough"');
  });
});
