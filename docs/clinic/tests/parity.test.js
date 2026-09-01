import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { CHAPTERS } from '../src/core/chapters.js';
import {
  ALLOWLIST,
  CLAIM_RULES,
  blocksOf,
  checkParity,
  normalise,
  panelsOf,
  report,
  sectionsOf,
  sentencesOf,
  stripViewportGated,
} from '../scripts/copy-parity.mjs';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const plainHtml = readFileSync(fileURLToPath(new URL('../../plain.html', import.meta.url)), 'utf8');

describe('normalise', () => {
  it('strips tags, decodes entities and flattens punctuation', () => {
    expect(normalise('<p>At <em>least</em> 30 &#183; ok</p>')).toBe('at least 30 ok');
    expect(normalise('&#8220;don&#8217;t know&#8221;')).toBe("don't know");
    expect(normalise('a &#8212; b')).toBe('a b');
  });

  it('collapses the gloss markup into readable text', () => {
    expect(
      normalise('<span class="gloss">eGFR<span class="gloss-note">a standard kidney score</span></span>'),
    ).toBe('egfr a standard kidney score');
  });

  it('reads the figure plain.html counts up to, not its zero placeholder', () => {
    expect(normalise('<span class="big-num">$<span data-count-to="141">0</span>K</span>')).toBe('$141k');
    expect(normalise('<span class="cv"><span data-count-to="470">0</span></span> tests')).toBe('470 tests');
  });

  it('drops the chapter-number label that fronts an eyebrow', () => {
    expect(normalise('<p class="eyebrow"><span class="ch">02</span>idea one</p>')).toBe('idea one');
  });

  it('ignores scripts, styles, comments and inline svg', () => {
    expect(normalise('a<script>var x = "no"</script><!-- nor this --><svg><text>nope</text></svg>b')).toBe('a b');
  });
});

describe('blocksOf', () => {
  it('does not let one block run on into the next', () => {
    expect(blocksOf('<p class="eyebrow">rulekit</p><h2>A trial\'s rules live in a PDF.</h2>')).toEqual([
      'rulekit',
      "a trial's rules live in a pdf.",
    ]);
  });

  it('treats a line break inside one paragraph as a boundary', () => {
    expect(blocksOf('<p>first label<br>second label</p>')).toEqual(['first label', 'second label']);
  });
});

describe('sentencesOf', () => {
  it('splits on full stops and drops fragments of three words or fewer', () => {
    expect(sentencesOf('the rules read like law. law does not run. ok then')).toEqual([
      'the rules read like law',
      'law does not run',
    ]);
  });
});

describe('sectionsOf', () => {
  it('finds every plain.html section a panel can cite', () => {
    const s = sectionsOf(plainHtml);
    for (const id of new Set(CHAPTERS.flatMap((c) => c.plain))) {
      expect(s.has(id), `missing section ${id}`).toBe(true);
      expect(s.get(id).length, `section ${id} is empty`).toBeGreaterThan(50);
    }
  });
});

describe('panelsOf', () => {
  it('reads all eleven panels and their declared sources', () => {
    const panels = panelsOf(indexHtml);
    expect(panels).toHaveLength(11);
    for (const p of panels) expect(p.sentences.length, `${p.id} has no prose`).toBeGreaterThan(0);
  });

  it('declares exactly the mapping in CHAPTERS[].plain, in order', () => {
    const panels = panelsOf(indexHtml);
    expect(panels.map((p) => p.id)).toEqual(CHAPTERS.map((c) => c.id));
    expect(panels.map((p) => p.plain)).toEqual(CHAPTERS.map((c) => c.plain));
  });
});

