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
  { ignores: ["dist/**", "web-components/**"] },
);
