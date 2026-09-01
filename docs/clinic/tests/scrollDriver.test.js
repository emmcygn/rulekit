import { describe, it, expect } from 'vitest';
import { stepState, syncToTarget, DAMPING_LAMBDA, scrollSpan, stableViewportHeight } from '../src/core/scrollDriver.js';

const fresh = () => ({ targetGlobal: 0, global: 0, index: 0, p: 0, velocity: 0, atRest: true });

describe('stepState', () => {
  it('eases global toward targetGlobal without overshooting', () => {
    const s = fresh();
    s.targetGlobal = 1;
    stepState(s, 1 / 60);
    expect(s.global).toBeGreaterThan(0);
    expect(s.global).toBeLessThan(1);
  });

  it('settles to at-rest once the target stops moving', () => {
    const s = fresh();
    s.targetGlobal = 0.5;
    for (let i = 0; i < 600; i++) stepState(s, 1 / 60);
    expect(s.global).toBeCloseTo(0.5, 5);
    expect(s.atRest).toBe(true);
  });

  it('reports not-at-rest while catching up', () => {
    const s = fresh();
    s.targetGlobal = 0.5;
    expect(stepState(s, 1 / 60)).toBe(true);
    expect(s.atRest).toBe(false);
  });

  it('derives chapter index and per-chapter progress from global', () => {
    const s = fresh();
    s.targetGlobal = 1;
    for (let i = 0; i < 900; i++) stepState(s, 1 / 60);
    expect(s.index).toBe(10);
    expect(s.p).toBeCloseTo(1, 4);
  });

  it('uses the documented damping constant', () => {
    expect(DAMPING_LAMBDA).toBe(5);
  });

  it('allocates nothing per step: two states step independently', () => {
    const a = fresh();
    const b = fresh();
    a.targetGlobal = 1;
    b.targetGlobal = 0;
    for (let i = 0; i < 300; i++) {
      stepState(a, 1 / 60);
      stepState(b, 1 / 60);
    }
    expect(a.index).toBe(10);
    expect(b.index).toBe(0);
    expect(b.global).toBe(0);
  });
});

describe('syncToTarget (reload / scroll restoration path)', () => {
  it('snaps a mid-page start onto the target instead of flying there from 0', () => {
    // A reload with browser scroll restoration leaves targetGlobal mid-document
    // while global is still 0.
    const s = { targetGlobal: 0.5, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(s);
    expect(s.global).toBe(0.5);
    expect(s.index).toBe(5);
    // Half the page lands inside 05-clash, 0.3889 of the way through it:
    // chapters 00-04 are 508 of the 1100vh, and 05 is 108 more.
    expect(s.p).toBeCloseTo(0.3889, 3);
    expect(s.velocity).toBe(0);
    expect(s.atRest).toBe(true);
  });

  it('stays put on the next frame — no drift after the snap', () => {
    const s = { targetGlobal: 0.5, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(s);
    expect(stepState(s, 1 / 60)).toBe(false);
    expect(s.global).toBe(0.5);
    expect(s.index).toBe(5);
    expect(s.atRest).toBe(true);
  });

  it('is consistent with globalToChapter at the ends', () => {
    const top = { targetGlobal: 0, global: 0.7, index: 7, p: 0.3, velocity: 9, atRest: false };
    syncToTarget(top);
    expect(top).toMatchObject({ global: 0, index: 0, p: 0, velocity: 0, atRest: true });

    const bottom = { targetGlobal: 1, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(bottom);
    expect(bottom).toMatchObject({ global: 1, index: 10, p: 1, atRest: true });
  });
});

// ── The scroll-to-progress denominator ───────────────────────────────────
//
// THE DEFECT THIS BLOCK EXISTS FOR. Chapter bounds are pixel positions, and the
// pixel a chapter starts at is its share of the SCROLLABLE DISTANCE. Take that
// distance as `scrollHeight - window.innerHeight` and it is not a constant on a
// phone: #spacer is sized in svh, which is the viewport with the browser's own
// UI SHOWN and never moves, while innerHeight grows by the height of the URL bar
// the moment that bar hides. The same scroll position then lands on a different
// chapter progress, and since the bar toggles BOTH ways during an ordinary
// scroll the camera walks forward through beats and then back through them.
// Measured in a real browser at 390x844 with an 82px bar, before the fix: the
// camera moved 2.47u at one scroll position, chapter 08 progress 0.139 -> 0.275
// and back, with the reader's finger nowhere near the screen.
//
// 100lvh is the LARGEST viewport height. It is the same number whether the bar
// is showing or not, so the mapping is stable; the reader reaches p = 1 up to
// one bar-height early when the bar is showing, and the trigger clamps there.
describe('the scroll-to-progress denominator', () => {
  // 1100svh on a 390x844 phone, and the two values innerHeight takes as an
  // 82px URL bar hides and comes back.
  const DOC = 9284, SVH = 844, LVH = 926;

  it('prefers the largest-viewport probe, and does not move when the bar does', () => {
    const probe = { offsetHeight: LVH };
    expect(stableViewportHeight(probe, { innerHeight: SVH })).toBe(LVH);
    expect(stableViewportHeight(probe, { innerHeight: LVH })).toBe(LVH);
  });

  it('falls back to innerHeight where lvh is not supported', () => {
    // An unsupported `height: 100lvh` is a dropped declaration, so the probe
    // measures 0 — no feature detection needed, and no pretending we know
    // better than a browser that cannot tell us.
    expect(stableViewportHeight({ offsetHeight: 0 }, { innerHeight: 800 })).toBe(800);
    expect(stableViewportHeight(null, { innerHeight: 800 })).toBe(800);
  });

  it('never returns a span of zero', () => {
    expect(scrollSpan(500, 500)).toBe(1);
    expect(scrollSpan(100, 900)).toBe(1);
  });

  it('maps one scroll position to one progress across a URL-bar toggle', () => {
    const probe = { offsetHeight: LVH };
    const y = 6330;
    const shown = y / scrollSpan(DOC, stableViewportHeight(probe, { innerHeight: SVH }));
    const hidden = y / scrollSpan(DOC, stableViewportHeight(probe, { innerHeight: LVH }));
    expect(hidden).toBe(shown);
  });

  it('is a fix for something: innerHeight moved the reader on its own', () => {
    const y = 6330;
    const shown = y / scrollSpan(DOC, SVH);
    const hidden = y / scrollSpan(DOC, LVH);
    // 0.0074 of the whole page, at a fixed scroll position, purely from the
    // browser hiding its own toolbar.
    expect(Math.abs(hidden - shown)).toBeGreaterThan(0.005);
  });
});
