import { describe, it, expect } from 'vitest';
import { CHAPTERS, TOTAL_VH, chapterRanges, globalToChapter, chapterToGlobal } from '../src/core/chapters.js';

describe('chapter manifest', () => {
  it('has 11 chapters totalling 1100svh', () => {
    expect(CHAPTERS).toHaveLength(11);
    expect(TOTAL_VH).toBe(1100);
  });
  it('every chapter names at least one plain.html source id', () => {
    for (const c of CHAPTERS) expect(c.plain.length).toBeGreaterThan(0);
  });
  it('covers every prose-bearing section of plain.html exactly once', () => {
    const all = CHAPTERS.flatMap((c) => c.plain);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([
      'hero', 'clinical', 'sw-engine', 'engine', 'engine-notes', 'p-compile',
      'p-three', 'clash-intro', 'p-clash', 'chasm', 'onecalc',
      'sw-ai', 'ai-intro', 'p-ai', 'intake', 'exists', 'build', 'assembly', 'close',
    ]);
  });
  it('ranges tile [0,1] with no gaps', () => {
    const r = chapterRanges();
    expect(r[0].start).toBe(0);
    expect(r[10].end).toBeCloseTo(1, 10);
    for (let i = 1; i < r.length; i++) expect(r[i].start).toBeCloseTo(r[i - 1].end, 10);
  });
  it('globalToChapter and chapterToGlobal round-trip', () => {
    for (const [i, p] of [[0, 0], [3, 0.5], [7, 0.25], [10, 0.999]]) {
      const g = chapterToGlobal(i, p);
      const back = globalToChapter(g);
      expect(back.index).toBe(i);
      expect(back.p).toBeCloseTo(p, 8);
    }
  });
  it('clamps out-of-range global progress', () => {
    expect(globalToChapter(-1)).toEqual({ index: 0, p: 0 });
    expect(globalToChapter(2).index).toBe(10);
    expect(globalToChapter(2).p).toBe(1);
  });
});
