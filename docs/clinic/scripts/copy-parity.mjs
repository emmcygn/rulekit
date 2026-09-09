#!/usr/bin/env node
//
// Keep walkthrough panels consistent with the canonical text page.
//
// The eleven panels in index.html carry prose transplanted word for word from
// docs/plain.html. This script checks sentence parity and visible scope.
//
// The invariant: every prose sentence inside a panel must appear, normalised,
// somewhere inside the concatenated text of the plain.html sections that
// panel's `data-plain` names (the same mapping as CHAPTERS[].plain in
// src/core/chapters.js). Anything else is an orphan — the copy has drifted, and
// copy edits must update the canonical source and its panel together.
//
// Three jobs:
//   1. Parity      — no orphan sentences.
//   2. Claims      — a fixed list of assertions that must hold however the
//      discipline     panels are later edited (synthetic labelled synthetic,
//                     historical costs sourced, prototype limits visible).
//   3. Co-location — every one of those claim sentences has to survive in the
//                    copy a PHONE renders. `.ext` and `.ext-tall` are
//                    display:none below 1200x760, so a claim that lives only
//                    inside one of them is a claim most readers never see. The
//                    check runs against the panel with those elements removed.
//
// Runnable as `npm run parity` (exit 0 / 1); importable for tests/parity.test.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const ENTITIES = {
  '&nbsp;': ' ', '&#160;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&#183;': ' ', '&#8230;': ' ', '&#8217;': "'",
  '&#8220;': '"', '&#8221;': '"', '&#8212;': ' ', '&#8211;': ' ', '&#10003;': ' ',
  '&#9744;': ' ', '&#9888;': ' ', '&#178;': '2',
};

/**
 * Flatten a fragment of HTML down to comparable words: tags, comments, scripts,
 * styles and inline SVG gone; entities decoded; smart punctuation folded to its
 * plain form; everything lowercased. Sentence-ending periods survive, because
 * sentences are the unit of comparison.
 */
