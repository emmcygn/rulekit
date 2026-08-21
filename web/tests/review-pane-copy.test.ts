/**
 * `web/src/review/` carries byte-identical copies of the shipped review-pane
 * component. The copy exists because web-components/review-pane declares its own
 * react dependency and has no node_modules in web/'s CI job, so Vite cannot
 * resolve `react/jsx-runtime` from inside it — see ReviewView.tsx.
 *
 * A copy without a drift guard is just a fork, so: this fails the moment the two
 * diverge, and the fix is to copy again, never to edit the copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "..", "web-components", "review-pane", "src");
const COPY = join(import.meta.dirname, "..", "src", "review");

describe("review-pane copy", () => {
  for (const file of ["ReviewQueue.tsx", "sort.ts", "types.ts", "tokens.css"]) {
    it(`${file} is identical to web-components/review-pane/src/${file}`, () => {
      expect(readFileSync(join(COPY, file), "utf8")).toBe(readFileSync(join(SOURCE, file), "utf8"));
    });
  }
});
