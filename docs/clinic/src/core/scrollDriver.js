// Scroll driver: one scrubbed ScrollTrigger per chapter writes the raw target
// into `state.targetGlobal`; the damped lerp that the camera actually follows
// lives in `stepState`, which is pure enough to test in Node.
//
// Touch scroll stays native — nothing here calls preventDefault or moves the
// page except the explicit `scrollToChapter` jump.

// `gsap`, not `gsap/gsap-core`. The package entry is core + CSSPlugin, and
// CSSPlugin looks like dead weight here because nothing in this file tweens a
// DOM property. It is not. ScrollTrigger's enable() calls
// `gsap.utils.checkPrefix`, and `checkPrefix` is installed onto gsap.utils by
// CSSPlugin, not by core — the dependency runs through the utils namespace, so
// grepping ScrollTrigger.js for "CSSPlugin" finds nothing and proves nothing.
// Dropping to gsap-core builds clean, tests clean, and throws
// "J.utils.checkPrefix is not a function" on the first trigger in a real
// browser. Verified by smoke test, not by reading. Do not "optimise" this.
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import { CHAPTERS, TOTAL_VH, chapterRanges, globalToChapter, chapterToGlobal } from './chapters.js';
import { damp, lerp } from '../lib/easing.js';

gsap.registerPlugin(ScrollTrigger);

// exp(-5 * 1/60) = 0.920 → an 0.08 per-frame lerp at 60fps, but framerate-independent.
export const DAMPING_LAMBDA = 5;
const REST_EPSILON = 1e-4;
const SNAP_EPSILON = 1e-6;

// Scratch for the chapter lookup. Read and copied out immediately, so one
// module-level object is enough and the frame path allocates nothing.
const _chapter = { index: 0, p: 0 };

export function stepState(state, dt) {
  const prev = state.global;
  state.global = damp(state.global, state.targetGlobal, DAMPING_LAMBDA, dt);
  if (Math.abs(state.targetGlobal - state.global) < SNAP_EPSILON) state.global = state.targetGlobal;
  state.velocity = Math.abs(state.global - prev) / Math.max(dt, 1e-4);
  state.atRest = state.velocity < REST_EPSILON;
  globalToChapter(state.global, _chapter);
  state.index = _chapter.index;
  state.p = _chapter.p;
  return !state.atRest;
}

// Snap the damped value onto wherever the page already is, at rest. Used after
// the initial refresh so a reload that restores mid-document scroll starts in
// place instead of damping there from 0.
export function syncToTarget(state) {
  state.global = state.targetGlobal;
  state.velocity = 0;
  state.atRest = true;
  globalToChapter(state.global, _chapter);
  state.index = _chapter.index;
  state.p = _chapter.p;
  return state;
}

// ── The scroll-to-progress denominator ───────────────────────────────────
//
// Chapter bounds are pixel positions: chapter i starts at `r.start` of the
// SCROLLABLE DISTANCE. That distance must not change while the reader is
// standing still, and `scrollHeight - window.innerHeight` does.
//
// #spacer is sized in svh — the viewport with the browser's own UI SHOWN — so
// the document height is a constant. `window.innerHeight` is not: on a phone it
// grows by the height of the URL bar the moment that bar hides, which it does
// on its own, while you scroll. Divide by it and the same scroll position maps
// to a different chapter progress every time the bar moves; because the bar
// toggles BOTH ways during an ordinary scroll, the camera walks forward through
// beats and then back through them again. Measured in a real browser at 390x844
// with an 82px bar: 2.47u of camera travel at one scroll position, chapter 08
// progress 0.139 -> 0.275 and back, with nobody touching the screen. That is
// the "scenes repeat 2-3 times" report, and it is not a keyframe problem.
//
// 100lvh is the LARGEST viewport height. It is the same number whether the
// browser's UI is showing or not, so the mapping is stable. The cost is that
// when the bar IS showing the reader can scroll one bar-height past the end and
// the trigger simply clamps at progress 1 — which chapter 10 already does by
// design, since its p = 1 is a held pose.
export function scrollSpan(docHeight, viewportHeight) {
  return Math.max(1, docHeight - viewportHeight);
}