export function normalise(html) {
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // plain.html animates its figures up from zero, so the static markup for
  // "$141K" literally reads `$<span data-count-to="141">0</span>K`. Read the
  // number the reader ends up seeing, not the placeholder.
  s = s.replace(/<span\b[^>]*\bdata-count-to="(\d+)"[^>]*>[\s\S]*?<\/span>/gi, '$1');
  // `<span class="ch">02</span>` is the chapter number a layout paints in front
  // of an eyebrow. Both documents carry it and the clinic renumbers its
  // stations independently, so it is a label, not prose: drop it from both
  // sides rather than compare it.
  s = s.replace(/<span\b[^>]*\bclass="ch"[^>]*>[\s\S]*?<\/span>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.toLowerCase();
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/[–—·…]/g, ' ');
  s = s.replace(/[^a-z0-9'"$%.,()\/:;\-+ ]/g, ' ');
  s = s.replace(/[",();:]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Map<sectionId, normalisedText> for every `<section id="...">` in plain.html. */
export function sectionsOf(plainHtml) {
  const out = new Map();
  const re = /<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(plainHtml)) !== null) out.set(m[1], normalise(m[2]));
  return out;
}

// Tags that end a line of reading. A heading does not run on into the lede
// below it, so neither may a parity sentence: without this, an eyebrow and the
// heading after it fuse into one string that exists nowhere in plain.html.
const BLOCK_TAGS =
  'p|div|section|article|main|aside|nav|header|footer|figure|figcaption|blockquote|pre|ul|ol|li|dl|dt|dd|table|tr|td|th|h1|h2|h3|h4|h5|h6|br|hr';
const BLOCK_RE = new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi');

const BREAK = '\u0000';

/** Split a fragment into normalised block-level lines, empties dropped. */
export function blocksOf(html) {
  return String(html)
    .replace(BLOCK_RE, BREAK)
    .split(BREAK)
    .map(normalise)
    .filter(Boolean);
}

// A "sentence" for parity purposes: a run of prose ending at a full stop or a
// block boundary. Runs of three words or fewer are dropped — they are labels,
// eyebrow numbers and single figures, not prose, and matching them would only
// produce noise.
export function sentencesOf(text) {
  return String(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.replace(/^[\s.\-]+|[\s.\-]+$/g, '').trim())
    .filter((s) => s.split(' ').length >= 4);
}

/** [{ id, plain: [sectionId], sentences: [normalisedSentence] }] for each panel. */
export function panelsOf(indexHtml) {
  const out = [];
  const re = /<section\b[^>]*\bdata-panel="([^"]+)"[^>]*\bdata-plain="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) {
    out.push({
      id: m[1],
      plain: m[2].trim().split(/\s+/),
      sentences: blocksOf(m[3]).flatMap(sentencesOf),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The allowlist.
//
// A short, closed list of panel fragments that are legitimately NOT plain.html
// prose. Each entry is the exact normalised sentence, the panel it belongs to,
// and why it is allowed to exist. Every entry here is structural — a label the
// panel layout adds, or source tokens reassembled into one readout — never a
// reworded claim. Task 19's report enumerates the categories; this is that list
// made executable.
//
// Adding an entry is a deliberate act: if a sentence cannot survive the
// transplant verbatim, the rule is to drop it from the panel, not to allowlist
// a rewrite. Only add here when the fragment carries no prose claim of its own.
// ---------------------------------------------------------------------------
export const ALLOWLIST = [];

// Normalise once so an allowlist entry written with markup-ish punctuation still
// matches; entries are compared after the same flattening the panels get.
const allowKey = (panel, sentence) => `${panel}${BREAK}${normalise(sentence)}`;
const ALLOWED = new Set(ALLOWLIST.map((a) => allowKey(a.panel, a.sentence)));

// ---------------------------------------------------------------------------
// Viewport gating. `.ext` and `.ext-tall` are the two classes src/styles.css
// hides on anything smaller than a roomy laptop, so their contents are copy a
// phone never renders. Strip them and what is left is the floor: the words
// every reader gets at every width.
//
// The scanner is depth-counting rather than non-greedy, because `<div class=
// "ext">` wraps whole runs of paragraphs and a lazy `[\s\S]*?</div>` would stop
// at the first close tag inside it. It assumes no void element carries the
// class (none does — `.ext` lands on div, p and span).
// ---------------------------------------------------------------------------
const GATED_CLASS = /(?:^|\s)(?:ext|ext-tall)(?:\s|$)/;

function matchingClose(s, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(s)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return s.length; // unclosed: swallow the rest rather than pretend it renders
}

/** Remove every element whose class carries `.ext` or `.ext-tall`, content and all. */
export function stripViewportGated(html) {
  let s = String(html);
  for (let guard = 0; guard < 500; guard++) {
    const open = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
    let hit = null;
    let m;
    while ((m = open.exec(s)) !== null) {
      const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(m[2]);
      if (cls && GATED_CLASS.test(cls[1])) { hit = m; break; }
    }
    if (!hit) return s;
    const end = matchingClose(s, hit[1].toLowerCase(), hit.index + hit[0].length);
    s = `${s.slice(0, hit.index)} ${s.slice(end)}`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Claims discipline. These hold regardless of how the panels are cut later.
//
// Every rule is checked twice: the needle must be in the panel at all, and — by
// default — it must still be there once the viewport-gated elements are
// stripped out. A rule opts out of the second check with `allowViewportGated`,
// which must carry a `why`. The current copy needs no viewport exemptions.
// ---------------------------------------------------------------------------
const CLAIM_RULES = [
  { rule: 'synthetic-labelled-00', panel: '00-hero', must: ['invented documents and synthetic patients'] },
  { rule: 'synthetic-labelled-04', panel: '04-three', must: ['synthetic patient'] },
  { rule: 'synthetic-labelled-07', panel: '07-ai', must: ['synthetic'] },
  { rule: 'synthetic-labelled-08', panel: '08-intake', must: ['synthetic'] },
  { rule: 'synthetic-labelled-09', panel: '09-build', must: ['synthetic'] },
  {
    rule: 'overlap-not-a-contradiction',
    panel: '05-clash',
    must: ['does not report a contradiction or fail the build'],
  },
  { rule: 'no-ehr-connector', panel: '09-build', must: ['no ehr connector'] },
  {
    rule: 'prototype-scope',
    panel: '10-close',
    must: ['this prototype'],
  },
  {
    rule: 'not-for-screening',
    panel: '10-close',
    must: ['not validated', 'not cleared by any regulator', 'not for clinical, feasibility, or research screening use'],
  },
  {
    rule: 'amendment-costs-sourced',
    panel: '01-clinical',
    must: ['$141k in phase ii', '$535k in phase iii', 'median direct costs', 'getz et al.', '2016'],
  },
  {
    rule: 'amendment-costs-not-savings',
    panel: '01-clinical',
    must: ['amendment costs, not savings demonstrated by rulekit'],
  },
  // Historical industry figures need their time frame, source and scope at
  // every viewport. They do not demonstrate an outcome from this prototype.
  {
    rule: 'eroom-sourced',
    panel: '00-hero',
    must: ['2012 analysis', 'about 80 times lower than in 1950', 'historical trend', 'scannell', 'nature reviews drug discovery'],
  },
  {
    rule: 'no-measured-cost-savings',
    panel: '00-hero',
    must: ['this prototype has not measured cost savings'],
  },
  // The one sentence that stops the invented paperwork from reading as a real
  // incident. Losing it was the worst thing the copy could do to itself, so it
  // is a rule and not a matter of editorial taste.
  {
    rule: 'documents-made-up',
    panel: '01-clinical',
    must: ['this illustration uses invented documents and synthetic patients.'],
  },
  {
    rule: 'missing-evidence-stays-unknown',
    panel: '04-three',
    must: ['without egfr', 'unknown', 'every criterion must pass', 'any failure makes the result ineligible', 'an unknown leaves it undetermined'],
  },
  {
    rule: 'human-confirmation-required',
    panel: '07-ai',
    must: ['exact source quote', 'human confirmation before evaluation', 'does not prove the proposed value is clinically correct'],
  },
];

export { CLAIM_RULES };

/** -> { orphans: [{ panel, sentence, plain }], claims: [{ rule, ok, detail }] } */
export function checkParity(indexHtml, plainHtml) {
  const sections = sectionsOf(plainHtml);
  const panels = panelsOf(indexHtml);
  const orphans = [];

  for (const panel of panels) {
    const missingSections = panel.plain.filter((id) => !sections.has(id));
    if (missingSections.length) {
      orphans.push({
        panel: panel.id,
        plain: panel.plain.join(' '),
        sentence: `<no plain.html section named ${missingSections.join(', ')}>`,
      });
      continue;
    }
    const source = panel.plain.map((id) => sections.get(id)).join(' ');
    for (const sentence of panel.sentences) {
      if (source.includes(sentence)) continue;
      if (ALLOWED.has(allowKey(panel.id, sentence))) continue;
      orphans.push({ panel: panel.id, plain: panel.plain.join(' '), sentence });
    }
  }

  const byId = new Map(panels.map((p) => [p.id, p]));
  const rawOf = (id) => {
    const m = indexHtml.match(
      new RegExp(`<section\\b[^>]*data-panel="${id}"[^>]*>([\\s\\S]*?)</section>`),
    );
    return m ? m[1] : '';
  };

  const claims = CLAIM_RULES.map(({ rule, panel, must, allowViewportGated }) => {
    if (!byId.has(panel)) {
      return { rule, ok: false, detail: `panel ${panel} does not exist in index.html` };
    }
    const raw = rawOf(panel);
    const text = normalise(raw);
    const missing = must.filter((needle) => !text.includes(normalise(needle)));
    if (missing.length) {
      return { rule, ok: false, detail: `${panel} is missing: ${missing.join(' | ')}` };
    }
    // Present — but is it present on a phone? Anything only reachable at
    // 1200x760 and up is not a claim the reader is actually given.
    if (allowViewportGated) return { rule, ok: true, detail: 'ok (viewport-gated by ruling)' };
    const onPhone = normalise(stripViewportGated(raw));
    const hidden = must.filter((needle) => !onPhone.includes(normalise(needle)));
    return {
      rule,
      ok: hidden.length === 0,
      detail: hidden.length
        ? `${panel} hides behind .ext/.ext-tall, so a phone never renders it: ${hidden.join(' | ')}`
        : 'ok',
    };
  });

  return { orphans, claims };
}

/** Print a readable report. Returns the process exit code: 0 clean, 1 drifted. */
export function report({ orphans, claims }) {
  const badClaims = claims.filter((c) => !c.ok);
  if (orphans.length === 0 && badClaims.length === 0) {
    console.log(
      `copy parity: OK - ${claims.length} claim rules held, no drifted sentences`,
    );
    return 0;
  }
  if (orphans.length) {
    console.error(
      `copy parity: ${orphans.length} panel sentence(s) not found in their plain.html source:`,
    );
    for (const o of orphans) {
      console.error(`  [${o.panel}] not in <${o.plain}>:`);
      console.error(`      ${o.sentence}`);
    }
    console.error(
      '  Update the canonical source and its panel together. If a sentence',
    );
    console.error(
      '  is optional detail, omit it from the panel without changing its meaning.',
    );
  }
  for (const c of badClaims) {
    console.error(`claims discipline FAILED (${c.rule}): ${c.detail}`);
  }
  return 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('copy-parity.mjs');
if (isMain) {
  const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const plainHtml = readFileSync(fileURLToPath(new URL('../../plain.html', import.meta.url)), 'utf8');
  process.exit(report(checkParity(indexHtml, plainHtml)));
}
