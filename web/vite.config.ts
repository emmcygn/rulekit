import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the built bundle works both at the domain root and under a
// GitHub Pages project path (/rulekit/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    // web/ reads three things from outside the Vite root, all in the repo above
    // it: the engine (../src/core), and the demo data it refuses to duplicate —
    // ../rules/trials/demo-hf-001, ../packs/trials and ../fixtures/patients.
    fs: { allow: [".."] },
  },
  build: {
    // Monaco dwarfs the app; give it its own chunk so the shell loads first and
    // stays cacheable across workbench deploys.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/monaco-editor") ? "monaco" : undefined),
      },
    },
    chunkSizeWarningLimit: 4096,
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // A real origin, so jsdom hands the app a working localStorage — the review
    // pane persists decisions there and the smoke test exercises it.
    environmentOptions: { jsdom: { url: "http://localhost:5173/" } },
  },
});