// `probe` is an element sized `height: 100lvh`. Where lvh is unsupported the
// declaration is dropped, the element measures 0, and we fall back to
// innerHeight — no feature detection, and no pretending to know better than a
// browser that cannot tell us.
export function stableViewportHeight(probe, win) {
  const lvh = probe ? probe.offsetHeight : 0;
  return lvh > 0 ? lvh : win.innerHeight;
}

// Out of flow and invisible, so it cannot affect the height it exists to
// measure, and carries no semantics for a screen reader.
//
// `data-viewport-probe` is a SEAM, not decoration. A headless browser has no
// browser UI, so svh, lvh and innerHeight are all the same number there and the
// defect this probe exists for cannot arise on its own. scripts/smoke.mjs pins
// #spacer and this element to the two constants a real phone would supply and
// then moves innerHeight alone — which is the only way to drive the real
// failure in a real browser. Renaming this attribute silently disarms that pass.
function createViewportProbe(doc) {
  const el = doc.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.viewportProbe = '';
  el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;pointer-events:none;visibility:hidden';
  doc.body.appendChild(el);
  return el;
}

export function createScrollDriver({ spacer, onChapterChange = () => {} }) {
  spacer.style.height = TOTAL_VH + 'svh';

  const state = { targetGlobal: 0, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
  const ranges = chapterRanges();
  let lastIndex = -1;

  // The scrollable distance is the spacer height minus one viewport, not the
  // spacer height, so chapter bounds are pixel positions recomputed on every
  // refresh (start/end functions re-run then). Percent-of-trigger strings would
  // push chapter 10's end one viewport past the bottom of the document, and its
  // progress would never reach 1.
  //
  // "One viewport" is the LARGEST one, not the current one — see the note on
  // scrollSpan above for what innerHeight does to a reader on a phone.
  const probe = createViewportProbe(document);
  const maxScroll = () => scrollSpan(
    document.documentElement.scrollHeight,
    stableViewportHeight(probe, window),
  );

  const triggers = CHAPTERS.map((c, i) => {
    const r = ranges[i];
    return ScrollTrigger.create({
      start: () => r.start * maxScroll(),
      end: () => r.end * maxScroll(),
      scrub: true,
      onUpdate(self) {
        state.targetGlobal = lerp(r.start, r.end, self.progress);
      },
      onToggle(self) {
        if (self.isActive && lastIndex !== i) {
          lastIndex = i;
          onChapterChange(i);
        }
      },
    });
  });

  ScrollTrigger.refresh();
  // refresh() measured where the page already is — including a reload that
  // restored mid-document scroll, which toggles a trigger and sets lastIndex.
  // Start the camera there rather than damping to it from the top.
  syncToTarget(state);
  // A page loaded at the very top may never toggle anything, so announce the
  // chapter we are already sitting in.
  if (lastIndex === -1) {
    lastIndex = state.index;
    onChapterChange(lastIndex);
  }

  function scrollToChapter(i) {
    // 0.10, not 0.02: the panel layer fades a card in over the first 8% of a
    // chapter, so landing at 0.02 puts a deep link or a rail click inside the
    // ramp and the card arrives at 15% opacity.
    const g = chapterToGlobal(Math.max(0, Math.min(CHAPTERS.length - 1, i)), 0.10);
    window.scrollTo({ top: g * maxScroll(), behavior: 'auto' });
    ScrollTrigger.update();
  }

  return {
    state,
    tick: (dt) => stepState(state, dt),
    refresh: () => ScrollTrigger.refresh(),
    scrollToChapter,
    destroy() {
      triggers.forEach((t) => t.kill());
      if (probe.parentNode) probe.parentNode.removeChild(probe);
    },
  };
}
