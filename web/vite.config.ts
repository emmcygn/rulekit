import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the built bundle works both at the domain root and under a
// GitHub Pages project path (/rulekit/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    // web/ imports types + parsers from ../src/core, which lives outside the Vite root.
    fs: { allow: [".."] },
  },
  build: { chunkSizeWarningLimit: 4096 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
