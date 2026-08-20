/**
 * Loader for the hand-written synthetic notes in `corpus/notes/`.
 *
 * Each note is YAML front matter between `---` fences, then the body. Only the
 * body is exposed as groundable text: a quote that matches the front matter (or
 * the corpus README) is not evidence of anything.
 *
 * This module touches the filesystem, so it is deliberately outside src/core/.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export type Note = {
  doc: string;
  patient: string;
  kind: string;
  date?: string;
  synthetic: true;
  /** Trap this note is designed to spring, if any (see corpus/notes/README.md). */
  trap?: string;
  /** The groundable text. Newline-normalized; front matter excluded. */
  body: string;
};

/** doc id -> note */
export type NoteIndex = Record<string, Note>;

const here = dirname(fileURLToPath(import.meta.url));
/** Repo-root-relative `corpus/notes`, resolved from this module's location. */
export const NOTES_DIR = join(here, "..", "..", "corpus", "notes");

/** Normalize line endings only — see `normalizeNewlines` in ground.ts. */
const normalize = (s: string): string => s.replace(/\r\n?/g, "\n");

export function parseNote(text: string, filename: string): Note {
  const src = normalize(text);
  const lines = src.split("\n");
  if (lines[0] !== "---") throw new Error(`${filename}: missing front matter (expected a leading '---')`);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${filename}: unterminated front matter (no closing '---')`);

  const meta = parseYaml(lines.slice(1, end).join("\n")) as Record<string, unknown>;
  const body = lines.slice(end + 1).join("\n");

  const doc = meta.doc;
  const patient = meta.patient;
  const kind = meta.kind;
  if (typeof doc !== "string" || doc.length === 0) throw new Error(`${filename}: front matter needs a doc id`);
  if (typeof patient !== "string" || patient.length === 0) throw new Error(`${filename}: front matter needs a patient`);
  if (typeof kind !== "string" || kind.length === 0) throw new Error(`${filename}: front matter needs a kind`);
  // Guardrail, not decoration: this corpus is fabricated and every file has to
  // say so. A note without the marker does not load.
  if (meta.synthetic !== true) throw new Error(`${filename}: notes must be marked 'synthetic: true'`);

  const stem = basename(filename).replace(/\.txt$/, "");
  if (stem !== doc) throw new Error(`${filename}: doc id '${doc}' does not match the filename stem '${stem}'`);

  return {
    doc,
    patient,
    kind,
    date: typeof meta.date === "string" ? meta.date : undefined,
    synthetic: true,
    trap: typeof meta.trap === "string" ? meta.trap : undefined,
    body,
  };
}

export function loadNotesDir(dir: string = NOTES_DIR): NoteIndex {
  const index: NoteIndex = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".txt")) continue;
    const note = parseNote(readFileSync(join(dir, file), "utf8"), file);
    if (index[note.doc]) throw new Error(`duplicate doc id '${note.doc}' in ${dir}`);
    index[note.doc] = note;
  }
  return index;
}

/** The `doc -> text` shape the grounding gate consumes. */
export function toDocuments(notes: NoteIndex): Record<string, string> {
  return Object.fromEntries(Object.entries(notes).map(([id, n]) => [id, n.body]));
}