describe('checkParity', () => {
  it('finds no orphan sentences - every panel line is in its plain.html sources', () => {
    const { orphans } = checkParity(indexHtml, plainHtml);
    expect(orphans, JSON.stringify(orphans, null, 2)).toEqual([]);
  });

  it('holds every claims-discipline rule', () => {
    const { claims } = checkParity(indexHtml, plainHtml);
    const failed = claims.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(claims.map((c) => c.rule)).toEqual([
      'synthetic-labelled-07',
      'synthetic-labelled-08',
      'synthetic-labelled-09',
      'chia-heuristic-labelled',
      'no-open-implementation',
      'not-medical-software',
      'tufts-sourced',
      'eroom-sourced',
      'documents-made-up',
      'three-marks-no-fourth',
    ]);
  });

  it('catches a rewritten sentence', () => {
    const tampered = indexHtml.replace(
      /(<h2 id="h-01-clinical">)[\s\S]*?(<\/h2>)/,
      '$1Rules are basically laws that cannot run.$2',
    );
    expect(tampered).not.toBe(indexHtml);
    const { orphans } = checkParity(tampered, plainHtml);
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans[0].panel).toBe('01-clinical');
    expect(orphans[0].sentence).toBe('rules are basically laws that cannot run');
  });

  it('catches a sentence smuggled into a panel from nowhere', () => {
    const tampered = indexHtml.replace(
      '</section>',
      '<p class="small">A sentence that appears nowhere in the plain-language page.</p></section>',
    );
    const { orphans } = checkParity(tampered, plainHtml);
    expect(orphans.map((o) => o.sentence)).toContain(
      'a sentence that appears nowhere in the plain-language page',
    );
  });

  it('catches a panel pointed at a section that does not exist', () => {
    const tampered = indexHtml.replace('data-plain="clinical"', 'data-plain="no-such-section"');
    const { orphans } = checkParity(tampered, plainHtml);
    expect(orphans[0].panel).toBe('01-clinical');
    expect(orphans[0].sentence).toMatch(/no plain\.html section named no-such-section/);
  });

  it('catches a stripped heuristic label', () => {
    const tampered = indexHtml.replace(/heuristic estimate/g, 'coverage figure');
    expect(tampered).not.toBe(indexHtml);
    const { claims } = checkParity(tampered, plainHtml);
    expect(claims.find((c) => c.rule === 'chia-heuristic-labelled').ok).toBe(false);
  });

  it('catches a dropped not-medical-software warning', () => {
    const tampered = indexHtml.replace(/not cleared by any regulator/g, 'reviewed internally');
    const { claims } = checkParity(tampered, plainHtml);
    const failed = claims.find((c) => c.rule === 'not-medical-software');
    expect(failed.ok).toBe(false);
    expect(failed.detail).toMatch(/not cleared by any regulator/);
  });

  it('catches the made-up-documents sentence going missing', () => {
    const tampered = indexHtml.replace(
      'Here are real failures in our (dummy) data.',
      'The failure below is documented.',
    );
    expect(tampered).not.toBe(indexHtml);
    const { claims } = checkParity(tampered, plainHtml);
    expect(claims.find((c) => c.rule === 'documents-made-up').ok).toBe(false);
  });

  it('fails a claim whose panel has been deleted outright', () => {
    const tampered = indexHtml.replace('data-panel="10-close"', 'data-panel="10-gone"');
    const { claims } = checkParity(tampered, plainHtml);
    for (const rule of ['no-open-implementation', 'not-medical-software', 'three-marks-no-fourth']) {
      expect(claims.find((c) => c.rule === rule).ok, rule).toBe(false);
    }
  });
});

describe('stripViewportGated', () => {
  it('removes a gated span and keeps the sentence around it', () => {
    expect(normalise(stripViewportGated('<p>Kept.<span class="ext"> Gone on a phone.</span></p>')))
      .toBe('kept.');
  });

  it('removes a gated block with everything nested inside it', () => {
    const html = '<div class="ext"><p class="small">one</p><p class="small ext-tall">two</p></div><p>three</p>';
    expect(normalise(stripViewportGated(html))).toBe('three');
  });

  it('does not mistake a class that merely starts with ext', () => {
    expect(normalise(stripViewportGated('<p class="extra">kept</p>'))).toBe('kept');
    expect(normalise(stripViewportGated('<p class="context">kept</p>'))).toBe('kept');
  });

  it('leaves a panel with no gated copy exactly as it reads', () => {
    const html = '<p class="small mono">the funnel below counts the same ten.</p>';
    expect(stripViewportGated(html)).toBe(html);
  });

  it('actually strips something in the real index.html', () => {
    const stripped = stripViewportGated(indexHtml);
    expect(stripped.length).toBeLessThan(indexHtml.length);
    expect(/\bext-tall\b/.test(stripped)).toBe(false);
    expect(/class="[^"]*\bext\b/.test(stripped)).toBe(false);
  });
});

