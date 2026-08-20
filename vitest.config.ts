import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The facts CLI tests spawn `tsx` in a child process; the default 5s is
    // tight for the first spawn on a cold cache.
    testTimeout: 30_000,
    exclude: ["**/node_modules/**", "web-components/**"],
  },
});
