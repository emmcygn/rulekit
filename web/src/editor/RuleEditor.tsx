import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { monaco, RULEKIT_THEME } from "./setup.js";
import type { Finding } from "../engine/api.js";
import { criterionSpans, findingLine } from "../engine/lines.js";

export type RevealRequest = { line: number; nonce: number };

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Findings for this document; drawn as markers. Pass [] for documents that aren't checked. */
  findings: Finding[];
  readOnly?: boolean;
  reveal?: RevealRequest | null;
};

const SEVERITY = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
} as const;

export function RuleEditor({ value, onChange, findings, readOnly = false, reveal }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // Diagnostics: one marker per finding, on the line of its first criterion.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model) return;
    const spans = criterionSpans(value);
    const markers = findings.map((f) => {
      const line = findingLine(spans, f.criteria) ?? 1;
      const content = model.getLineContent(Math.min(line, model.getLineCount()));
      return {
        severity: SEVERITY[f.level],
        message: f.evidence ? `${f.message}\n\n${f.evidence}` : f.message,
        source: f.code,
        startLineNumber: line,
        endLineNumber: line,
        startColumn: content.search(/\S/) + 1 || 1,
        endColumn: content.length + 1,
      };
    });
    monaco.editor.setModelMarkers(model, "rulekit", markers);
  }, [findings, value]);

  useEffect(() => {
    if (!reveal) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(reveal.line);
    editor.setPosition({ lineNumber: reveal.line, column: 1 });
    editor.focus();
  }, [reveal]);

  return (
    <MonacoEditor
      language="yaml"
      theme={RULEKIT_THEME}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      onMount={onMount}
      options={{
        readOnly,
        fontFamily: "'Spline Sans Mono', 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 19,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        padding: { top: 6, bottom: 6 },
        tabSize: 2,
        wordWrap: "off",
        automaticLayout: true,
      }}
    />
  );
}