describe('claims are co-located with the copy a phone renders', () => {
  it('every rule without an explicit exemption holds after the gated copy is stripped', () => {
    const stripped = stripViewportGated(indexHtml);
    for (const { rule, panel, must, allowViewportGated } of CLAIM_RULES) {
      if (allowViewportGated) continue;
      const m = stripped.match(
        new RegExp(`<section\\b[^>]*data-panel="${panel}"[^>]*>([\\s\\S]*?)</section>`),
      );
      expect(m, `panel ${panel} vanished`).not.toBe(null);
      const text = normalise(m[1]);
      for (const needle of must) {
        expect(text.includes(normalise(needle)), `${rule}: "${needle}" is only in .ext/.ext-tall`).toBe(true);
      }
    }
  });

  it('catches a claim sentence moved behind .ext', () => {
    const tampered = indexHtml.replace(
      '<p class="src">Source: Tufts',
      '<p class="src ext">Source: Tufts',
    );
    expect(tampered).not.toBe(indexHtml);
    const claim = checkParity(tampered, plainHtml).claims.find((c) => c.rule === 'tufts-sourced');
    expect(claim.ok).toBe(false);
    expect(claim.detail).toMatch(/hides behind \.ext/);
  });

  it('catches the made-up-documents sentence being demoted into .ext-tall', () => {
    const tampered = indexHtml.replace(
      '<p class="small">Here are real failures in our (dummy) data.',
      '<p class="small ext-tall">Here are real failures in our (dummy) data.',
    );
    expect(tampered).not.toBe(indexHtml);
    const claim = checkParity(tampered, plainHtml).claims.find((c) => c.rule === 'documents-made-up');
    expect(claim.ok).toBe(false);
    expect(claim.detail).toMatch(/hides behind \.ext/);
  });

  it('keeps the exemption list to the one documented case', () => {
    const exempt = CLAIM_RULES.filter((r) => r.allowViewportGated);
    expect(exempt.map((r) => r.rule)).toEqual(['three-marks-no-fourth']);
    for (const r of exempt) {
      expect(r.why, `${r.rule} is exempt with no reason given`).toBeTruthy();
      expect(r.why.length).toBeGreaterThan(40);
    }
  });
});

describe('the allowlist', () => {
  it('stays short, and every entry says why and names a real panel', () => {
    const panelIds = new Set(panelsOf(indexHtml).map((p) => p.id));
    expect(ALLOWLIST.length).toBeLessThanOrEqual(4);
    for (const entry of ALLOWLIST) {
      expect(panelIds.has(entry.panel), `allowlist names unknown panel ${entry.panel}`).toBe(true);
      expect(entry.why.length, `allowlist entry for ${entry.panel} has no reason`).toBeGreaterThan(20);
      expect(normalise(entry.sentence).length).toBeGreaterThan(0);
    }
  });

  it('only ever excuses a fragment that is genuinely not in the source', () => {
    const sections = sectionsOf(plainHtml);
    const byId = new Map(panelsOf(indexHtml).map((p) => [p.id, p]));
    for (const entry of ALLOWLIST) {
      const panel = byId.get(entry.panel);
      const sentence = normalise(entry.sentence);
      // The panel is edited by other tasks; only judge entries still in use.
      if (!panel.sentences.includes(sentence)) continue;
      const source = panel.plain.map((id) => sections.get(id) ?? '').join(' ');
      expect(source.includes(sentence), `dead allowlist entry for ${entry.panel}: ${sentence}`).toBe(false);
    }
  });
});

describe('report', () => {
  it('returns 0 for a clean run and 1 for drift', () => {
    expect(report({ orphans: [], claims: CLAIM_RULES.map((r) => ({ rule: r.rule, ok: true, detail: 'ok' })) })).toBe(0);
    expect(report({ orphans: [{ panel: 'x', plain: 'y', sentence: 'z' }], claims: [] })).toBe(1);
    expect(report({ orphans: [], claims: [{ rule: 'r', ok: false, detail: 'nope' }] })).toBe(1);
  });
});
