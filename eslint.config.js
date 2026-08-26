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
  // web/ and web-components/ are self-contained packages with their own
  // toolchains; deploy/assets holds vendored minified libraries (three.js).
  { ignores: ["dist/**", "web/**", "web-components/**", "deploy/assets/**"] },
);
