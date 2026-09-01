import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["fs", "path", "os", "process", "child_process", "url", "util", "stream", "node:fs", "node:path", "node:os", "node:process", "node:child_process", "node:url", "node:util", "node:stream"],
      }],
    },
  },
  // web/, web-components/ and docs/clinic/ are self-contained packages with
  // their own toolchains. docs/clinic is browser ES modules (three.js, gsap):
  // no TypeScript, and no browser globals declared here, so this config would
  // flag `window`, `document` and `console` on nearly every line of it. Its own
  // job in ci.yml is what guards it. deploy/assets holds vendored minified
  // libraries (three.js).
  { ignores: ["dist/**", "web/**", "web-components/**", "docs/clinic/**", "deploy/assets/**"] },
);
