/**
 * Monaco, bundled locally (no CDN loader — the editor itself fetches nothing at
 * runtime) and trimmed to the editor plus YAML tokenization.
 *
 * Repo-wide caveat, so this comment does not read as a stronger claim than it
 * is: `web/index.html` does load Google Fonts over the network. See the note in
 * `web/src/data/index.ts`.
 */
import * as monaco from "monaco-editor/editor.js";
import "monaco-editor/features/register.all.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { loader } from "@monaco-editor/react";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
  }
}

window.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export const RULEKIT_THEME = "rulekit";

monaco.editor.defineTheme(RULEKIT_THEME, {
  base: "vs",
  inherit: true,
  // Ink for values, a lighter weight-carrying grey for keys, and no hue anywhere:
  // the palette spends its one colour on actions, not on syntax.
  rules: [
    { token: "", foreground: "17150F" },
    { token: "comment", foreground: "7E776A", fontStyle: "italic" },
    { token: "type", foreground: "6B655C", fontStyle: "bold" },
    { token: "string", foreground: "17150F" },
    { token: "string.yaml", foreground: "17150F" },
    { token: "number", foreground: "17150F" },
    { token: "number.yaml", foreground: "17150F" },
    { token: "keyword", foreground: "6B655C" },
    { token: "variable", foreground: "17150F" },
    { token: "identifier", foreground: "17150F" },
    { token: "attribute.name", foreground: "6B655C", fontStyle: "bold" },
    { token: "attribute.value", foreground: "17150F" },
    { token: "tag", foreground: "6B655C" },
    { token: "operators", foreground: "7E776A" },
    { token: "delimiter", foreground: "7E776A" },
    { token: "delimiter.bracket", foreground: "7E776A" },
  ],
  colors: {
    "editor.background": "#FAF8F4",
    "editor.foreground": "#17150F",
    "editorLineNumber.foreground": "#7E776A",
    "editorLineNumber.activeForeground": "#17150F",
    "editor.lineHighlightBackground": "#F3EFE7",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#E3DED4",
    "editorIndentGuide.background1": "#EDE9E1",
    "editorGutter.background": "#FAF8F4",
    "editorWidget.background": "#FAF8F4",
    "editorWidget.border": "#C9C2B4",
    "editorError.foreground": "#17150F",
    "editorWarning.foreground": "#6B655C",
    "editorInfo.foreground": "#B3AB9B",
    "scrollbarSlider.background": "#D6D0C450",
    "scrollbarSlider.hoverBackground": "#D6D0C4A0",
  },
});

loader.config({ monaco });

export { monaco };
