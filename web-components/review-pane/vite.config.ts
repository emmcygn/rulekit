import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only. This package is a component, not an app — `npm run dev` serves
// index.html so the queue can be looked at in a browser. web/ imports the
// component directly when the Review tab is built.
export default defineConfig({ plugins: [react()] });
